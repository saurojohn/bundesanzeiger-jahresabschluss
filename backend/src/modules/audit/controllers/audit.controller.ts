import {
  Controller,
  Get,
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
  constructor(private readonly auditService: AuditService) {}

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
  ): Promise<{
    items: Array<{
      id: string;
      userId: string | null;
      mandantId: string | null;
      action: string;
      entityType: string;
      entityId: string | null;
      createdAt: Date;
    }>;
    total: number;
    page: number;
    pageSize: number;
  }> {
    let effectiveMandantId = mandantId;
    if (user.globalRole !== 'SYSTEM_ADMIN') {
      const allowedMandantIds = user.mandanten.map((m) => m.id);
      if (!mandantId || !allowedMandantIds.includes(mandantId)) {
        effectiveMandantId = allowedMandantIds[0];
      }
    }

    const page = pageRaw ? Number.parseInt(pageRaw, 10) : 1;
    const pageSize = pageSizeRaw ? Number.parseInt(pageSizeRaw, 10) : 50;

    const validAction: AuditActionLiteral | undefined = action && isAuditAction(action) ? action : undefined;
    const result = await this.auditService.findAll({
      mandantId: effectiveMandantId,
      entityType,
      action: validAction,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      page,
      pageSize,
    });
    return { ...result, page, pageSize };
  }
}
