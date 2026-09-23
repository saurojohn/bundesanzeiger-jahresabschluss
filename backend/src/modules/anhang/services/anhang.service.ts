import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AnhangRepository, type AnhangEntity } from '../../../common/repositories/anhang.repository';
import { AuditService } from '../../audit/services/audit.service';
import type { AuthUser } from '../../auth/types/auth-user.types';
import {
  ANHANG_TEMPLATE_ABSCHNITTE,
} from '../constants/anhang.constants';
import { CreateAnhangDto } from '../dto/create-anhang.dto';
import { UpdateAnhangDto } from '../dto/update-anhang.dto';

export interface AnhangServiceContext {
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Service für Anhang (§ 284-289 HGB).
 */
@Injectable()
export class AnhangService {
  private readonly logger = new Logger(AnhangService.name);

  constructor(
    private readonly anhangRepository: AnhangRepository,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Liefert die Standard-Abschnitts-Templates (für GET /api/anhang/templates).
   */
  getTemplateAbschnitte() {
    return ANHANG_TEMPLATE_ABSCHNITTE;
  }

  async create(
    dto: CreateAnhangDto,
    user: AuthUser,
    context: AnhangServiceContext,
  ): Promise<AnhangEntity> {
    this.assertMandantAccess(dto.mandantId, user);

    let anhang: AnhangEntity;
    try {
      anhang = await this.anhangRepository.createWithAbschnitte({
        mandantId: dto.mandantId,
        geschaeftsjahr: dto.geschaeftsjahr,
        bilanzierungsMethoden: dto.bilanzierungsMethoden ?? null,
        bewertungsMethoden: dto.bewertungsMethoden ?? null,
        sonstigePflichtangaben: dto.sonstigePflichtangaben ?? null,
        createdById: user.id,
        abschnitte: dto.abschnitte ?? [],
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new BadRequestException(
          `Für diesen Mandanten existiert bereits ein Anhang für das Geschäftsjahr ${dto.geschaeftsjahr}.`,
        );
      }
      throw err;
    }

    void this.auditService.record({
      userId: user.id,
      mandantId: dto.mandantId,
      action: 'CREATE',
      entityType: 'Anhang',
      entityId: anhang.id,
      newState: this.toAuditDto(anhang),
      ipAddress: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return anhang;
  }

  async findAll(mandantId: string, user: AuthUser, jahr?: number) {
    this.assertMandantAccess(mandantId, user);
    return this.anhangRepository.findByMandantAndJahrWithWorm(mandantId, jahr);
  }

  async findOne(
    id: string,
    mandantId: string,
    user: AuthUser,
  ): Promise<AnhangEntity> {
    this.assertMandantAccess(mandantId, user);
    const anhang = await this.anhangRepository.findWithAbschnitte(id, mandantId);
    if (!anhang) throw new NotFoundException('Anhang nicht gefunden');
    return anhang;
  }

  async update(
    id: string,
    mandantId: string,
    dto: UpdateAnhangDto,
    user: AuthUser,
    context: AnhangServiceContext,
  ): Promise<AnhangEntity> {
    this.assertMandantAccess(mandantId, user);

    const previous = await this.anhangRepository.findWithAbschnitte(id, mandantId);
    if (!previous) throw new NotFoundException('Anhang nicht gefunden');
    if (previous.status !== 'DRAFT' && dto.abschnitte !== undefined) {
      throw new BadRequestException(
        'Abschnitte können nur in DRAFT-Phase geändert werden',
      );
    }

    const updated = await this.anhangRepository.updateWithAbschnitte(id, mandantId, {
      status: dto.status ?? undefined,
      bilanzierungsMethoden: dto.bilanzierungsMethoden ?? undefined,
      bewertungsMethoden: dto.bewertungsMethoden ?? undefined,
      sonstigePflichtangaben: dto.sonstigePflichtangaben ?? undefined,
      updatedById: user.id,
      abschnitte: dto.abschnitte,
    });

    void this.auditService.record({
      userId: user.id,
      mandantId,
      action: 'UPDATE',
      entityType: 'Anhang',
      entityId: id,
      previousState: this.toAuditDto(previous),
      newState: this.toAuditDto(updated),
      ipAddress: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return updated;
  }

  async delete(
    id: string,
    mandantId: string,
    user: AuthUser,
    context: AnhangServiceContext,
  ): Promise<void> {
    this.assertMandantAccess(mandantId, user);

    const existing = await this.anhangRepository.findById(id, mandantId);
    if (!existing) throw new NotFoundException('Anhang nicht gefunden');
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException(
        'Löschung nur in der DRAFT-Phase erlaubt.',
      );
    }

    const before = await this.anhangRepository.findWithAbschnitte(id, mandantId);
    await this.anhangRepository.deleteByMandant(id, mandantId);

    void this.auditService.record({
      userId: user.id,
      mandantId,
      action: 'DELETE',
      entityType: 'Anhang',
      entityId: id,
      previousState: before ? this.toAuditDto(before) : null,
      ipAddress: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  private assertMandantAccess(mandantId: string, user: AuthUser): void {
    if (user.globalRole === 'SYSTEM_ADMIN') return;
    const accessibleMandantIds = user.mandanten.map((m) => m.id);
    if (!accessibleMandantIds.includes(mandantId)) {
      throw new ForbiddenException('Kein Zugriff auf diesen Mandanten');
    }
  }

  private toAuditDto(anhang: AnhangEntity): Prisma.JsonValue {
    return {
      id: anhang.id,
      mandantId: anhang.mandantId,
      geschaeftsjahr: anhang.geschaeftsjahr,
      status: anhang.status,
      bilanzierungsMethoden: anhang.bilanzierungsMethoden,
      bewertungsMethoden: anhang.bewertungsMethoden,
      sonstigePflichtangaben: anhang.sonstigePflichtangaben,
      createdById: anhang.createdById,
      updatedById: anhang.updatedById,
      createdAt: anhang.createdAt,
      updatedAt: anhang.updatedAt,
      abschnitte: anhang.abschnitte.map((a) => ({
        id: a.id,
        titel: a.titel,
        inhalt: a.inhalt,
        reihenfolge: a.reihenfolge,
      })),
    } as unknown as Prisma.JsonValue;
  }
}