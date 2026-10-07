import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CursorCodec } from '../../common/dto/pagination.dto';

/**
 * Repository für WP-spezifische Persistenz.
 *
 * Mandant-Trennung: alle Methoden, die eine Bilanz/GuV betreffen,
 * filtern explizit über `mandantId`. Notizen werden über die
 * mandantId der verknüpften Bilanz/GuV gefiltert (Service prüft das).
 *
 * Direkter Prisma-Zugriff ist hier erlaubt (Mandant-Trennung via Filter).
 */

export type WPNotizEntity = Prisma.WPNotizGetPayload<Record<string, never>>;
export type BilanzPruefungsResultEntity = Prisma.BilanzPruefungsResultGetPayload<
  Record<string, never>
>;
export type WPPruefungsAbschlussEntity = Prisma.WPPruefungsAbschlussGetPayload<
  Record<string, never>
>;
export type PruefungsRegelEntity = Prisma.PruefungsRegelGetPayload<
  Record<string, never>
>;

@Injectable()
export class WPRepository {
  constructor(private readonly prisma: PrismaService) {}

  static readonly entityName = 'WP';

  // ---------------------------------------------------------------------------
  // WPNotiz
  // ---------------------------------------------------------------------------

  async createNotiz(input: {
    bilanzId?: string | null;
    guvId?: string | null;
    bilanzPositionId?: string | null;
    guvPositionId?: string | null;
    wpUserId: string;
    notizText: string;
  }): Promise<WPNotizEntity> {
    return this.prisma.wPNotiz.create({
      data: {
        bilanzId: input.bilanzId ?? null,
        guvId: input.guvId ?? null,
        bilanzPositionId: input.bilanzPositionId ?? null,
        guvPositionId: input.guvPositionId ?? null,
        wpUserId: input.wpUserId,
        notizText: input.notizText,
        status: 'PENDING',
      },
    });
  }

  async findNotizById(id: string): Promise<WPNotizEntity | null> {
    return this.prisma.wPNotiz.findFirst({ where: { id } });
  }

