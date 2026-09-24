import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaginationService } from '../../../common/services/pagination.service';
import { type PaginatedResult } from '../../../common/dto/pagination.dto';
import { AuditService } from '../../audit/services/audit.service';
import type { AuthUser } from '../../auth/types/auth-user.types';
import { WP_NOTIZ_ACK_STATUS, type WPNotizStatus } from '../constants/wp-status.constants';
import type { WPNotizEntity } from '../wp.repository';
import { WPRepository } from '../wp.repository';

export interface WPNotizServiceContext {
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Service: WP-Notizen (Anmerkungen des Wirtschaftsprüfers).
 *
 * RBAC:
 *   - createNotiz:   nur User mit Mandantrolle WIRTSCHAFTSPRUEFER
 *   - updateStatus:  jeder authentifizierte User mit Mandant-Zugriff;
 *                    Self-Acknowledgement (wpUserId == userId) ist verboten
 *   - listNotizen:   jeder authentifizierte User mit Mandant-Zugriff
 *
 * Self-Acknowledgement-Schutz gemäß IDW PS 880 (4-Augen-Prinzip):
 * Der Wirtschaftsprüfer kann seine eigenen Notizen nicht APPROVEN/REJECTEN.
 */
@Injectable()
export class WPNotizService {
  private readonly logger = new Logger(WPNotizService.name);

