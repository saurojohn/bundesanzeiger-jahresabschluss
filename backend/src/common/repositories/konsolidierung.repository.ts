import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Typen für Konsolidierungs-spezifische Entities.
 *
 * Bewusst lokal definiert (analog Bilanz/GuV), damit der Service
 * domain-spezifische Formen nutzen kann.
 */
export type KonsolidierungsEinheitEntity = Prisma.KonsolidierungsEinheitGetPayload<{
  include: { buchungen: true };
}>;

export type KonsolidierungsEinheitWithoutBuchungen =
  Prisma.KonsolidierungsEinheitGetPayload<Record<string, never>>;

export type KonsolidierungsBuchungEntity =
  Prisma.KonsolidierungsBuchungGetPayload<Record<string, never>>;

export interface KonsolidierungsBuchungInput {
  buchungsArt: string;
  beschreibung: string;
  kontoSoll: string;
  kontoHaben: string;
  betrag: string | number;
  mandantId?: string | null;
  bezugId?: string | null;
  reihenfolge: number;
  istAutomatisch?: boolean;
}

export interface KonsolidierungsEinheitCreateInput {
  kanzleiId: string;
  mutterMandantId: string;
  tochterMandantIds: string[];
  geschaeftsjahr: number;
  konsolidierungsArt: string;
  beteiligungsquote: string | number;
  anschaffungskosten: string | number;
  eigenkapitalTochter: string | number;
  jahresueberschussTochter: string | number;
  createdById?: string | null;
}

/**
 * Kanzlei-isoliertes Repository für Konsolidierungs-Einheiten und
 * Konsolidierungs-Buchungen.
 *
 * Mandant-Trennung wird über `kanzleiId` (statt `mandantId`) erzwungen,
 * weil eine Konsolidierungs-Einheit sich über mehrere Mandanten
 * derselben Kanzlei erstreckt.
 *
 * Direkter Zugriff auf `prisma.konsolidierungsEinheit` außerhalb dieses
 * Repositories ist via ESLint verboten.
 */
@Injectable()
export class KonsolidierungRepository {
  constructor(private readonly prismaService: PrismaService) {}

  static readonly entityName = 'KonsolidierungsEinheit';

  /**
   * Findet alle Konsolidierungs-Einheiten einer Kanzlei (optional gefiltert
   * auf Jahr/Status).
   */
  async findByKanzlei(
    kanzleiId: string,
    options?: { geschaeftsjahr?: number; status?: string },
  ): Promise<KonsolidierungsEinheitWithoutBuchungen[]> {
    return this.prismaService.konsolidierungsEinheit.findMany({
      where: {
        kanzleiId,
        ...(typeof options?.geschaeftsjahr === 'number'
          ? { geschaeftsjahr: options.geschaeftsjahr }
          : {}),
        ...(options?.status ? { status: options.status } : {}),
      },
      orderBy: [{ geschaeftsjahr: 'desc' }, { createdAt: 'desc' }],
    });
  }

  /**
   * Findet eine Einheit nach ID (kanzlei-gefiltert), ohne Buchungen.
   */
  async findById(
    id: string,
    kanzleiId: string,
  ): Promise<KonsolidierungsEinheitWithoutBuchungen | null> {
    return this.prismaService.konsolidierungsEinheit.findFirst({
      where: { id, kanzleiId },
    });
  }

  /**
   * Findet eine Einheit inklusive aller Buchungen (kanzlei-gefiltert).
   */
  async findWithBuchungen(
    id: string,
    kanzleiId: string,
  ): Promise<KonsolidierungsEinheitEntity | null> {
    return this.prismaService.konsolidierungsEinheit.findFirst({
      where: { id, kanzleiId },
      include: { buchungen: { orderBy: { reihenfolge: 'asc' } } },
    });
  }

