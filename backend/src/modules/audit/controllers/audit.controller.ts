import {
  Controller,
  Get,
  HttpCode,
  ForbiddenException,
  HttpStatus,
  NotFoundException,
  Query,
  UseGuards,
} from '@nestjs/common';
import { MandantIdOptional } from '../../auth/decorators/mandant-id.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/types/auth-user.types';
import type { AuditActionLiteral } from '../constants/audit-actions';
import { isAuditAction } from '../constants/audit-actions';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../services/audit.service';
import { AuditIntegrityService } from '../services/audit-integrity.service';
import { auditFromPipe, auditToPipe } from '../../../common/pipes/query-pipes';

/**
 * Audit-Read-Endpoint.
 *
 * Lesezugriff auf den Audit-Trail beschränkt auf:
 *   - KANZLEI_ADMIN (über alle Mandanten der eigenen Kanzlei),
 *   - WIRTSCHAFTSPRUEFER,
 *   - SYSTEM_ADMIN.
 */
@Controller('audit')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('KANZLEI_ADMIN', 'WIRTSCHAFTSPRUEFER', 'SYSTEM_ADMIN')
export class AuditController {
  constructor(
    private readonly auditService: AuditService,
    private readonly integrityService: AuditIntegrityService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @MandantIdOptional() mandantId?: string,
    @Query('entityType') entityType?: string,
    @Query('action') action?: string,
    @Query('from', auditFromPipe) from?: Date,
    @Query('to', auditToPipe) to?: Date,
    @Query('page') pageRaw?: string,
    @Query('pageSize') pageSizeRaw?: string,
    @Query('cursor') cursor?: string,
  ): Promise<unknown> {
    // BEFUND 2026-10-12: `effectiveMandantId = allowedMandantIds[0]`
    // war an zwei Stellen falsch.
    //
    // 1. Ein User mit MEHREREN Mandanten sah still nur das erste. Live
    //    gemessen: kanzlei-admin hat 3 Mandanten, die Audit-Liste
    //    enthalt Einträge zu genau 1 — HTTP 200, kein Hinweis. Für das
    //    Audit-Trail ist eine unbeabsichtigte Auslassung fast so schlimm
    //    wie ein fremder Eintrag: der Anwender glaubt, alles zu sehen.
    // 2. Ein User ganz OHNE Mandant bekam `undefined` — und
    //    `buildWhere` liest einen fehlenden Filter als "kein Filter".
    //    Dass heute ein Guard davor 403 wirft, ist Zufall des Aufrufs,
    //    nicht Absicht. Kontext als Schutz ist keine Absicherung.
    //
    //    Jetzt: alle eigenen Mandanten, und ein leerer Zugang wird
    //    ausdrücklich verweigert.
    let effectiveMandantIds: string[] | undefined;
    let effectiveMandantId: string | undefined;
    if (user.globalRole === 'SYSTEM_ADMIN') {
      effectiveMandantId = mandantId;
    } else {
      const allowedMandantIds = user.mandanten.map((m) => m.id);
      if (allowedMandantIds.length === 0) {
        throw new ForbiddenException(
          'Kein Mandant zugänglich — für Sie liegen keine Audit-Einträge vor.',
        );
      }
      // Ein Nicht-Admin bekommt IMMER einen Filter. Auch dann, wenn er
      // gezielt nach einem seiner Mandanten fragt — sonst blieben beide
      // Felder leer und `buildWhere` lieferte "kein Filter".
      //
      // (Der erste Entwurf dieses Fixes hatte genau diesen Fehler: bei
      // erlaubter mandantId blieb `effectiveMandantIds` undefined. Der
      // Test dafür hat es sofort gefangen.)
      effectiveMandantIds =
        mandantId && allowedMandantIds.includes(mandantId)
          ? [mandantId]
          : allowedMandantIds;
    }

    const page = pageRaw ? Number.parseInt(pageRaw, 10) : undefined;
    const pageSize = pageSizeRaw ? Number.parseInt(pageSizeRaw, 10) : undefined;

    const validAction: AuditActionLiteral | undefined = action && isAuditAction(action) ? action : undefined;
    return this.auditService.findAll({
      mandantId: effectiveMandantId,
      mandantIds: effectiveMandantIds,
      entityType,
      action: validAction,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      page,
      pageSize,
      cursor,
    });
  }