  constructor(
    private readonly wpRepository: WPRepository,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Erstellt eine WP-Notiz. Nur User mit WIRTSCHAFTSPRUEFER-Rolle.
   *
   * Validierung:
   *   - genau einer der optionalen IDs (bilanzId / guvId / bilanzPositionId /
   *     guvPositionId) muss gesetzt sein
   *   - Mandant-Zugriff
   */
  async createNotiz(
    args: {
      bilanzId?: string;
      guvId?: string;
      bilanzPositionId?: string;
      guvPositionId?: string;
      notizText: string;
    },
    user: AuthUser,
    context: WPNotizServiceContext,
  ): Promise<WPNotizEntity> {
    this.assertWirtschaftsPrueferRole(user);

    const targets = [
      args.bilanzId,
      args.guvId,
      args.bilanzPositionId,
      args.guvPositionId,
    ].filter((x): x is string => typeof x === 'string');
    if (targets.length !== 1) {
      throw new BadRequestException(
        'Genau eine Referenz (bilanzId, guvId, bilanzPositionId oder guvPositionId) muss gesetzt sein',
      );
    }

    let mandantId: string | null = null;
    if (args.bilanzId) {
      mandantId = await this.wpRepository.findBilanzMandantId(args.bilanzId);
    } else if (args.guvId) {
      mandantId = await this.wpRepository.findGuVMandantId(args.guvId);
    } else if (args.bilanzPositionId) {
      const pos = await this.wpRepository.findBilanzMandantIdByPositionId(args.bilanzPositionId);
      mandantId = pos;
    } else if (args.guvPositionId) {
      const pos = await this.wpRepository.findGuVMandantIdByPositionId(args.guvPositionId);
      mandantId = pos;
    }

    if (!mandantId) {
      throw new NotFoundException('Referenzierte Bilanz/GuV/Position nicht gefunden');
    }
    this.assertMandantAccess(mandantId, user);

    const notiz = await this.wpRepository.createNotiz({
      bilanzId: args.bilanzId ?? null,
      guvId: args.guvId ?? null,
      bilanzPositionId: args.bilanzPositionId ?? null,
      guvPositionId: args.guvPositionId ?? null,
      wpUserId: user.id,
      notizText: args.notizText,
    });

    void this.auditService.record({
      userId: user.id,
      mandantId,
      action: 'CREATE',
      entityType: 'WPNotiz',
      entityId: notiz.id,
      newState: this.toAuditDto(notiz),
      ipAddress: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return notiz;
  }

  /**
   * Setzt Notiz-Status auf APPROVED / REJECTED / NEEDS_REVISION.
   *
   * Self-Acknowledgement: der Ersteller der Notiz (`wpUserId`) darf
   * seinen eigenen Eintrag nicht bestätigen.
   */
  async updateStatus(
    notizId: string,
    newStatus: WPNotizStatus,
    user: AuthUser,
    context: WPNotizServiceContext,
  ): Promise<WPNotizEntity> {
    if (!WP_NOTIZ_ACK_STATUS.includes(newStatus)) {
      throw new BadRequestException(
        `Ungültiger Status. Erlaubt: ${WP_NOTIZ_ACK_STATUS.join(', ')}`,
      );
    }

    const existing = await this.wpRepository.findNotizById(notizId);
    if (!existing) {
      throw new NotFoundException('WP-Notiz nicht gefunden');
    }

    const mandantId = await this.resolveMandantIdForNotiz(existing);
    if (!mandantId) {
      throw new NotFoundException('Mandant für WP-Notiz nicht auflösbar');
    }
    this.assertMandantAccess(mandantId, user);

    // 4-Augen-Prinzip: Self-Acknowledgement ist verboten.
    if (existing.wpUserId === user.id) {
      throw new ForbiddenException(
        'Self-Acknowledgement verboten: eine WP-Notiz kann nicht vom Ersteller selbst bestätigt werden',
      );
    }

    const updated = await this.wpRepository.updateNotizStatus(
      notizId,
      newStatus,
      user.id,
    );

    void this.auditService.record({
      userId: user.id,
      mandantId,
      action: 'UPDATE',
      entityType: 'WPNotiz',
      entityId: notizId,
      previousState: this.toAuditDto(existing),
      newState: this.toAuditDto(updated),
      ipAddress: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return updated;
  }

  /**
   * Liste Notizen für eine Bilanz / GuV (mandant-gefiltert).
   *
   * Optionale Cursor-Pagination via `cursor` + `pageSize`.
   * Ohne diese Parameter liefert die Methode weiterhin ein Array
   * (Backwards-Compat) — intern via `findNotizenPaginated` mit
   * sehr hohem Limit (= effektiv alle).
   */
  async listNotizen(
    args: {
      bilanzId?: string;
      guvId?: string;
      status?: WPNotizStatus;
      cursor?: string;
      pageSize?: number;
    },
    user: AuthUser,
  ): Promise<WPNotizEntity[] | PaginatedResult<WPNotizEntity>> {
    if (!args.bilanzId && !args.guvId) {
      throw new BadRequestException(
        'Mindestens bilanzId oder guvId muss gesetzt sein',
      );
    }

    if (args.bilanzId) {
      const mandantId = await this.wpRepository.findBilanzMandantId(args.bilanzId);
      if (!mandantId) {
        throw new NotFoundException('Bilanz nicht gefunden');
      }
      this.assertMandantAccess(mandantId, user);
    }

    if (args.guvId) {
      const mandantId = await this.wpRepository.findGuVMandantId(args.guvId);
      if (!mandantId) {
        throw new NotFoundException('GuV nicht gefunden');
      }
      this.assertMandantAccess(mandantId, user);
    }

    // Modern: Cursor-Pagination
    if (args.cursor !== undefined || args.pageSize !== undefined) {
      const pageSize = Math.min(args.pageSize ?? 20, 100);
      const [items, total] = await Promise.all([
        this.wpRepository.findNotizenPaginated({
          bilanzId: args.bilanzId,
          guvId: args.guvId,
          status: args.status,
          cursor: args.cursor,
          pageSize,
        }),
        this.wpRepository.countNotizen({
          bilanzId: args.bilanzId,
          guvId: args.guvId,
          status: args.status,
        }),
      ]);
      return PaginationService.buildResponse(
        items,
        total,
        pageSize,
        (item) => item.createdAt.toISOString(),
      );
    }

    // Legacy: alle Notizen (typischerweise < 20 pro Bilanz)
    return this.wpRepository.findNotizen({
      bilanzId: args.bilanzId,
      guvId: args.guvId,
      status: args.status,
    });
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
        'Nur Wirtschaftsprüfer dürfen WP-Notizen erstellen',
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

  private async resolveMandantIdForNotiz(
    notiz: WPNotizEntity,
  ): Promise<string | null> {
    if (notiz.bilanzId) {
      return this.wpRepository.findBilanzMandantId(notiz.bilanzId);
    }
    if (notiz.guvId) {
      return this.wpRepository.findGuVMandantId(notiz.guvId);
    }
    if (notiz.bilanzPositionId) {
      return this.wpRepository.findBilanzMandantIdByPositionId(notiz.bilanzPositionId);
    }
    if (notiz.guvPositionId) {
      return this.wpRepository.findGuVMandantIdByPositionId(notiz.guvPositionId);
    }
    return null;
  }

  private toAuditDto(notiz: WPNotizEntity): Prisma.JsonValue {
    return {
      id: notiz.id,
      bilanzId: notiz.bilanzId,
      guvId: notiz.guvId,
      bilanzPositionId: notiz.bilanzPositionId,
      guvPositionId: notiz.guvPositionId,
      wpUserId: notiz.wpUserId,
      notizText: notiz.notizText,
      status: notiz.status,
      acknowledgedAt: notiz.acknowledgedAt?.toISOString() ?? null,
      acknowledgedById: notiz.acknowledgedById,
    } as unknown as Prisma.JsonValue;
  }
}