import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../audit/services/audit.service';
import type { AuthUser } from '../../auth/types/auth-user.types';
import type { WPPruefungStatus } from '../constants/wp-status.constants';
import type {
  BilanzPruefungsResultEntity,
  WPNotizEntity,
  WPPruefungsAbschlussEntity,
} from '../wp.repository';
import { WPRepository } from '../wp.repository';
import { IdwPruefungService } from './idw-pruefung.service';

export interface WPPruefungServiceContext {
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Service: WP-Prüfungs-Vorgang (Lifecycle).
 *
 *   1. startPruefung        — IN_PROGRESS  (Plausi läuft automatisch)
 *   2. finalizePruefung     — APPROVED | REJECTED (setzt Bilanz.status)
 *   3. generateReport       — Markdown-Bericht
 *
 * RBAC: nur Wirtschaftsprüfer.
 */
@Injectable()
export class WPPruefungService {
  private readonly logger = new Logger(WPPruefungService.name);

  constructor(
    private readonly wpRepository: WPRepository,
    private readonly idwService: IdwPruefungService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Startet eine neue WP-Prüfung gegen eine Bilanz (optional GuV).
   *
   * Auto-Ausführung: IdwPruefungService.runPruefung erzeugt 5
   * BilanzPruefungsResult-Einträge direkt nach Anlage.
   */
  async startPruefung(
    args: {
      bilanzId: string;
      guvId?: string;
      zusammenfassung?: string;
    },
    user: AuthUser,
    context: WPPruefungServiceContext,
  ): Promise<WPPruefungsAbschlussEntity> {
    this.assertWirtschaftsPrueferRole(user);

    const mandantId = await this.wpRepository.findBilanzMandantId(args.bilanzId);
    if (!mandantId) {
      throw new NotFoundException('Bilanz nicht gefunden');
    }
    this.assertMandantAccess(mandantId, user);

    if (args.guvId) {
      const guvMandantId = await this.wpRepository.findGuVMandantId(args.guvId);
      if (!guvMandantId || guvMandantId !== mandantId) {
        throw new BadRequestException(
          'GuV muss existieren und zum selben Mandanten gehören wie die Bilanz',
        );
      }
    }

    const pruefung = await this.wpRepository.createPruefungsAbschluss({
      bilanzId: args.bilanzId,
      guvId: args.guvId ?? null,
      wpUserId: user.id,
      zusammenfassung: args.zusammenfassung ?? null,
    });

    // Plausi direkt mit-ausführen, damit die 5 Ergebnisse vorhanden sind.
    await this.idwService.runPruefung(
      { bilanzId: args.bilanzId, guvId: args.guvId },
      user,
      { ip: context.ip ?? null, userAgent: context.userAgent ?? null },
    );

    void this.auditService.record({
      userId: user.id,
      mandantId,
      action: 'CREATE',
      entityType: 'WPPruefungsAbschluss',
      entityId: pruefung.id,
      newState: {
        bilanzId: args.bilanzId,
        guvId: args.guvId ?? null,
        status: pruefung.status,
      } as unknown as Prisma.JsonValue,
      ipAddress: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return pruefung;
  }

  /**
   * Finalisiert eine WP-Prüfung.
   *
   * Bei APPROVED wird Bilanz.status auf APPROVED gesetzt (Validierungs-
   * Marker). Bei REJECTED bleibt der Status unverändert (Bilanz bleibt
   * ggf. DRAFT, damit der Steuerberater nachbessern kann).
   */
  async finalizePruefung(
    pruefungId: string,
    args: {
      status: 'APPROVED' | 'REJECTED';
      zusammenfassung: string;
    },
    user: AuthUser,
    context: WPPruefungServiceContext,
  ): Promise<WPPruefungsAbschlussEntity> {
    this.assertWirtschaftsPrueferRole(user);

    const existing = await this.wpRepository.findPruefungsAbschlussById(pruefungId);
    if (!existing) {
      throw new NotFoundException('WP-Prüfung nicht gefunden');
    }
    if (existing.status !== 'IN_PROGRESS') {
      throw new BadRequestException(
        `Prüfung kann nicht mehr finalisiert werden — aktueller Status: ${existing.status}`,
      );
    }

    const mandantId = await this.wpRepository.findBilanzMandantId(existing.bilanzId);
    if (!mandantId) {
      throw new NotFoundException('Mandant für Prüfung nicht auflösbar');
    }
    this.assertMandantAccess(mandantId, user);

    // Vier-Augen-Prinzip (IDW PS 880, § 11 Abs. 2 WPO) — JETZT
    // durchgesetzt.
    //
    // Stand 2026-10-07: Die Sperre fehlte. Sie existierte nur fuer
    // NOTIZEN (`wp-notiz.service.ts`, Self-Acknowledgement), nicht fuer
    // die Freigabe, die tatsaechlich zaehlt: der Wirtschaftspruefer, der
    // die Pruefung durchgefuehrt hat, konnte sie selbst freigeben.
    //
    // Bis eben war das auch nicht abstellbar: `WPPruefungsAbschluss`
    // fuehrte genau EIN `wpUserId` — den Pruefenden — und es gab kein
    // Feld fuer eine zweite Person. Der Seed legte nur EINEN
    // WIRTSCHAFTSPRUEFER an. Eine harte 403-Sperre haette den gesamten
    // Freigabeweg lahmgelegt: der einzige Pruefer koennte seine eigene
    // Pruefung nie freigeben. Das waere keine Erfuellung der Kontrolle,
    // sondern das Abschalten des Produkts.
    //
    // BEIDES IST JETZT ERLEDIGT:
    //   - `freigegebenVonId` im Schema (Migration 20261007212118)
    //   - ein ZWEITER WIRTSCHAFTSPRUEFER im Seed (wp2@kanzlei.de)
    //
    // Damit ist die Kontrolle erfuellbar, also wird sie erzwungen.
    //
    // Nur beim FREIGEBEN, nicht beim Zurueckweisen: eine Ablehnung
    // durch den Pruefenden selbst entwertet nichts, sie stoppt nur.
    const selbstFreigegeben =
      args.status === 'APPROVED' && existing.wpUserId === user.id;
    if (selbstFreigegeben) {
      throw new ForbiddenException(
        'Vier-Augen-Prinzip: die Prüfung darf nicht von dem ' +
          'Wirtschaftsprüfer freigegeben werden, der sie durchgeführt hat. ' +
          'Bitte eine zweite Person mit der Rolle WIRTSCHAFTSPRUEFER die ' +
          'Freigabe vornehmen lassen.',
      );
    }
    const updated = await this.wpRepository.finalizePruefungsAbschluss({
      id: pruefungId,
      status: args.status,
      zusammenfassung: args.zusammenfassung,
      finalisierungVonId: user.id,
    });

    if (args.status === 'APPROVED') {
      await this.wpRepository.setBilanzStatus(existing.bilanzId, 'APPROVED', user.id);
    }

    void this.auditService.record({
      userId: user.id,
      mandantId,
      action: 'UPDATE',
      entityType: 'WPPruefungsAbschluss',
      entityId: pruefungId,
      previousState: {
        status: existing.status,
        zusammenfassung: existing.zusammenfassung,
      } as unknown as Prisma.JsonValue,
      newState: {
        status: updated.status,
        zusammenfassung: updated.zusammenfassung,
        completedAt: updated.completedAt?.toISOString() ?? null,
        bilanzStatusNachFinalize: args.status === 'APPROVED' ? 'APPROVED' : null,
        // Vier-Augen-Prinzip: die Aufzeichnung muss zeigen, dass die
        // Freigabe durch den Pruefenden selbst erfolgte (§ 147 AO).
        // Vier-Augen-Prinzip: jetzt nachweisbar, weil die Freigabe nur
        // von einer ANDEREN Person kommen kann.
        pruefendeUserId: existing.wpUserId,
        freigegebenVonId: user.id,
        vierAugenErfuellt: existing.wpUserId !== user.id,
      } as unknown as Prisma.JsonValue,
      ipAddress: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return updated;
  }

  /**
   * Liefert eine WP-Prüfung inkl. Prüfungs-Ergebnissen und Notizen.
   */
  async findOne(
    pruefungId: string,
    user: AuthUser,
  ): Promise<{
    pruefung: WPPruefungsAbschlussEntity;
    results: BilanzPruefungsResultEntity[];
    notizen: WPNotizEntity[];
  }> {
    const pruefung = await this.wpRepository.findPruefungsAbschlussById(pruefungId);
    if (!pruefung) {
      throw new NotFoundException('WP-Prüfung nicht gefunden');
    }
    const mandantId = await this.wpRepository.findBilanzMandantId(pruefung.bilanzId);
    if (!mandantId) {
      throw new NotFoundException('Mandant nicht auflösbar');
    }
    this.assertMandantAccess(mandantId, user);

    const [results, notizen] = await Promise.all([
      this.wpRepository.findPruefungsResultsByBilanz(pruefung.bilanzId),
      this.wpRepository.findNotizen({
        bilanzId: pruefung.bilanzId,
        guvId: pruefung.guvId ?? undefined,
      }),
    ]);

    return { pruefung, results, notizen };
  }

  /**
   * Erzeugt einen Markdown-Bericht (IDW PS 880-konform).
   */
  async generateReport(
    pruefungId: string,
    user: AuthUser,
  ): Promise<string> {
    const data = await this.findOne(pruefungId, user);
    return this.formatMarkdownReport(
      data.pruefung,
      data.results,
      data.notizen,
    );
  }

  /**
   * Liste aller WP-Prüfungen zu einer Bilanz.
   */
  async listByBilanz(
    bilanzId: string,
    user: AuthUser,
  ): Promise<WPPruefungsAbschlussEntity[]> {
    const mandantId = await this.wpRepository.findBilanzMandantId(bilanzId);
    if (!mandantId) {
      throw new NotFoundException('Bilanz nicht gefunden');
    }
    this.assertMandantAccess(mandantId, user);
    return this.wpRepository.findPruefungsAbschluesseByBilanz(bilanzId);
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  private assertWirtschaftsPrueferRole(user: AuthUser): void {
    if (user.globalRole === 'SYSTEM_ADMIN') return;
    const hasWPRole = user.mandanten.some(
      (m) => m.rolle === 'WIRTSCHAFTSPRUEFER',
    );
    if (!hasWPRole) {
      throw new ForbiddenException(
        'Nur Wirtschaftsprüfer dürfen WP-Prüfungen starten/finalisierten',
      );
    }
  }

  private assertMandantAccess(mandantId: string, user: AuthUser): void {
    if (user.globalRole === 'SYSTEM_ADMIN') return;
    const accessible = new Set(user.mandanten.map((m) => m.id));
    if (!accessible.has(mandantId)) {
      throw new ForbiddenException('Kein Zugriff auf diesen Mandanten');
    }
  }

  private formatMarkdownReport(
    pruefung: WPPruefungsAbschlussEntity,
    results: BilanzPruefungsResultEntity[],
    notizen: WPNotizEntity[],
  ): string {
    const lines: string[] = [];
    lines.push('# Wirtschaftsprüfungs-Bericht');
    lines.push('');
    lines.push(`**WP-Prüfung-ID:** \`${pruefung.id}\``);
    lines.push(`**Bilanz-ID:** \`${pruefung.bilanzId}\``);
    if (pruefung.guvId) {
      lines.push(`**GuV-ID:** \`${pruefung.guvId}\``);
    }
    lines.push(`**Status:** \`${pruefung.status}\``);
    lines.push(`**Gestartet:** ${pruefung.startedAt.toISOString()}`);
    if (pruefung.completedAt) {
      lines.push(`**Abgeschlossen:** ${pruefung.completedAt.toISOString()}`);
    }
    lines.push(`**WP-User:** \`${pruefung.wpUserId}\``);
    lines.push('');

    lines.push('## Plausibilitäts-Ergebnisse (IDW PS 880)');
    lines.push('');
    lines.push('| Regel | Status | Berechneter Wert | Schwellwert | Meldung |');
    lines.push('|---|---|---|---|---|');
    for (const r of results) {
      lines.push(
        `| ${r.regelCode} | ${r.status} | ${r.berechneterWert?.toString() ?? '—'} | ${r.schwellwert?.toString() ?? '—'} | ${r.meldung.replace(/\|/g, '\\|')} |`,
      );
    }
    lines.push('');

    const passed = results.filter((r) => r.status === 'PASSED').length;
    const warnung = results.filter((r) => r.status === 'WARNUNG').length;
    const kritisch = results.filter((r) => r.status === 'KRITISCH').length;
    lines.push(`**Zusammenfassung:** ${passed} PASSED, ${warnung} WARNUNG, ${kritisch} KRITISCH`);
    lines.push('');

    if (notizen.length > 0) {
      lines.push('## WP-Notizen');
      lines.push('');
      for (const n of notizen) {
        lines.push(`- **${n.status}** (${n.createdAt.toISOString()}): ${n.notizText.replace(/\n/g, ' ')}`);
      }
      lines.push('');
    }

    if (pruefung.zusammenfassung) {
      lines.push('## WP-Zusammenfassung');
      lines.push('');
      lines.push(pruefung.zusammenfassung);
      lines.push('');
    }

    return lines.join('\n');
  }
}

export type { WPPruefungStatus };