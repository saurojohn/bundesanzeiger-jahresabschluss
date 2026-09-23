import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Typen für Bilanz-spezifische Eingaben.
 *
 * Bewusst lokal definiert (nicht aus `@prisma/client` reexportiert) — der
 * Bilanz-Service nutzt domain-spezifische Formen.
 */
export type BilanzEntity = Prisma.BilanzGetPayload<{
  include: { positionen: true };
}>;

export type BilanzWithoutPositionen = Prisma.BilanzGetPayload<Record<string, never>>;

export interface BilanzPositionInput {
  seite: 'AKTIVA' | 'PASSIVA';
  kontonummer: string;
  bezeichnung: string;
  betragVorjahr?: string | number | null;
  betragAktuell: string | number;
  reihenfolge: number;
  bemerkung?: string | null;
}

export interface BilanzCreateInput {
  mandantId: string;
  geschaeftsjahr: number;
  status?: string;
  hinweise?: string | null;
  createdById?: string | null;
  positionen?: BilanzPositionInput[];
}

export interface BilanzUpdateInput {
  status?: string;
  hinweise?: string | null;
  updatedById?: string | null;
  positionen?: BilanzPositionInput[];
}

/**
 * Mandant-isoliertes Repository für Bilanz und BilanzPosition.
 *
 * Alle Methoden erzwingen einen mandantId-Filter. Direkter Zugriff auf
 * `prisma.bilanz` außerhalb dieses Repositories ist via ESLint verboten
 * (siehe `eslint.config.mjs` — *Repository*.ts ist ausgenommen).
 */
@Injectable()
export class BilanzRepository {
  constructor(private readonly prismaService: PrismaService) {}

  /** Menschenlesbarer Entity-Name (für Logs, Audit). */
  static readonly entityName = 'Bilanz';

  /**
   * Findet alle Bilanzen eines Mandanten für ein Geschäftsjahr (oder alle).
   */
  async findByMandantAndJahr(
    mandantId: string,
    jahr?: number,
  ): Promise<BilanzWithoutPositionen[]> {
    return this.prismaService.bilanz.findMany({
      where: {
        mandantId,
        ...(typeof jahr === 'number' ? { geschaeftsjahr: jahr } : {}),
      },
      orderBy: { geschaeftsjahr: 'desc' },
    });
  }

  /**
   * Findet eine Bilanz per ID, mandant-gefiltert, ohne Positionen.
   */
  async findById(id: string, mandantId: string): Promise<BilanzWithoutPositionen | null> {
    return this.prismaService.bilanz.findFirst({
      where: { id, mandantId },
    });
  }

  /**
   * Findet eine Bilanz inkl. aller Positionen (mandant-gefiltert).
   */
  async findWithPositionen(id: string, mandantId: string): Promise<BilanzEntity | null> {
    return this.prismaService.bilanz.findFirst({
      where: { id, mandantId },
      include: { positionen: { orderBy: { reihenfolge: 'asc' } } },
    });
  }

  /**
   * Erstellt eine Bilanz + zugehörige Positionen in einer Transaktion.
   *
   * Garantiert: entweder beide Records erfolgreich oder keiner.
   */
  async createWithPositionen(input: BilanzCreateInput): Promise<BilanzEntity> {
    return this.prismaService.$transaction(async (tx) => {
      const bilanz = await tx.bilanz.create({
        data: {
          mandantId: input.mandantId,
          geschaeftsjahr: input.geschaeftsjahr,
          status: input.status ?? 'DRAFT',
          hinweise: input.hinweise ?? null,
          createdById: input.createdById ?? null,
        },
      });
      const positionen = await this.createPositionenInTx(
        tx,
        bilanz.id,
        input.positionen ?? [],
      );
      return { ...bilanz, positionen };
    });
  }

  /**
   * Aktualisiert eine Bilanz + ersetzt alle Positionen in einer Transaktion.
   *
   * Vorhandene Positionen werden gelöscht und neu angelegt (einfacher
   * als diff-basierter Ansatz, und Bilanzen werden nur in DRAFT-Phase
   * editiert).
   */
  async updateWithPositionen(
    id: string,
    mandantId: string,
    input: BilanzUpdateInput,
  ): Promise<BilanzEntity> {
    return this.prismaService.$transaction(async (tx) => {
      // Existenz-Check mit mandantId-Filter.
      const existing = await tx.bilanz.findFirst({
        where: { id, mandantId },
      });
      if (!existing) {
        throw new Error('Bilanz nicht gefunden oder kein Zugriff');
      }

      const updated = await tx.bilanz.update({
        where: { id },
        data: {
          status: input.status ?? undefined,
          hinweise: input.hinweise ?? undefined,
          updatedById: input.updatedById ?? null,
        },
      });

      if (input.positionen !== undefined) {
        // Positionen ersetzen — nur in DRAFT-Phase erlaubt.
        await tx.bilanzPosition.deleteMany({ where: { bilanzId: id } });
        await this.createPositionenInTx(tx, id, input.positionen);
      }

      const positionen = await tx.bilanzPosition.findMany({
        where: { bilanzId: id },
        orderBy: { reihenfolge: 'asc' },
      });
      return { ...updated, positionen };
    });
  }

  /**
   * Löscht eine Bilanz (mandant-gefiltert). Positionen werden via Cascade
   * mitgelöscht.
   */
  async deleteByMandant(id: string, mandantId: string): Promise<boolean> {
    const existing = await this.findById(id, mandantId);
    if (!existing) return false;
    await this.prismaService.bilanz.delete({ where: { id } });
    return true;
  }

  // ---------------------------------------------------------------------------
  // private helpers
  // ---------------------------------------------------------------------------

  private async createPositionenInTx(
    tx: Prisma.TransactionClient,
    bilanzId: string,
    positionen: BilanzPositionInput[],
  ): Promise<Array<{
    id: string;
    bilanzId: string;
    seite: string;
    kontonummer: string;
    bezeichnung: string;
    betragVorjahr: Prisma.Decimal | null;
    betragAktuell: Prisma.Decimal;
    reihenfolge: number;
    bemerkung: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>> {
    const created = [];
    for (const pos of positionen) {
      const row = await tx.bilanzPosition.create({
        data: {
          bilanzId,
          seite: pos.seite,
          kontonummer: pos.kontonummer,
          bezeichnung: pos.bezeichnung,
          betragVorjahr: this.toDecimal(pos.betragVorjahr),
          betragAktuell:
            this.toDecimal(pos.betragAktuell) ?? new Prisma.Decimal(0),
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