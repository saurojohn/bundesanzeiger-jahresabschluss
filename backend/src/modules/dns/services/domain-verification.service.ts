import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { DnsProviderService } from './dns-provider.service';
import { KanzleiRepository } from '../../../common/repositories/kanzlei.repository';
import { AuditService } from '../../audit/services/audit.service';
import { PrismaService } from '../../../prisma/prisma.service';
import type { AuthUser } from '../../auth/types/auth-user.types';
import { assertFeatureEntitled } from '../../../common/utils/entitlements';

/**
 * Domain-Verifikations-Service (M4 Sprint 3).
 *
 * Workflow für Custom-Domain-Einrichtung:
 *   1. Kanzlei setzt customDomain via BrandingController
 *   2. DomainVerificationService.startVerification() erzeugt Token
 *      und versucht TXT-Record beim konfigurierten DNS-Provider anzulegen
 *      (falls Provider-API verfügbar)
 *   3. Wenn KEIN Provider-API: User trägt TXT-Record manuell ein
 *      (Anleitung im Response)
 *   4. DomainVerificationService.verifyVerification() prüft via
 *      öffentlichem DNS ob TXT-Record stimmt
 *   5. Bei Erfolg: kanzlei.customDomainVerified = true
 *
 * TXT-Record-Schema:
 *   Name:   _banz-verify.<custom-domain>
 *   Typ:    TXT
 *   Wert:   banz-verify=<token>
 *   TTL:    300
 *
 * Sicherheit:
 *   - Token ist 32-Zeichen-hex (kryptographisch zufällig)
 *   - Verify-Endpoint RBAC-geschützt (nur KANZLEI_ADMIN/SYSTEM_ADMIN)
 *   - Audit-Trail für jeden Verifikations-Schritt
 */
@Injectable()
export class DomainVerificationService {
  private readonly logger = new Logger(DomainVerificationService.name);
  private readonly TTL = 300;

