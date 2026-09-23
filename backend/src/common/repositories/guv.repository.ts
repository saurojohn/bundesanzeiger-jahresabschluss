import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Typen für GuV-spezifische Eingaben.
 */
export type GuVEntity = Prisma.GuVGetPayload<{
  include: { positionen: true };
}>;

export type GuVWithoutPositionen = Prisma.GuVGetPayload<Record<string, never>>;

export type GuVKategorieLiteral =
  | 'ERLOES'
  | 'MATERIAL'
  | 'PERSONAL'
  | 'ABSCHREIBUNG'
  | 'SONSTIGE'
  | 'STEUER'
  | 'FINANZ';

export interface GuVPositionInput {
  kontonummer: string;
  bezeichnung: string;
  kategorie: GuVKategorieLiteral;
  betragVorjahr?: string | number | null;
  betragAktuell: string | number;
  reihenfolge: number;
  bemerkung?: string | null;
}

export interface GuVCreateInput {
  mandantId: string;
  geschaeftsjahr: number;
  verfahren?: string;
  status?: string;
  hinweise?: string | null;
  bilanzId?: string | null;
  ergebnis?: string | number;
  createdById?: string | null;
  positionen?: GuVPositionInput[];
}

export interface GuVUpdateInput {
  status?: string;
  hinweise?: string | null;
  verfahren?: string;
  bilanzId?: string | null;
  ergebnis?: string | number;
  updatedById?: string | null;
  positionen?: GuVPositionInput[];
}

/**
 * Mandant-isoliertes Repository für GuV und GuVPosition.
 *
 * Alle Methoden erzwingen einen mandantId-Filter. Direkter Zugriff auf
 * `prisma.guV` außerhalb dieses Repositories ist via ESLint verboten.
 */
@Injectable()
export class GuVRepository {
  constructor(private readonly prismaService: PrismaService) {}

  static readonly entityName = 'GuV';

  /**
   * Findet alle GuV eines Mandanten, optional gefiltert auf Jahr.
   */
  async findByMandantAndJahr(
    mandantId: string,
    jahr?: number,
  ): Promise<GuVWithoutPositionen[]> {
    return this.prismaService.guV.findMany({
      where: {
        mandantId,
        ...(typeof jahr === 'number' ? { geschaeftsjahr: jahr } : {}),
      },
      orderBy: { geschaeftsjahr: 'desc' },
    });
  }

  /**
   * Findet eine GuV per ID, mandant-gefiltert, ohne Positionen.
   */
  async findById(id: string, mandantId: string): Promise<GuVWithoutPositionen | null> {
    return this.prismaService.guV.findFirst({
      where: { id, mandantId },
    });
  }

  /**
   * Findet eine GuV inkl. aller Positionen (mandant-gefiltert).
   */
  async findWithPositionen(id: string, mandantId: string): Promise<GuVEntity | null> {
    return this.prismaService.guV.findFirst({
      where: { id, mandantId },
      include: { positionen: { orderBy: { reihenfolge: 'asc' } } },
    });
  }

  /**
   * Erstellt eine GuV + zugehörige Positionen in einer Transaktion.
   */
  async createWithPositionen(input: GuVCreateInput): Promise<GuVEntity> {
    return this.prismaService.$transaction(async (tx) => {
      const guv = await tx.guV.create({
        data: {
          mandantId: input.mandantId,
          geschaeftsjahr: input.geschaeftsjahr,
          verfahren: input.verfahren ?? 'GKV',
          status: input.status ?? 'DRAFT',
          hinweise: input.hinweise ?? null,
          bilanzId: input.bilanzId ?? null,
          ergebnis: this.toDecimal(input.ergebnis) ?? new Prisma.Decimal(0),
          createdById: input.createdById ?? null,
        },
      });
      const positionen = await this.createPositionenInTx(
        tx,
        guv.id,
        input.positionen ?? [],
      );
      return { ...guv, positionen };
    });
  }

  /**
   * Aktualisiert eine GuV + ersetzt alle Positionen in einer Transaktion.
   */
  async updateWithPositionen(
    id: string,
    mandantId: string,
    input: GuVUpdateInput,
  ): Promise<GuVEntity> {
    return this.prismaService.$transaction(async (tx) => {
      const existing = await tx.guV.findFirst({
        where: { id, mandantId },
      });
      if (!existing) {
        throw new Error('GuV nicht gefunden oder kein Zugriff');
      }

      const updated = await tx.guV.update({
        where: { id },
        data: {
          status: input.status ?? undefined,
          hinweise: input.hinweise ?? undefined,
          verfahren: input.verfahren ?? undefined,
          bilanzId: input.bilanzId ?? undefined,
          ergebnis:
            input.ergebnis !== undefined
              ? this.toDecimal(input.ergebnis) ?? new Prisma.Decimal(0)
              : undefined,
          updatedById: input.updatedById ?? null,
        },
      });

      if (input.positionen !== undefined) {
        await tx.guVPosition.deleteMany({ where: { guvId: id } });
        await this.createPositionenInTx(tx, id, input.positionen);
      }

      const positionen = await tx.guVPosition.findMany({
        where: { guvId: id },
        orderBy: { reihenfolge: 'asc' },
      });
      return { ...updated, positionen };
    });
  }

  /**
   * Löscht eine GuV (mandant-gefiltert).
   */
  async deleteByMandant(id: string, mandantId: string): Promise<boolean> {
    const existing = await this.findById(id, mandantId);
    if (!existing) return false;
    await this.prismaService.guV.delete({ where: { id } });
    return true;
  }

  // ---------------------------------------------------------------------------
  // private helpers
  // ---------------------------------------------------------------------------

  private async createPositionenInTx(
    tx: Prisma.TransactionClient,
    guvId: string,
    positionen: GuVPositionInput[],
  ): Promise<Array<{
    id: string;
    guvId: string;
    kontonummer: string;
    bezeichnung: string;
    kategorie: string;
    betragVorjahr: Prisma.Decimal | null;
    betragAktuell: Prisma.Decimal;
    reihenfolge: number;
    bemerkung: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>> {
    const created = [];
    for (const pos of positionen) {
      const row = await tx.guVPosition.create({
        data: {
          guvId,
          kontonummer: pos.kontonummer,
          bezeichnung: pos.bezeichnung,
          kategorie: pos.kategorie,
          betragVorjahr: this.toDecimal(pos.betragVorjahr),
          betragAktuell: this.toDecimal(pos.betragAktuell) ?? new Prisma.Decimal(0),
          reihenfolge: pos.reihenfolge,
          bemerkung: pos.bemerkung ?? null,
        },
      });
      created.push(row);
    }
    return created;
  }

  private toDecimal(
    value: string | number | null | undefined,
  ): Prisma.Decimal | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return new Prisma.Decimal(value);
    if (value === '') return null;
    return new Prisma.Decimal(value);
  }
}