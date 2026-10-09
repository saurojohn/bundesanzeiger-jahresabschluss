import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CursorCodec } from '../dto/pagination.dto';

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
  /** Konzernsatz (null = Einzelsatz). Siehe Migration 20261007230000. */
  konzernEinheitId?: string | null;
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
    // Bugfix 2026-10-07: siehe `bilanz.repository.ts` — nur EINZELSAETZE.
    // Die Konzern-GuV ist ein eigener Datensatz (`konzernEinheitId`)
    // und wird ueber die Konsolidierungseinheit geladen.
    return this.prismaService.guV.findMany({
      where: {
        mandantId,
        konzernEinheitId: null,
        ...(typeof jahr === 'number' ? { geschaeftsjahr: jahr } : {}),
      },
      orderBy: { geschaeftsjahr: 'desc' },
    });
  }

  /**
   * Wie findByMandantAndJahr, aber zusätzlich mit jüngstem
   * WORM-PDF-ObjectKey pro Datensatz. Performance: 1 zusätzlicher
   * grouped query statt N+1.
   */
  async findByMandantAndJahrWithWorm(
    mandantId: string,
    jahr?: number,
  ): Promise<Array<GuVWithoutPositionen & { wormObjectKey: string | null }>> {
    const guvs = await this.findByMandantAndJahr(mandantId, jahr);
    if (guvs.length === 0) return [];
    const wormObjects = await this.prismaService.wormObject.findMany({
      where: {
        entityType: 'GUV_PDF',
        entityId: { in: guvs.map((g) => g.id) },
      },
      orderBy: { uploadedAt: 'desc' },
    });
    const map = new Map<string, string>();
    for (const w of wormObjects) {
      if (!map.has(w.entityId)) map.set(w.entityId, w.objectKey);
    }
    return guvs.map((g) => ({
      ...g,
      wormObjectKey: map.get(g.id) ?? null,
    }));
  }

  /**
   * Cursor-paginierte Variante für Performance-Skalierung (M3+).
   *
   * - Sortierung: `updatedAt DESC` (Tiebreaker: id ASC)
   * - Filter: mandantId (+ optional Jahr)
   * - Cursor: opak base64-codiert (id + updatedAt-ISO)
   */
  async findByMandantPaginated(args: {
    mandantId: string;
    cursor?: string;
    pageSize: number;
    jahr?: number;
  }): Promise<Array<GuVWithoutPositionen & { wormObjectKey: string | null }>> {
    const where: Prisma.GuVWhereInput = {
      mandantId: args.mandantId,
      // Bugfix 2026-10-07: Der Konzernsatz ist ein eigener Datensatz.
      // In der Mandantenliste ist er ein fremdes Objekt — er gehoert
      // zur Konsolidierungseinheit, nicht in die Liste der
      // Jahresabschluesse des Mandanten.
      konzernEinheitId: null,
      ...(typeof args.jahr === 'number' ? { geschaeftsjahr: args.jahr } : {}),
    };

    if (args.cursor) {
      const { sortValue } = CursorCodec.decode(args.cursor);
      const cursorDate = new Date(sortValue);
      if (!Number.isNaN(cursorDate.getTime())) {
        where.OR = [{ updatedAt: { lt: cursorDate } }];
      }
    }

    const guvs = await this.prismaService.guV.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      take: args.pageSize + 1,
    });

    if (guvs.length === 0) return [];
    const wormObjects = await this.prismaService.wormObject.findMany({
      where: {
        entityType: 'GUV_PDF',
        entityId: { in: guvs.map((g) => g.id) },
      },
      orderBy: { uploadedAt: 'desc' },
    });
    const map = new Map<string, string>();
    for (const w of wormObjects) {
      if (!map.has(w.entityId)) map.set(w.entityId, w.objectKey);
    }
    return guvs.map((g) => ({
      ...g,
      wormObjectKey: map.get(g.id) ?? null,
    }));
  }

  /**
   * Anzahl GuV pro Mandant (optional Jahr-Filter). Parallel zum
   * `findByMandantPaginated` via `Promise.all`.
   */
  async countByMandant(args: {
    mandantId: string;
    jahr?: number;
  }): Promise<number> {
    return this.prismaService.guV.count({
      where: {
        mandantId: args.mandantId,
        ...(typeof args.jahr === 'number' ? { geschaeftsjahr: args.jahr } : {}),
      },
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
  async createWithPositionen(
    input: GuVCreateInput,
    /** Siehe `BilanzRepository.createWithPositionen`. */
    tx?: Prisma.TransactionClient,
  ): Promise<GuVEntity> {
    const schreiben = async (client: Prisma.TransactionClient) => {
      const guv = await client.guV.create({
        data: {
          mandantId: input.mandantId,
          geschaeftsjahr: input.geschaeftsjahr,
          verfahren: input.verfahren ?? 'GKV',
          status: input.status ?? 'DRAFT',
          hinweise: input.hinweise ?? null,
          bilanzId: input.bilanzId ?? null,
          ergebnis: this.toDecimal(input.ergebnis) ?? new Prisma.Decimal(0),
          createdById: input.createdById ?? null,
          // Bugfix 2026-10-07: Konzernsatz markieren (null = Einzelsatz).
          konzernEinheitId: input.konzernEinheitId ?? null,
        },
      });
      const positionen = await this.createPositionenInTx(
        client,
        guv.id,
        input.positionen ?? [],
      );
      return { ...guv, positionen };
    };
    return tx ? schreiben(tx) : this.prismaService.$transaction(schreiben);
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