  constructor(
    private readonly dnsProvider: DnsProviderService,
    private readonly kanzleiRepository: KanzleiRepository,
    private readonly auditService: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Startet die Verifikation für eine Custom-Domain.
   *
   * Versucht zuerst TXT-Record automatisch via Provider-API anzulegen.
   * Wenn Provider das nicht unterstützt oder fehlschlägt → User muss
   * TXT-Record manuell eintragen (Anleitung im Response).
   *
   * @returns verificationToken + Anleitung für manuellen Eintrag
   */
  async startVerification(
    kanzleiId: string,
    customDomain: string,
    user: AuthUser,
    context: { ip?: string | null; userAgent?: string | null },
  ): Promise<{
    verificationToken: string;
    txtRecordName: string;
    txtRecordValue: string;
    manualInstructions: string;
    autoCreated: boolean;
  }> {
    await this.assertKanzleiAdminAccess(kanzleiId, user);

    // Tarifpruefung: `custom-domain` ist Premium.
    // Bisher nirgends durchgesetzt — jede Kanzlei konnte eine
    // Custom-Domain verifizieren.
    await assertFeatureEntitled(this.prisma, kanzleiId, 'custom-domain');

    // Domain-Format-Validierung
    if (!this.isValidDomain(customDomain)) {
      throw new BadRequestException(`Ungültiger Domain-Format: ${customDomain}`);
    }

    // Kollisions-Check
    const taken = await this.kanzleiRepository.isCustomDomainTaken(customDomain, kanzleiId);
    if (taken) {
      throw new BadRequestException(
        `Custom-Domain "${customDomain}" wird bereits von einer anderen Kanzlei verwendet`,
      );
    }

    const kanzlei = await this.kanzleiRepository.findById(kanzleiId);
    if (!kanzlei) throw new NotFoundException('Kanzlei nicht gefunden');

    // Token generieren (32 hex chars)
    const verificationToken = uuidv4().replace(/-/g, '').substring(0, 32);
    const txtRecordName = `_banz-verify.${customDomain}`;
    const txtRecordValue = `banz-verify=${verificationToken}`;

    // Versuche TXT-Record via Provider anzulegen
    let autoCreated = false;
    try {
      const record = await this.dnsProvider.getProvider().createTxtRecord({
        name: txtRecordName,
        value: txtRecordValue,
        ttl: this.TTL,
      });
      this.logger.log(
        `TXT-Record automatisch angelegt für ${customDomain}: recordId=${record.recordId}`,
      );
      autoCreated = true;
    } catch (err) {
      this.logger.warn(
        `Auto-Anlage fehlgeschlagen für ${customDomain} (User trägt manuell ein): ${(err as Error).message}`,
      );
    }

    // Kanzlei speichern (mit Verification-Pending-Markierung)
    await this.prismaUpdateWithFallback(kanzleiId, {
      customDomain,
      // customDomainVerified bleibt false bis verifyVerification()
      brandingUpdatedAt: new Date(),
      brandingUpdatedById: user.id,
    });

    void this.auditService.record({
      userId: user.id,
      kanzleiId,
      action: 'UPDATE',
      entityType: 'CustomDomainVerification',
      entityId: kanzleiId,
      newState: {
        event: 'VERIFICATION_STARTED',
        customDomain,
        verificationToken: verificationToken.substring(0, 8) + '...', // nicht vollen Token loggen
        autoCreated,
        provider: this.dnsProvider.getProviderName(),
      },
      ipAddress: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    const manualInstructions = this.buildManualInstructions(
      customDomain,
      txtRecordName,
      txtRecordValue,
    );

    return {
      verificationToken,
      txtRecordName,
      txtRecordValue,
      manualInstructions,
      autoCreated,
    };
  }

  /**
   * Prüft ob der TXT-Record öffentlich verfügbar ist und matched.
   *
   * Bei Erfolg: kanzlei.customDomainVerified = true.
   */
  async verifyVerification(
    kanzleiId: string,
    user: AuthUser,
    context: { ip?: string | null; userAgent?: string | null },
  ): Promise<{ verified: boolean; reason?: string; checkedAt: Date }> {
    await this.assertKanzleiAdminAccess(kanzleiId, user);

    const kanzlei = await this.kanzleiRepository.findById(kanzleiId);
    if (!kanzlei) throw new NotFoundException('Kanzlei nicht gefunden');
    if (!kanzlei.customDomain) {
      throw new BadRequestException('Keine Custom-Domain konfiguriert — startVerification zuerst aufrufen');
    }
    if (kanzlei.customDomainVerified) {
      return { verified: true, checkedAt: new Date() };
    }

    // Wir lesen den erwarteten Token aus dem zuletzt angelegten TXT-Record
    const expectedName = `_banz-verify.${kanzlei.customDomain}`;
    const records = await this.dnsProvider.getProvider().listTxtRecords(expectedName);
    let expectedValue: string | null = null;
    for (const r of records) {
      if (r.value.startsWith('banz-verify=')) {
        expectedValue = r.value;
        break;
      }
    }
    if (!expectedValue) {
      return {
        verified: false,
        reason: 'Kein TXT-Record beim konfigurierten DNS-Provider gefunden. Manuell eintragen oder Auto-Provider prüfen.',
        checkedAt: new Date(),
      };
    }

    // Öffentliche DNS-Auflösung
    const publicMatch = await this.dnsProvider.verifyTxtRecordViaPublicDns(
      expectedName,
      expectedValue,
    );
    if (!publicMatch) {
      return {
        verified: false,
        reason: 'TXT-Record ist beim Provider angelegt, aber öffentlich noch nicht sichtbar. DNS-Propagation abwarten (bis zu 5 Min) und erneut prüfen.',
        checkedAt: new Date(),
      };
    }

    // Erfolg!
    await this.prismaUpdateWithFallback(kanzleiId, {
      customDomainVerified: true,
      brandingUpdatedAt: new Date(),
      brandingUpdatedById: user.id,
    });

    void this.auditService.record({
      userId: user.id,
      kanzleiId,
      action: 'UPDATE',
      entityType: 'CustomDomainVerification',
      entityId: kanzleiId,
      newState: {
        event: 'VERIFICATION_SUCCESS',
        customDomain: kanzlei.customDomain,
      },
      ipAddress: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return { verified: true, checkedAt: new Date() };
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  private buildManualInstructions(
    domain: string,
    recordName: string,
    recordValue: string,
  ): string {
    return [
      `Manuelle DNS-Verifikation für ${domain}:`,
      `  Typ:  TXT`,
      `  Name: ${recordName}`,
      `  Wert: ${recordValue}`,
      `  TTL:  ${this.TTL} Sekunden`,
      ``,
      `Nach Eintrag: DNS-Propagation abwarten (bis zu 5 Min) und`,
      `anschließend "Erneut prüfen" klicken.`,
    ].join('\n');
  }

  private isValidDomain(domain: string): boolean {
    // Basis-Validierung: mind. 2 Punkte, kein Protokoll-Präfix, nur gültige Zeichen
    if (domain.length < 4 || domain.length > 253) return false;
    if (domain.startsWith('http://') || domain.startsWith('https://')) return false;
    const regex = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;
    return regex.test(domain);
  }

  private async assertKanzleiAdminAccess(
    kanzleiId: string,
    user: AuthUser,
  ): Promise<void> {
    if (user.globalRole === 'SYSTEM_ADMIN') return;
    const isAdmin = user.mandanten.some((m) => m.rolle === 'KANZLEI_ADMIN');
    if (!isAdmin) {
      throw new ForbiddenException(
        'Nur KANZLEI_ADMIN oder SYSTEM_ADMIN darf Custom-Domain verifizieren',
      );
    }
    // Bugfix 2026-10-06: `kanzleiId` wurde bisher gar nicht verwendet.
    // Die Rollenpruefung bewies nur „Admin IRGENDWO" — der Admin von
    // Kanzlei A konnte Domain-Verifikation fuer Kanzlei B starten und
    // bestaetigen, also das Branding einer fremden Kanzlei uebernehmen.
    //
    // `user.mandanten[].id` ist eine MANDANT-UUID, nicht die kanzleiId.
    const mandant = await this.prisma.mandant.findFirst({
      where: { kanzleiId, id: { in: user.mandanten.map((m) => m.id) } },
      select: { id: true },
    });
    if (!mandant) {
      throw new ForbiddenException('Kein Zugriff auf diese Kanzlei');
    }
  }

  /**
   * Prisma-Update mit Logging bei Fehlern (z.B. wenn Schema-Migration
   * noch nicht durch ist und Spalten fehlen).
   */
  private async prismaUpdateWithFallback(
    kanzleiId: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    // Bugfix 2026-10-06: der Fehler wurde nur protokolliert und
    // geschluckt. `startVerification`/`confirmVerification` meldeten
    // danach Erfolg, waehrend `customDomainVerified` still nicht
    // gesetzt war — der Aufrufer glaubte, die Domain sei eintragen.
    try {
      await this.prisma.kanzlei.update({
        where: { id: kanzleiId },
        data: data as never,
      });
    } catch (err) {
      this.logger.error(
        `Kanzlei-Update fehlgeschlagen: ${(err as Error).message}`,
      );
      throw new InternalServerErrorException(
        'Die Domain konnte nicht gespeichert werden. Bitte erneut versuchen.',
      );
    }
  }
}