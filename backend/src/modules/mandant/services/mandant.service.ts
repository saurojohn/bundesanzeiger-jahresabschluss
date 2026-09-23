import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Mandant } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/services/audit.service';
import { CreateMandantDto } from '../dto/create-mandant.dto';
import { UpdateMandantDto } from '../dto/update-mandant.dto';
import type { AuthUser } from '../../auth/types/auth-user.types';

export interface MandantContext {
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Mandant-Service.
 *
 * Erzwingt Mandant-Trennung: jeder Lesezugriff prüft, ob der User
 * Zugriff auf den Mandanten hat (entweder über UserMandantRole oder
 * SYSTEM_ADMIN-Berechtigung).
 */
@Injectable()
export class MandantService {
  private readonly logger = new Logger(MandantService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Erstellt einen neuen Mandanten. Der kanzleiId wird aus dem Auth-User
   * gezogen, nicht aus dem DTO (Mandant-Trennung).
   */
  async create(
    dto: CreateMandantDto,
    user: AuthUser,
    context: MandantContext,
  ): Promise<Mandant> {
    if (user.globalRole !== 'SYSTEM_ADMIN' && user.mandanten.length === 0) {
      throw new ForbiddenException(
        'Keine Berechtigung zum Anlegen eines Mandanten',
      );
    }

    const kanzleiId = await this.resolveKanzleiId(user);

    const mandant = await this.prisma.mandant.create({
      data: {
        kanzleiId,
        firmenname: dto.firmenname,
        rechtsform: dto.rechtsform,
        handelsregister: dto.handelsregister ?? null,
        ustId: dto.ustId ?? null,
        adresse: dto.adresse as unknown as Prisma.InputJsonValue,
        geschaeftsfuehrer: dto.geschaeftsfuehrer as unknown as Prisma.InputJsonValue,
        gruendungsdatum: dto.gruendungsdatum ? new Date(dto.gruendungsdatum) : null,
        bilanzsummeVorjahr: dto.bilanzsummeVorjahr ?? null,
        umsatzVorjahr: dto.umsatzVorjahr ?? null,
        mitarbeiterAnzahl: dto.mitarbeiterAnzahl ?? null,
        groessenklasse: dto.groessenklasse,
        publishChannel: dto.publishChannel,
      },
    });

    void this.auditService.record({
      userId: user.id,
      kanzleiId: mandant.kanzleiId,
      mandantId: mandant.id,
      action: 'CREATE',
      entityType: 'Mandant',
      entityId: mandant.id,
      newState: this.toAuditDto(mandant),
      ipAddress: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return mandant;
  }

  /**
   * Liste aller Mandanten, auf die der User Zugriff hat.
   *
   * SYSTEM_ADMIN sieht alle Mandanten der Kanzlei (eigentlich sogar
   * kanzlei-übergreifend, aber hier auf die Kanlei des ersten
   * Mandanten beschränkt).
   */
  async findAll(user: AuthUser): Promise<Mandant[]> {
    if (user.globalRole === 'SYSTEM_ADMIN') {
      // Plattform-Admin sieht alle Mandanten.
      return this.prisma.mandant.findMany({ orderBy: { firmenname: 'asc' } });
    }
    const accessibleMandantIds = user.mandanten.map((m) => m.id);
    if (accessibleMandantIds.length === 0) return [];
    return this.prisma.mandant.findMany({
      where: { id: { in: accessibleMandantIds } },
      orderBy: { firmenname: 'asc' },
    });
  }

  /**
   * Einzelner Mandant mit Zugriffsprüfung.
   */
  async findOne(id: string, user: AuthUser): Promise<Mandant> {
    this.assertMandantAccess(id, user);
    const mandant = await this.prisma.mandant.findUnique({ where: { id } });
    if (!mandant) throw new NotFoundException('Mandant nicht gefunden');
    return mandant;
  }

  /**
   * Aktualisiert einen Mandanten. Schreibt previousState + newState in den
   * AuditTrail.
   */
  async update(
    id: string,
    dto: UpdateMandantDto,
    user: AuthUser,
    context: MandantContext,
  ): Promise<Mandant> {
    this.assertMandantAccess(id, user);
    const before = await this.prisma.mandant.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Mandant nicht gefunden');

    const updated = await this.prisma.mandant.update({
      where: { id },
      data: {
        firmenname: dto.firmenname ?? undefined,
        rechtsform: dto.rechtsform ?? undefined,
        handelsregister: dto.handelsregister ?? undefined,
        ustId: dto.ustId ?? undefined,
        adresse: dto.adresse as Prisma.InputJsonValue | undefined,
        geschaeftsfuehrer: dto.geschaeftsfuehrer as unknown as Prisma.InputJsonValue | undefined,
        gruendungsdatum: dto.gruendungsdatum ? new Date(dto.gruendungsdatum) : undefined,
        bilanzsummeVorjahr: dto.bilanzsummeVorjahr ?? undefined,
        umsatzVorjahr: dto.umsatzVorjahr ?? undefined,
        mitarbeiterAnzahl: dto.mitarbeiterAnzahl ?? undefined,
        groessenklasse: dto.groessenklasse ?? undefined,
        publishChannel: dto.publishChannel ?? undefined,
      },
    });

    void this.auditService.record({
      userId: user.id,
      kanzleiId: updated.kanzleiId,
      mandantId: updated.id,
      action: 'UPDATE',
      entityType: 'Mandant',
      entityId: updated.id,
      previousState: this.toAuditDto(before),
      newState: this.toAuditDto(updated),
      ipAddress: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return updated;
  }

  /**
   * Löscht einen Mandanten. Nur KANZLEI_ADMIN oder SYSTEM_ADMIN.
   */
  async delete(id: string, user: AuthUser, context: MandantContext): Promise<void> {
    this.assertMandantAccess(id, user);
    if (user.globalRole !== 'SYSTEM_ADMIN') {
      const isKanzleiAdmin = user.mandanten.some((m) => m.rolle === 'KANZLEI_ADMIN');
      if (!isKanzleiAdmin) {
        throw new ForbiddenException('Nur KANZLEI_ADMIN darf Mandanten löschen');
      }
    }
    const before = await this.prisma.mandant.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Mandant nicht gefunden');

    await this.prisma.mandant.delete({ where: { id } });

    void this.auditService.record({
      userId: user.id,
      kanzleiId: before.kanzleiId,
      mandantId: before.id,
      action: 'DELETE',
      entityType: 'Mandant',
      entityId: before.id,
      previousState: this.toAuditDto(before),
      ipAddress: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });
  }

  /**
   * Hilfsfunktion: Liste der zugänglichen Mandanten-IDs (für Filter).
   */
  async getMandantenAccessibleByUser(userId: string): Promise<
    Array<{ id: string; firmenname: string }>
  > {
    const roles = await this.prisma.userMandantRole.findMany({
      where: { userId, revokedAt: null },
      include: { mandant: { select: { id: true, firmenname: true } } },
    });
    return roles.map((r) => ({
      id: r.mandant.id,
      firmenname: r.mandant.firmenname,
    }));
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

  private async resolveKanzleiId(user: AuthUser): Promise<string> {
    // SYSTEM_ADMIN darf jede Kanzlei adressieren — Fallback auf erste
    // bestehende Kanzlei (Demo-Modus).
    if (user.globalRole === 'SYSTEM_ADMIN') {
      const firstKanzlei = await this.prisma.kanzlei.findFirst({
        select: { id: true },
      });
      if (firstKanzlei) return firstKanzlei.id;
      throw new NotFoundException('Keine Kanzlei vorhanden — Demo-Daten anlegen');
    }
    // Non-Admin: kanzleiId kommt implizit aus dem ersten zugänglichen
    // Mandanten — Mandanten gehören zu genau 1 Kanzlei.
    const firstAccessibleMandantId = user.mandanten[0]?.id;
    if (!firstAccessibleMandantId) {
      throw new ForbiddenException('Kein zugänglicher Mandant vorhanden');
    }
    const mandant = await this.prisma.mandant.findUnique({
      where: { id: firstAccessibleMandantId },
      select: { kanzleiId: true },
    });
    if (!mandant) throw new NotFoundException('Mandant nicht gefunden');
    return mandant.kanzleiId;
  }

  private toAuditDto(m: Mandant): Prisma.JsonValue {
    const dto = {
      id: m.id,
      kanzleiId: m.kanzleiId,
      firmenname: m.firmenname,
      rechtsform: m.rechtsform,
      handelsregister: m.handelsregister,
      ustId: m.ustId,
      adresse: m.adresse,
      geschaeftsfuehrer: m.geschaeftsfuehrer,
      gruendungsdatum: m.gruendungsdatum,
      bilanzsummeVorjahr: m.bilanzsummeVorjahr?.toString() ?? null,
      umsatzVorjahr: m.umsatzVorjahr?.toString() ?? null,
      mitarbeiterAnzahl: m.mitarbeiterAnzahl,
      groessenklasse: m.groessenklasse,
      publishChannel: m.publishChannel,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
    };
    return dto as unknown as Prisma.JsonValue;
  }
}
