import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  CursorCodec,
  type PaginatedResult,
} from '../../../common/dto/pagination.dto';
import { PaginationService } from '../../../common/services/pagination.service';
import { CacheManagerService } from '../../../common/cache/cache-manager.service';
import type { AuditActionLiteral } from '../constants/audit-actions';

export interface RecordAuditParams {
  userId?: string | null;
  kanzleiId?: string | null;
  mandantId?: string | null;
  jahresabschlussId?: string | null;
  action: AuditActionLiteral;
  entityType: string;
  entityId?: string | null;
  previousState?: Prisma.JsonValue | null;
  newState?: Prisma.JsonValue | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AuditFilterParams {
  kanzleiId?: string;
  mandantId?: string;
  userId?: string;
  entityType?: string;
  entityId?: string;
  action?: AuditActionLiteral;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
  cursor?: string;
}

export interface AuditListItem {
  id: string;
  userId: string | null;
  mandantId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  createdAt: Date;
}

export type AuditPaginatedResult = PaginatedResult<AuditListItem>;

/**
 * Append-only Audit-Trail (GoBD § 147 AO, 10 Jahre Aufbewahrungspflicht).
 *
 * Alle Mutationen werden via `record()` protokolliert. Die Mutations-
 * Reihenfolge wird durch das `createdAt`-Feld abgebildet — eine Reihenfolge-
 * Verletzung ist über den Index `(mandantId, createdAt)` schnell prüfbar.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheManagerService,
  ) {}

  /**
   * Erzeugt einen AuditLog-Eintrag.
   *
   * `previousState` und `newState` werden als JSON persistiert; für
   * sensible Felder (Passwörter, TOTP-Secrets) MUSS der Aufrufer vor der
   * Übergabe sanitizen.
   */
  async record(params: RecordAuditParams): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          kanzleiId: params.kanzleiId ?? null,
          mandantId: params.mandantId ?? null,
          userId: params.userId ?? null,
          jahresabschlussId: params.jahresabschlussId ?? null,
          action: params.action,
          entityType: params.entityType,
          entityId: params.entityId ?? null,
          previousState: (params.previousState ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          newState: (params.newState ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          ipAddress: params.ipAddress ?? null,
          userAgent: params.userAgent ?? null,
        },
      });
      // Cache invalidieren: neue Audit-Einträge → alte Counts veraltet.
      // Fire-and-forget: der CacheManager catcht eigene Fehler intern;
      // wir wollen den AuditWrite-Pfad nicht durch Cache-Latenz
      // verlangsamen.
      if (params.kanzleiId) {
        void this.cache.invalidate(`audit-count:kanzlei:${params.kanzleiId}`);
      }
      if (params.mandantId) {
        void this.cache.invalidate(`audit-count:mandant:${params.mandantId}`);
      }
    } catch (err) {
      // Audit darf nie eine Hauptoperation crashen — loggen, aber werfen.
      this.logger.error(
        `AuditLog write fehlgeschlagen (${String(params.action)}/${params.entityType}): ${
          (err as Error).message
        }`,
      );
    }
  }

  /**
   * Paginiert Audit-Logs nach Filter. Cursor-basiert (M3+) mit
   * Backwards-Compat zu legacy page/pageSize.
   */
  async findAll(filter: AuditFilterParams): Promise<
    | AuditPaginatedResult
    | {
        items: AuditListItem[];
        total: number;
        page: number;
        pageSize: number;
        hasMore: boolean;
      }
  > {
    const where: Prisma.AuditLogWhereInput = this.buildWhere(filter);

    // Legacy: Offset-Pagination (page/pageSize)
    if (!filter.cursor && filter.page !== undefined) {
      return this.findAllLegacy(filter, where);
    }

    // Modern: Cursor-Pagination
    const pageSize = Math.min(filter.pageSize ?? 50, 500);

    if (filter.cursor) {
      const { sortValue } = CursorCodec.decode(filter.cursor);
      const cursorDate = new Date(sortValue);
      if (!Number.isNaN(cursorDate.getTime())) {
        where.OR = [{ createdAt: { lt: cursorDate } }];
      }
    }

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: pageSize + 1,
        select: {
          id: true,
          userId: true,
          mandantId: true,
          action: true,
          entityType: true,
          entityId: true,
          createdAt: true,
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return PaginationService.buildResponse<AuditListItem>(
      items,
      total,
      pageSize,
      (item) => item.createdAt.toISOString(),
    );
  }

  /**
   * Legacy Offset-Pagination (Backwards-Compat).
   */
  private async findAllLegacy(
    filter: AuditFilterParams,
    where: Prisma.AuditLogWhereInput,
  ): Promise<{
    items: AuditListItem[];
    total: number;
    page: number;
    pageSize: number;
    hasMore: boolean;
  }> {
    const page = filter.page ?? 1;
    const pageSize = Math.min(filter.pageSize ?? 50, 500);
    const skip = (page - 1) * pageSize;

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        select: {
          id: true,
          userId: true,
          mandantId: true,
          action: true,
          entityType: true,
          entityId: true,
          createdAt: true,
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return PaginationService.buildLegacyResponse<AuditListItem>(
      items,
      total,
      page,
      pageSize,
    );
  }

  private buildWhere(filter: AuditFilterParams): Prisma.AuditLogWhereInput {
    const where: Prisma.AuditLogWhereInput = {};
    if (filter.kanzleiId) where.kanzleiId = filter.kanzleiId;
    if (filter.mandantId) where.mandantId = filter.mandantId;
    if (filter.userId) where.userId = filter.userId;
    if (filter.entityType) where.entityType = filter.entityType;
    if (filter.entityId) where.entityId = filter.entityId;
    if (filter.action) where.action = filter.action;
    if (filter.from || filter.to) {
      where.createdAt = {};
      if (filter.from) where.createdAt.gte = filter.from;
      if (filter.to) where.createdAt.lte = filter.to;
    }
    return where;
  }

  /**
   * Gecachte Audit-Count-Berechnung (für Dashboard-Übersichten).
   *
   * TTL: 30s — genügt für typische Dashboard-Render-Zyklen.
   */
  async countForMandant(mandantId: string): Promise<number> {
    return this.cache.memoize(
      `audit-count:mandant:${mandantId}`,
      30_000,
      () => this.prisma.auditLog.count({ where: { mandantId } }),
    );
  }

  /**
   * Gecachte Audit-Count-Berechnung pro Kanzlei.
   */
  async countForKanzlei(kanzleiId: string): Promise<number> {
    return this.cache.memoize(
      `audit-count:kanzlei:${kanzleiId}`,
      30_000,
      () => this.prisma.auditLog.count({ where: { kanzleiId } }),
    );
  }

  async findByEntity(
    entityType: string,
    entityId: string,
  ): Promise<Array<{ id: string; action: string; createdAt: Date; userId: string | null }>> {
    return this.prisma.auditLog.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, action: true, createdAt: true, userId: true },
    });
  }

  async findByMandant(
    mandantId: string,
    from?: Date,
    to?: Date,
  ): Promise<Array<{ id: string; action: string; entityType: string; createdAt: Date }>> {
    const where: Prisma.AuditLogWhereInput = { mandantId };
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = from;
      if (to) where.createdAt.lte = to;
    }
    return this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: { id: true, action: true, entityType: true, createdAt: true },
    });
  }
}
