import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CursorCodec } from '../dto/pagination.dto';

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

/**
 * Listenansicht einer Bilanz: alle Skalarfelder plus die Salden-Summen je
 * Seite. Die Positionen selbst werden NICHT mitgeliefert (eine Bilanz hat 20+
 * Positionen, eine Liste 20 Bilanzen).
 *
 * Bugfix 2026-10-03: Die Oberfläche berechnete die Summen in der Liste aus
 * `bilanz.positionen` — die Listen-Antwort liefert dieses Feld nicht
 * (`BilanzWithoutPositionen`). Der Zugriff crashte die komplette
 * Bilanz-Fachseite mit "TypeError: Cannot read properties of undefined
 * (reading 'filter')" — und zwar bei jedem Mandanten, der überhaupt eine
 * Bilanz hat. Die GuV-Liste löst das bereits über ein serverseitiges
 * Feld (`ergebnis`); die Bilanz-Liste bekommt dasselbe Prinzip.
 */
export type BilanzListEntry = BilanzWithoutPositionen & {
  aktivaSumme: number;
  passivaSumme: number;
};

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
  /** Konzernsatz (null = Einzelsatz). Siehe Migration 20261007230000. */
  konzernEinheitId?: string | null;
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
    // Bugfix 2026-10-07: Seit der Konzernsatz ein eigener Datensatz ist
    // (`konzernEinheitId`), liefert diese Abfrage auch die
    // KONZERN-Bilanz der Mutter. Jeder Aufrufer, der "die Jahresbilanz"
    // erwartet, bekam damit unter Umstaenden den Konzernabschluss —
    // inklusive beim Speichern, wo es zu einem Fehler kam.
    //
    // Diese Methode liefert deshalb ausschliesslich EINZELSAETZE. Der
    // Konzernsatz ist ueber die Konsolidierungseinheit erreichbar und
    // wird dort bewusst geladen.
    const bilanzen = await this.prismaService.bilanz.findMany({
      where: {
        mandantId,
        konzernEinheitId: null,
        ...(typeof jahr === 'number' ? { geschaeftsjahr: jahr } : {}),
      },
      orderBy: { geschaeftsjahr: 'desc' },
    });
    return bilanzen;
  }

  /**
   * Findet alle Bilanzen inkl. letztes WORM-PDF-ObjectKey pro Bilanz.
   * Performance: 1 zusätzlicher grouped query statt N+1.
   */
  async findByMandantAndJahrWithWorm(
    mandantId: string,
    jahr?: number,
  ): Promise<
    Array<BilanzListEntry & { wormObjectKey: string | null }>
  > {
    const bilanzen = await this.findByMandantAndJahr(mandantId, jahr);
    if (bilanzen.length === 0) return [];
    const wormObjects = await this.prismaService.wormObject.findMany({
      where: {
        entityType: 'BILANZ_PDF',
        entityId: { in: bilanzen.map((b) => b.id) },
      },
      orderBy: { uploadedAt: 'desc' },
    });
    const map = new Map<string, string>();
    for (const w of wormObjects) {
      if (!map.has(w.entityId)) map.set(w.entityId, w.objectKey);
    }
    const salden = await this.saldenProBilanz(bilanzen.map((b) => b.id));
    return bilanzen.map((b) => ({
      ...b,
      ...(salden.get(b.id) ?? this.leereSalden()),
      wormObjectKey: map.get(b.id) ?? null,
    }));
  }

  /** Neutralwert für Bilanzen ohne Positionen. */
  private leereSalden(): { aktivaSumme: number; passivaSumme: number } {
    return { aktivaSumme: 0, passivaSumme: 0 };
  }

  /**
   * Salden-Summen je Bilanz, gruppiert in EINER Query (`groupBy` über
   * bilanzId + seite) — kein N+1 und keine übertragenen Positionen.
   *
   * Summiert wird `betragAktuell`, nicht `betragVorjahr`: die Listen-Anzeige
   * vergleicht die aktuellen Werte, genau wie `computeValidation`.
   */
  private async saldenProBilanz(
    bilanzIds: string[],
  ): Promise<Map<string, { aktivaSumme: number; passivaSumme: number }>> {
    if (bilanzIds.length === 0) return new Map();
    const gruppen = await this.prismaService.bilanzPosition.groupBy({
      by: ['bilanzId', 'seite'],
      where: { bilanzId: { in: bilanzIds } },
      _sum: { betragAktuell: true },
    });
    const map = new Map<string, { aktivaSumme: number; passivaSumme: number }>();
    for (const id of bilanzIds) map.set(id, this.leereSalden());
    for (const g of gruppen) {
      const eintrag = map.get(g.bilanzId);
      if (!eintrag) continue;
      const summe = Number(g._sum.betragAktuell ?? 0);
      if (g.seite === 'AKTIVA') eintrag.aktivaSumme += summe;
      else if (g.seite === 'PASSIVA') eintrag.passivaSumme += summe;
    }
    for (const v of map.values()) {
      // Auf 2 Nachkommastellen runden, sonst zeigt die Liste 1000.0000000001.
      v.aktivaSumme = Number(v.aktivaSumme.toFixed(2));
      v.passivaSumme = Number(v.passivaSumme.toFixed(2));
    }
    return map;
  }

  /**
   * Cursor-paginierte Variante für Performance-Skalierung (M3+).
   *
   * - Sortierung: `updatedAt DESC` (Tiebreaker: id ASC)
   * - Filter: mandantId (+ optional Jahr)
   * - Cursor: opak base64-codiert (id + updatedAt-ISO)
   * - Rückgabe: max `pageSize + 1` Items (+ 1 zur hasMore-Detection)
   */
  async findByMandantPaginated(args: {
    mandantId: string;
    cursor?: string;
    pageSize: number;
    jahr?: number;
  }): Promise<
    Array<BilanzListEntry & { wormObjectKey: string | null }>
  > {
    const where: Prisma.BilanzWhereInput = {
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

    const bilanzen = await this.prismaService.bilanz.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      take: args.pageSize + 1,
    });

    if (bilanzen.length === 0) return [];
    // WORM-ObjectKeys in einem einzigen Query nachladen (kein N+1).
    const wormObjects = await this.prismaService.wormObject.findMany({
      where: {
        entityType: 'BILANZ_PDF',
        entityId: { in: bilanzen.map((b) => b.id) },
      },
      orderBy: { uploadedAt: 'desc' },
    });
    const map = new Map<string, string>();
    for (const w of wormObjects) {
      if (!map.has(w.entityId)) map.set(w.entityId, w.objectKey);
    }
    const salden = await this.saldenProBilanz(bilanzen.map((b) => b.id));
    return bilanzen.map((b) => ({
      ...b,
      ...(salden.get(b.id) ?? this.leereSalden()),
      wormObjectKey: map.get(b.id) ?? null,
    }));
  }

  /**
   * Anzahl Bilanzen pro Mandant (optional Jahr-Filter).
   *
   * Parallel zum `findByMandantPaginated` ausgeführt via `Promise.all`.
   */
  async countByMandant(args: {
    mandantId: string;
    jahr?: number;
  }): Promise<number> {
    return this.prismaService.bilanz.count({
      where: {
        mandantId: args.mandantId,
        ...(typeof args.jahr === 'number' ? { geschaeftsjahr: args.jahr } : {}),
      },
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
          // Bugfix 2026-10-07: Konzernsatz markieren. `null` = Einzelsatz.
          konzernEinheitId: input.konzernEinheitId ?? null,
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