  /**
   * Erstellt eine Konsolidierungs-Einheit (DRAFT-Status).
   */
  async create(
    input: KonsolidierungsEinheitCreateInput,
  ): Promise<KonsolidierungsEinheitWithoutBuchungen> {
    return this.prismaService.konsolidierungsEinheit.create({
      data: {
        kanzleiId: input.kanzleiId,
        mutterMandantId: input.mutterMandantId,
        tochterMandantIds: input.tochterMandantIds,
        geschaeftsjahr: input.geschaeftsjahr,
        konsolidierungsArt: input.konsolidierungsArt,
        beteiligungsquote: this.toDecimal(input.beteiligungsquote) ?? new Prisma.Decimal(0),
        anschaffungskosten:
          this.toDecimal(input.anschaffungskosten) ?? new Prisma.Decimal(0),
        eigenkapitalTochter:
          this.toDecimal(input.eigenkapitalTochter) ?? new Prisma.Decimal(0),
        jahresueberschussTochter:
          this.toDecimal(input.jahresueberschussTochter) ?? new Prisma.Decimal(0),
        createdById: input.createdById ?? null,
      },
    });
  }

  /**
   * Aktualisiert den Status und optional die Konzern-IDs einer Einheit.
   */
  async updateStatus(
    id: string,
    kanzleiId: string,
    data: {
      status?: string;
      konzernBilanzId?: string | null;
      konzernGuvId?: string | null;
      finalisiertAm?: Date | null;
      finalisiertVonId?: string | null;
    },
  ): Promise<KonsolidierungsEinheitWithoutBuchungen> {
    return this.prismaService.konsolidierungsEinheit.update({
      where: { id },
      data: {
        status: data.status ?? undefined,
        konzernBilanzId: data.konzernBilanzId ?? undefined,
        konzernGuvId: data.konzernGuvId ?? undefined,
        finalisiertAm: data.finalisiertAm ?? undefined,
        finalisiertVonId: data.finalisiertVonId ?? undefined,
      },
    });
  }

  /**
   * Löscht alle vorhandenen Buchungen einer Einheit (für Recalculate).
   */
  async deleteBuchungen(einheitId: string): Promise<void> {
    await this.prismaService.konsolidierungsBuchung.deleteMany({
      where: { einheitId },
    });
  }

  /**
   * Fügt eine Liste von Buchungen in einer Transaktion ein.
   *
   * Garantiert: entweder alle erfolgreich oder keine.
   */
  async createBuchungen(
    einheitId: string,
    buchungen: KonsolidierungsBuchungInput[],
  ): Promise<KonsolidierungsBuchungEntity[]> {
    return this.prismaService.$transaction(async (tx) => {
      const created: KonsolidierungsBuchungEntity[] = [];
      for (const b of buchungen) {
        const row = await tx.konsolidierungsBuchung.create({
          data: {
            einheitId,
            buchungsArt: b.buchungsArt,
            beschreibung: b.beschreibung,
            kontoSoll: b.kontoSoll,
            kontoHaben: b.kontoHaben,
            betrag: this.toDecimal(b.betrag) ?? new Prisma.Decimal(0),
            mandantId: b.mandantId ?? null,
            bezugId: b.bezugId ?? null,
            reihenfolge: b.reihenfolge,
            istAutomatisch: b.istAutomatisch ?? true,
          },
        });
        created.push(row);
      }
      return created;
    });
  }

  /**
   * Liefert alle Buchungen einer Einheit (sortiert nach reihenfolge).
   */
  async findBuchungen(einheitId: string): Promise<KonsolidierungsBuchungEntity[]> {
    return this.prismaService.konsolidierungsBuchung.findMany({
      where: { einheitId },
      orderBy: { reihenfolge: 'asc' },
    });
  }

  /**
   * Liefert alle Buchungen mehrerer Einheiten in einer Query
   * (Performance-Optimierung für List-Endpoints).
   */
  async findBuchungenByEinheitIds(
    einheitIds: string[],
  ): Promise<KonsolidierungsBuchungEntity[]> {
    if (einheitIds.length === 0) return [];
    return this.prismaService.konsolidierungsBuchung.findMany({
      where: { einheitId: { in: einheitIds } },
      orderBy: { reihenfolge: 'asc' },
    });
  }

  private toDecimal(value: string | number | null | undefined): Prisma.Decimal | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return new Prisma.Decimal(value);
    if (value === '') return null;
    return new Prisma.Decimal(value);
  }
}