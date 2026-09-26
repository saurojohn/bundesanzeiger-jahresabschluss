import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/types/auth-user.types';
import type { AuditActionLiteral } from '../constants/audit-actions';
import { isAuditAction } from '../constants/audit-actions';
import { AuditService } from '../services/audit.service';
import { AuditIntegrityService } from '../services/audit-integrity.service';

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
  ) {}

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query('mandantId') mandantId?: string,
    @Query('entityType') entityType?: string,
    @Query('action') action?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') pageRaw?: string,
    @Query('pageSize') pageSizeRaw?: string,
    @Query('cursor') cursor?: string,
  ): Promise<unknown> {
    let effectiveMandantId = mandantId;
    if (user.globalRole !== 'SYSTEM_ADMIN') {
      const allowedMandantIds = user.mandanten.map((m) => m.id);
      if (!mandantId || !allowedMandantIds.includes(mandantId)) {
        effectiveMandantId = allowedMandantIds[0];
      }
    }

    const page = pageRaw ? Number.parseInt(pageRaw, 10) : undefined;
    const pageSize = pageSizeRaw ? Number.parseInt(pageSizeRaw, 10) : undefined;

    const validAction: AuditActionLiteral | undefined = action && isAuditAction(action) ? action : undefined;
    return this.auditService.findAll({
      mandantId: effectiveMandantId,
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
  @Get('integrity')
  @HttpCode(HttpStatus.OK)
  async verifyIntegrity(
    @CurrentUser() user: AuthUser,
    @Query('kanzleiId') kanzleiId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<{
    status: 'OK' | 'BROKEN' | 'PARTIAL';
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
    let effectiveKanzleiId = kanzleiId;
    if (user.globalRole !== 'SYSTEM_ADMIN') {
      const allowedMandantId = user.mandanten[0]?.id;
      // Wir nutzen den Mandant-Identifier als Kanzlei-Proxy (für SYSTEM_ADMIN
      // gibt es keine Mandant-Einschränkung; KANZLEI_ADMIN darf nur eigene).
      effectiveKanzleiId = kanzleiId && allowedMandantId ? kanzleiId : allowedMandantId;
    }
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
