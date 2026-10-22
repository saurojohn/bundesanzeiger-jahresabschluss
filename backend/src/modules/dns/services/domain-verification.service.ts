import {
  BadRequestException,
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
import { assertAdminInKanzlei } from '../../../common/utils/kanzlei-rolle';
import { normalisiereDomain } from '../../../common/utils/domain-normalisierung';

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

    // BEFUND 2026-10-22 (Nachtrag 83): Die Domain wird normalisiert
    // (getrimmt, kleingeschrieben, ohne abschliessenden Punkt). Ohne das
    // konnte eine zweite Kanzlei dieselbe Domain beanspruchen — DNS ist
    // case-insensitiv, der Vergleich war es nicht.
    const domain = normalisiereDomain(customDomain);

    // Domain-Format-Validierung
    if (!this.isValidDomain(domain)) {
      throw new BadRequestException(`Ungültiger Domain-Format: ${customDomain}`);
    }

    // Kollisions-Check
    const taken = await this.kanzleiRepository.isCustomDomainTaken(domain, kanzleiId);
    if (taken) {
      throw new BadRequestException(
        `Custom-Domain "${domain}" wird bereits von einer anderen Kanzlei verwendet`,
      );
    }

    const kanzlei = await this.kanzleiRepository.findById(kanzleiId);
    if (!kanzlei) throw new NotFoundException('Kanzlei nicht gefunden');

    // Token generieren (32 hex chars)
    const verificationToken = uuidv4().replace(/-/g, '').substring(0, 32);
    const txtRecordName = `_banz-verify.${domain}`;
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
        `TXT-Record automatisch angelegt für ${domain}: recordId=${record.recordId}`,
      );
      autoCreated = true;
    } catch (err) {
      this.logger.warn(
        `Auto-Anlage fehlgeschlagen für ${domain} (User trägt manuell ein): ${(err as Error).message}`,
      );
    }

    // Kanzlei speichern (mit Verification-Pending-Markierung)
    //
    // BEFUND 2026-10-22 (Nachtrag 83): Das Token wird **gespeichert**. Vorher
    // wurde es ausgestellt und dem Client mitgegeben, aber nirgends
    // abgelegt — `verifyVerification()` hatte damit nichts, womit es den
    // TXT-Record vergleichen konnte, und bestaetigte jeden Record mit dem
    // Praefix "banz-verify=" (auch einen fremden).
    await this.prismaUpdateWithFallback(kanzleiId, {
      customDomain: domain,
      // customDomainVerified bleibt false bis verifyVerification()
      customDomainVerificationToken: verificationToken,
      customDomainVerificationRequestedAt: new Date(),
      brandingUpdatedAt: new Date(),
      brandingUpdatedById: user.id,
    });

    await this.auditService.record({
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
      domain,
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
   *
   * BEFUND 2026-10-22 (Nachtrag 83): Der Vergleich war **wirkungslos**.
   * Der erwartete Wert wurde aus dem DNS gelesen und mit dem oeffentlichen
   * DNS verglichen:
   *
   *     const expectedValue = <der Wert, der im DNS steht>;
   *     const publicMatch = await verifyTxtRecordViaPublicDns(name, expectedValue);
   *
   * Das Token, das `startVerification()` ausgestellt hat, kam hier **nicht
   * vor** — es wurde nirgends gespeichert. Die Pruefung bestaetigte damit
   * nur "irgendein TXT-Record mit dem Praefix banz-verify= existiert und
   * ist oeffentlich sichtbar". Ein Record aus einem fremden Verifikations-
   * lauf genuegte.
   *
   * Jetzt: Der erwartete Wert ist `banz-verify=<Token dieser Kanzlei>`.
   * Der Token muss zur laufenden Anfrage gehoeren (er wird bei
   * `startVerification()` ausgestellt und gespeichert) — sonst gibt es
   * keine Verifikation (fail-closed). Nach dem Erfolg wird der Token
   * geloescht: er ist einmalig verwendbar.
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

    // Fail-closed: ohne laufende Verifikationsanfrage gibt es nichts zu
    // pruefen. Vorher konnte jede Kanzlei "pruefen", ohne je ein Token
    // erhalten zu haben — die Domain stand dann als verifiziert da, obwohl
    // sie niemandem gehoert.
    if (!kanzlei.customDomainVerificationToken) {
      throw new BadRequestException(
        'Keine Verifikationsanfrage vorhanden — bitte zuerst "Verifikation starten" aufrufen',
      );
    }

    const expectedName = `_banz-verify.${kanzlei.customDomain}`;
    const expectedValue = `banz-verify=${kanzlei.customDomainVerificationToken}`;

    // Öffentliche DNS-Auflösung — **exakter** Vergleich. Der erwartete
    // Wert kommt aus dem gespeicherten Token dieser Kanzlei, nicht aus dem
    // DNS selbst (das waere der alte, wirkungslose Weg) und nicht als
    // Teilstring-Vergleich (ein "includes" haette z.B. einen fremden Record
    // mit angehaengten Zeichen akzeptiert).
    const publicMatch = await this.dnsProvider.verifyTxtRecordViaPublicDns(
      expectedName,
      expectedValue,
    );
    if (!publicMatch) {
      // Diagnose: der TXT-Record ist nicht (oder noch nicht) sichtbar.
      //
      // BEFUND 2026-10-22 (Nachtrag 83): Der Provider ist fuer die
      // Pruefung **nicht** mehr erforderlich — der oeffentliche DNS ist die
      // entscheidende Quelle. Damit funktioniert auch der dokumentierte
      // Handpfad ("User traegt TXT-Record manuell ein"), der in einer
      // Umgebung ohne Provider-Zone vorher gar nicht durchlaufen konnte
      // (503).
      //
      // Der Provider liefert nur noch die Diagnose: steht dort ein *anderer*
      // Wert, muss der Eintrag ersetzt werden; fehlt die Konfiguration
      // ganz, muss der Nutzer das wissen — die automatische Anlage ist dann
      // nicht moeglich, die manuelle aber weiterhin.
      let hinweis = '';
      try {
        const records = await this.dnsProvider.getProvider().listTxtRecords(expectedName);
        const abweichend = records.find(
          (r) => r.value.startsWith('banz-verify=') && r.value !== expectedValue,
        );
        if (abweichend) {
          hinweis =
            ' Im DNS-Provider steht ein anderer Wert — bitte den Eintrag mit dem ' +
            'aktuell zugewiesenen Token ersetzen.';
        }
      } catch (err) {
        // Die Meldung des Providers ist bereits verstaendlich und nennt die
        // Ursache (HETZNER_DNS_ZONE_ID). Sie wird hier nur eingebettet — der
        // Text erscheint in der deutschen Oberflaeche.
        hinweis = ` Hinweis: ${(err as Error).message}`;
      }
      return {
        verified: false,
        reason:
          `Der TXT-Record "${expectedName}" mit dem zugewiesenen Token ist ` +
          'noch nicht öffentlich sichtbar. DNS-Propagation abwarten (bis zu 5 Min) ' +
          `und erneut prüfen.${hinweis}`,
        checkedAt: new Date(),
      };
    }

    // Erfolg!
    await this.prismaUpdateWithFallback(kanzleiId, {
      customDomainVerified: true,
      // Das Token wird geloescht: es ist einmalig verwendbar. Ein spaeterer
      // Record mit demselben Wert koennte die Kanzlei sonst erneut
      // "verifizieren", obwohl die Domain inzwischen jemand anderem gehoert.
      customDomainVerificationToken: null,
      customDomainVerificationRequestedAt: null,
      brandingUpdatedAt: new Date(),
      brandingUpdatedById: user.id,
    });

    await this.auditService.record({
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
    // Bugfix 2026-10-06: `kanzleiId` wurde bisher gar nicht verwendet.
    // Die Rollenpruefung bewies nur „Admin IRGENDWO" — der Admin von
    // Kanzlei A konnte Domain-Verifikation fuer Kanzlei B starten und
    // bestaetigen, also das Branding einer fremden Kanzlei uebernehmen.
    //
    // `user.mandanten[].id` ist eine MANDANT-UUID, nicht die kanzleiId.
    //
    // BEFUND 2026-10-11: Der Bugfix vom 2026-10-06 hat den Kanzlei-Bezug
    // ergaenzt, die Rolle aber nicht daran gebunden. "Admin irgendwo" +
    // "Mandant in der Ziel-Kanzlei" ergab zusammen nicht "Admin in der
    // Ziel-Kanzlei".
    const mandanten = await this.prisma.mandant.findMany({
      where: { kanzleiId, id: { in: user.mandanten.map((m) => m.id) } },
      select: { id: true },
    });
    assertAdminInKanzlei(
      mandanten.map((m) => m.id),
      user.mandanten,
      'Nur KANZLEI_ADMIN dieser Kanzlei darf die Custom-Domain verifizieren',
    );
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