import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
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
}

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

  constructor(private readonly prisma: PrismaService) {}

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
   * Paginiert Audit-Logs nach Filter.
   */
  async findAll(filter: AuditFilterParams): Promise<{
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
  }> {
    const page = filter.page ?? 1;
    const pageSize = Math.min(filter.pageSize ?? 50, 500);
    const skip = (page - 1) * pageSize;

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

    return { items, total };
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