  /**
   * Hash-Chain-Integritäts-Verifikation (M4 Sprint 5).
   *
   * Scannt alle Audit-Einträge (optional gefiltert) und prüft ob die
   * Hash-Chain konsistent ist. Liefert Status:
   *
   *   - OK      — alle Einträge haben gültige Hash-Chain
   *   - BROKEN  — Manipulation erkannt (liefert brokenAt mit Details)
   *   - PARTIAL — Schema-Migration noch nicht gelaufen (Einträge ohne Hash)
   *
   * Für GoBD-Audit: typischer Aufruf mit from=YYYY-01-01&to=YYYY-12-31
   * liefert den Hash-Chain-Status für ein Geschäftsjahr.
   *
   * Performance: linear zur Anzahl Audit-Einträge — bei 100k Einträgen
   * ca. 5-10 Sekunden. Nicht für Real-Time-UI geeignet; nur On-Demand
   * via Wirtschaftsprüfer-Tool oder GoBD-Audit-Job.
   */
  /**
   * Ermittelt die Kanzlei-IDs, für die der User die Integrität prüfen darf.
   *
   * Bugfix 2026-10-05: `user.mandanten` enthält MANDANT-UUIDs, keine
   * Kanzlei-UUIDs. Der Controller hat daraus früher direkt eine "kanzleiId"
   * gebaut — gefiltert wurde dann nach einer UUID, die keiner Kanzlei
   * entspricht. Die Prüfung fand 0 Einträge und meldete `status: "OK"`.
   *
   * SYSTEM_ADMIN darf jede Kanzlei, alle anderen nur diejenigen, in denen
   * sie einen Mandanten haben. Ein explizit angefragter `kanzleiId` wird nur
   * übernommen, wenn er in dieser Menge liegt.
   */
  private async resolveKanzleiIds(
    user: AuthUser,
    angefragt?: string,
  ): Promise<string[]> {
    if (user.globalRole === 'SYSTEM_ADMIN') {
      return angefragt ? [angefragt] : await this.prisma.kanzlei.findMany({
        select: { id: true },
        orderBy: { id: 'asc' },
      }).then((ks) => ks.map((k) => k.id));
    }

    const mandanten = await this.prisma.mandant.findMany({
      where: { id: { in: user.mandanten.map((m) => m.id) } },
      select: { kanzleiId: true },
      orderBy: { kanzleiId: 'asc' },
    });
    const ids = [...new Set(mandanten.map((m) => m.kanzleiId))].filter(
      (id): id is string => typeof id === 'string',
    );
    if (angefragt) {
      return ids.includes(angefragt) ? [angefragt] : [];
    }
    return ids;
  }

  @Get('integrity')
  @HttpCode(HttpStatus.OK)
  async verifyIntegrity(
    @CurrentUser() user: AuthUser,
    @Query('kanzleiId') kanzleiId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<{
    status: 'OK' | 'BROKEN' | 'PARTIAL' | 'NO_ENTRIES';
    entriesChecked: number;
    brokenAt?: { auditLogId: string; expectedHash: string; actualHash: string };
    oldestUnhashedEntry?: string;
    kanzleiId?: string;
    verifiedBy: string;
    verifiedAt: string;
  }> {
    // Non-SYSTEM_ADMIN: auf eigene Kanzlei einschränken.
    // user.mandanten hat nur Mandant-IDs (kein kanzleiId-Feld), daher
    // schränken wir die Verifikation auf den ersten verfügbaren Mandant
    // ein. SYSTEM_ADMIN darf jede Kanzlei-ID prüfen.
    // Bugfix 2026-10-05: Hier stand `user.mandanten[0].id` — eine MANDANT-UUID
    // an der Stelle einer kanzleiId. Dieselbe Verwechslung wie im Branding-
    // Service, nur mit umgekehrter Folge: statt zu viel freizugeben, wurde
    // nach einer UUID gefiltert, die nie eine Kanzlei ist. Ergebnis: 0
    // Einträge, `status: "OK"` — die Integritätsprüfung war für jeden
    // Nicht-SYSTEM_ADMIN wirkungslos und meldete dabei „intakt".
    const kanzleiIds = await this.resolveKanzleiIds(user, kanzleiId);

    // BEFUND 2026-10-11: `resolveKanzleiIds` liefert für einen Nicht-Admin
    // ein LEERES Array, wenn eine fremde `kanzleiId` angefragt wurde. Aus
    // `kanzleiIds[0]` wurde dann `undefined`, und `verifyIntegrity` setzt
    // den Filter nur, wenn `kanzleiId` gesetzt ist:
    //
    //     if (args?.kanzleiId) where['kanzleiId'] = args.kanzleiId;
    //
    // Die Prüfung lief also über ALLE Audit-Einträge aller Mandanten.
    // Live gemessen: die Antwort meldete `kanzleiId: (keiner)` bei
    // `entriesChecked: 27` — die Kette wird über fremde Einträge
    // bewertet, und `brokenAt.auditLogId` sowie `oldestUnhashedEntry`
    // werden daraus gebildet.
    //
    // Fail-closed: eine leere Auflösung ist kein "prüfe alles", sondern
    // "zugriff verweigert". Das gilt auch für einen Nutzer ganz ohne
    // Mandanten — für ihn gibt es nichts zu prüfen.
    if (kanzleiIds.length === 0) {
      throw new NotFoundException(
        'Keine Kanzlei für die Integritätsprüfung zugänglich.',
      );
    }

    const effectiveKanzleiId = kanzleiIds[0];
    const result = await this.integrityService.verifyIntegrity({
      kanzleiId: effectiveKanzleiId,
      fromDate: from ? new Date(from) : undefined,
      toDate: to ? new Date(to) : undefined,
    });
    return {
      ...result,
      kanzleiId: effectiveKanzleiId,
      verifiedBy: user.id,
      verifiedAt: new Date().toISOString(),
    };
  }
}