  async findNotizen(filter: {
    bilanzId?: string;
    guvId?: string;
    status?: string;
  }): Promise<WPNotizEntity[]> {
    return this.prisma.wPNotiz.findMany({
      where: {
        bilanzId: filter.bilanzId ?? undefined,
        guvId: filter.guvId ?? undefined,
        status: filter.status ?? undefined,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Cursor-paginierte Notiz-Liste (M3+ Performance-Skalierung).
   *
   * Sortierung: createdAt DESC (Tiebreaker: id ASC)
   */
  async findNotizenPaginated(args: {
    bilanzId?: string;
    guvId?: string;
    status?: string;
    cursor?: string;
    pageSize: number;
  }): Promise<WPNotizEntity[]> {
    const where: Prisma.WPNotizWhereInput = {
      bilanzId: args.bilanzId ?? undefined,
      guvId: args.guvId ?? undefined,
      status: args.status ?? undefined,
    };

    if (args.cursor) {
      const { sortValue } = CursorCodec.decode(args.cursor);
      const cursorDate = new Date(sortValue);
      if (!Number.isNaN(cursorDate.getTime())) {
        where.OR = [{ createdAt: { lt: cursorDate } }];
      }
    }

    return this.prisma.wPNotiz.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: args.pageSize + 1,
    });
  }

  async countNotizen(args: {
    bilanzId?: string;
    guvId?: string;
    status?: string;
  }): Promise<number> {
    return this.prisma.wPNotiz.count({
      where: {
        bilanzId: args.bilanzId ?? undefined,
        guvId: args.guvId ?? undefined,
        status: args.status ?? undefined,
      },
    });
  }

  async updateNotizStatus(
    id: string,
    status: string,
    acknowledgedById: string,
  ): Promise<WPNotizEntity> {
    return this.prisma.wPNotiz.update({
      where: { id },
      data: {
        status,
        acknowledgedAt: new Date(),
        acknowledgedById,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // PruefungsRegel
  // ---------------------------------------------------------------------------

  async findActiveRegeln(): Promise<PruefungsRegelEntity[]> {
    return this.prisma.pruefungsRegel.findMany({
      where: { istAktiv: true },
      orderBy: { reihenfolge: 'asc' },
    });
  }

  // ---------------------------------------------------------------------------
  // BilanzPruefungsResult
  // ---------------------------------------------------------------------------

  async upsertPruefungsResult(input: {
    bilanzId: string;
    guvId?: string | null;
    regelCode: string;
    status: string;
    berechneterWert: Prisma.Decimal | null;
    schwellwert: Prisma.Decimal | null;
    meldung: string;
  }): Promise<BilanzPruefungsResultEntity> {
    return this.prisma.bilanzPruefungsResult.upsert({
      where: {
        bilanzId_regelCode: {
          bilanzId: input.bilanzId,
          regelCode: input.regelCode,
        },
      },
      create: {
        bilanzId: input.bilanzId,
        guvId: input.guvId ?? null,
        regelCode: input.regelCode,
        status: input.status,
        berechneterWert: input.berechneterWert ?? undefined,
        schwellwert: input.schwellwert ?? undefined,
        meldung: input.meldung,
      },
      update: {
        guvId: input.guvId ?? null,
        status: input.status,
        berechneterWert: input.berechneterWert ?? undefined,
        schwellwert: input.schwellwert ?? undefined,
        meldung: input.meldung,
        geprueftAm: new Date(),
      },
    });
  }

  async findPruefungsResultsByBilanz(
    bilanzId: string,
  ): Promise<BilanzPruefungsResultEntity[]> {
    return this.prisma.bilanzPruefungsResult.findMany({
      where: { bilanzId },
      orderBy: { geprueftAm: 'desc' },
    });
  }

  async findPruefungsResultsByCodes(input: {
    bilanzId: string;
    regelCodes: string[];
  }): Promise<BilanzPruefungsResultEntity[]> {
    return this.prisma.bilanzPruefungsResult.findMany({
      where: {
        bilanzId: input.bilanzId,
        regelCode: { in: input.regelCodes },
      },
    });
  }

  // ---------------------------------------------------------------------------
  // WPPruefungsAbschluss
  // ---------------------------------------------------------------------------

  async createPruefungsAbschluss(input: {
    bilanzId: string;
    guvId?: string | null;
    wpUserId: string;
    zusammenfassung?: string | null;
  }): Promise<WPPruefungsAbschlussEntity> {
    return this.prisma.wPPruefungsAbschluss.create({
      data: {
        bilanzId: input.bilanzId,
        guvId: input.guvId ?? null,
        wpUserId: input.wpUserId,
        zusammenfassung: input.zusammenfassung ?? null,
        status: 'IN_PROGRESS',
      },
    });
  }

  async findPruefungsAbschlussById(
    id: string,
  ): Promise<WPPruefungsAbschlussEntity | null> {
    return this.prisma.wPPruefungsAbschluss.findFirst({ where: { id } });
  }

  async findPruefungsAbschluesseByBilanz(
    bilanzId: string,
  ): Promise<WPPruefungsAbschlussEntity[]> {
    return this.prisma.wPPruefungsAbschluss.findMany({
      where: { bilanzId },
      orderBy: { startedAt: 'desc' },
    });
  }

  async finalizePruefungsAbschluss(input: {
    id: string;
    status: 'APPROVED' | 'REJECTED';
    zusammenfassung: string;
    finalisierungVonId: string;
  }): Promise<WPPruefungsAbschlussEntity> {
    return this.prisma.wPPruefungsAbschluss.update({
      where: { id: input.id },
      data: {
        status: input.status,
        zusammenfassung: input.zusammenfassung,
        completedAt: new Date(),
        finalisierungAm: new Date(),
        finalisierungVonId: input.finalisierungVonId,
        // Vier-Augen-Prinzip (Bugfix 2026-10-07): die freigebende Person
        // wird ausdruecklich festgehalten. Ohne dieses Feld war aus dem
        // Datensatz NICHT erkennbar, wer freigegeben hat — der
        // Aufzeichnungsstand nach § 147 AO blieb unvollstaendig.
        ...(input.status === 'APPROVED'
          ? {
              freigegebenVonId: input.finalisierungVonId,
              freigegebenAm: new Date(),
            }
          : {}),
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Mandanten-Lookup
  // ---------------------------------------------------------------------------

  async findBilanzMandantId(bilanzId: string): Promise<string | null> {
    const b = await this.prisma.bilanz.findFirst({
      where: { id: bilanzId },
      select: { mandantId: true },
    });
    return b?.mandantId ?? null;
  }

  async findGuVMandantId(guvId: string): Promise<string | null> {
    const g = await this.prisma.guV.findFirst({
      where: { id: guvId },
      select: { mandantId: true },
    });
    return g?.mandantId ?? null;
  }

  async findBilanzMandantIdByPositionId(
    bilanzPositionId: string,
  ): Promise<string | null> {
    const p = await this.prisma.bilanzPosition.findFirst({
      where: { id: bilanzPositionId },
      select: { bilanz: { select: { mandantId: true } } },
    });
    return p?.bilanz?.mandantId ?? null;
  }

  async findGuVMandantIdByPositionId(
    guvPositionId: string,
  ): Promise<string | null> {
    const p = await this.prisma.guVPosition.findFirst({
      where: { id: guvPositionId },
      select: { guv: { select: { mandantId: true } } },
    });
    return p?.guv?.mandantId ?? null;
  }

  async findBilanz(bilanzId: string, mandantId: string) {
    return this.prisma.bilanz.findFirst({
      where: { id: bilanzId, mandantId },
      include: { positionen: { orderBy: { reihenfolge: 'asc' } } },
    });
  }

  async findGuV(guvId: string, mandantId: string) {
    return this.prisma.guV.findFirst({
      where: { id: guvId, mandantId },
      include: { positionen: { orderBy: { reihenfolge: 'asc' } } },
    });
  }

  /**
   * Setzt Bilanz.status auf APPROVED (via WP-Pruefungs-Finalize).
   */
  async setBilanzStatus(
    bilanzId: string,
    status: string,
    userId: string,
  ): Promise<void> {
    await this.prisma.bilanz.update({
      where: { id: bilanzId },
      data: { status, updatedById: userId },
    });
  }
}