import { NotFoundException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginationService } from '../services/pagination.service';

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
   *
   * Bugfix 2026-10-06. `kanzleiId` wurde angenommen und NICHT verwendet:
   * `where: { id }` filtrte nur nach der ID. Wer eine fremde
   * Einheits-ID kannte, konnte deren Status setzen und Konzern-IDs
   * eintragen.
   *
   * Der Filter sitzt jetzt auf der Datenbank-Seite, nicht nur im
   * Controller-Kontext. `loadEinheitForUser()` im Service lud bereits
   * kanzlei-gefiltert — das ist Kontext, aber kein Schutz. Ein
   * Repository, das `kanzleiId` entgegennimmt und es ignoriert, ist
   * eine Falle fuer jeden naechsten Aufrufer.
   *
   * Deshalb `updateMany` statt `update`: Prisma erlaubt in `where`
   * von `update` ausschliesslich eindeutige Felder, mit `updateMany`
   * dagegen beliebige zusaetzliche Bedingungen. Betroffen = 0 heisst
   * „gehoert nicht zu dieser Kanzlei" und wird als Fehler gemeldet,
   * nicht als stiller Erfolg.
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
    const result = await this.prismaService.konsolidierungsEinheit.updateMany({
      where: { id, kanzleiId },
      data: {
        status: data.status ?? undefined,
        konzernBilanzId: data.konzernBilanzId ?? undefined,
        konzernGuvId: data.konzernGuvId ?? undefined,
        finalisiertAm: data.finalisiertAm ?? undefined,
        finalisiertVonId: data.finalisiertVonId ?? undefined,
      },
    });
    if (result.count === 0) {
      throw new NotFoundException(
        'Konsolidierungseinheit nicht gefunden oder nicht freigegeben',
      );
    }
    const updated = await this.prismaService.konsolidierungsEinheit.findUnique({
      where: { id },
    });
    if (!updated) {
      throw new NotFoundException('Konsolidierungseinheit nicht gefunden');
    }
    return updated as KonsolidierungsEinheitWithoutBuchungen;
  }

  /**
   * Löscht eine Einheit samt Buchungen — NUR im Entwurfszustand.
   *
   * Bugfix 2026-10-07 (fehlte vollstaendig). Ohne diese Route blieb
   * eine abgebrochene Einheit fuer immer liegen und belegte
   * `(mutterMandantId, geschaeftsjahr)` dauerhaft. Praktische Folge:
   * nach einem Fehlversuch konnte fuer dieses Jahr keine zweite
   * Konsolidierung angelegt werden — es gab keinen Weg zurueck.
   *
   * Der Kanzlei-Filter sitzt in der WHERE-Bedingung, wie bei
   * `updateStatus`: eine fremde Einheit liefert `count === 0` und wird
   * als NotFound gemeldet, nicht stillschweigend geloescht.
   */
  async deleteEinheitDraft(
    id: string,
    kanzleiId: string,
  ): Promise<boolean> {
    const result = await this.prismaService.konsolidierungsEinheit.deleteMany({
      where: { id, kanzleiId, status: { in: ['DRAFT', 'IN_PROGRESS'] } },
    });
    // Buchungen haengen ueber `onDelete: Cascade` an der Einheit.
    return result.count > 0;
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

  // ---------------------------------------------------------------------------
  // Public-API Read-Pfade (M4 Sprint 1)
  // ---------------------------------------------------------------------------

  /**
   * Liefert alle Jahresabschlüsse eines Mandanten (für Public-API-Read).
   */
  async findJahresabschluesseByMandant(
    mandantId: string,
  ): Promise<
    Array<{
      id: string;
      mandantId: string;
      geschaeftsjahr: number;
      status: string;
      finalisiertAm: Date | null;
      signiertAm: Date | null;
      eingereichtAm: Date | null;
    }>
  > {
    const ja = await this.prismaService.jahresabschluss.findMany({
      where: { mandantId },
      orderBy: { geschaeftsjahr: 'desc' },
    });
    return ja.map((j) => ({
      id: j.id,
      mandantId: j.mandantId,
      geschaeftsjahr: j.geschaeftsjahr,
      status: j.status,
      finalisiertAm: j.finalisiertAm,
      signiertAm: j.signiertAm,
      eingereichtAm: j.eingereichtAm,
    }));
  }

  /**
   * Die Einreichungsbelege eines Mandanten — **mit Cursor-Paging**.
   *
   * BEFUND 2026-10-23 (Nachtrag 88): Die Liste wurde als **Gesamtliste**
   * geladen und im Service auf `pageSize` gekuerzt — ohne Cursor. Das
   * Ergebnis: die API meldete `hasMore: false`, obwohl Datensaetze
   * abgeschnitten wurden. Ein Client, der `hasMore` vertraut, glaubte, er
   * haette alles — die abgeschnittenen Einreichungen waren fuer ihn nicht
   * erreichbar (kein `nextCursor`).
   *
   * Alle anderen Listen der oeffentlichen API (Mandanten, Bilanzen, GuV,
   * Anhang) nutzen echtes Cursor-Paging mit `take: pageSize + 1` — diese
   * Liste war die einzige Ausnahme.
   */
  async findBanzSubmissionsByMandantPaginated(args: {
    mandantId: string;
    cursor?: string;
    pageSize: number;
  }): Promise<BanzSubmissionListEntry[]> {
    const where: Prisma.BanzSubmissionWhereInput = { mandantId: args.mandantId };

    if (args.cursor) {
      const cond = PaginationService.cursorCondition(
        args.cursor,
        'preparedAt',
        'desc',
        'asc',
        (w: string) => new Date(w),
      );
      if (cond) where.OR = cond;
    }

    const subs = await this.prismaService.banzSubmission.findMany({
      where,
      orderBy: [{ preparedAt: 'desc' }, { id: 'asc' }],
      take: args.pageSize + 1,
      include: {
        jahresabschluss: { select: { geschaeftsjahr: true } },
      },
    });
    return subs.map((s) => this.toBanzSubmissionListEntry(s));
  }

  /**
   * Die Gesamtzahl der Einreichungsbelege eines Mandanten.
   *
   * Parallel zum `findBanzSubmissionsByMandantPaginated` ausgefuehrt.
   */
  async countBanzSubmissionsByMandant(args: { mandantId: string }): Promise<number> {
    return this.prismaService.banzSubmission.count({
      where: { mandantId: args.mandantId },
    });
  }

  /**
   * BEFUND 2026-10-23 (Nachtrag 88): Die Vorgangsnummer kam aus
   * `banzVorgangsnummer` — einem Feld, das **niemand schreibt**. Die
   * Einreichung schreibt seit Nachtrag 62 (2026-10-20) `banzBestellnummer`
   * (das eindeutige Feld, `@unique`). Die oeffentliche API meldete darum
   * fuer jede Einreichung `banzVorgangsnummer: null`, waehrend der
   * Datensatz die Nummer very trug — ein externes ERP konnte die Einreichung
   * nicht zuordnen.
   *
   * Der **oeffentliche** Feldname bleibt `banzVorgangsnummer` (API-Vertrag,
   * in der Swagger-Dokumentation so beschrieben); geaendert wird die Quelle.
   */
  private toBanzSubmissionListEntry(s: {
    id: string;
    jahresabschlussId: string;
    mandantId: string;
    channel: string;
    status: string;
    banzBestellnummer: string | null;
    preparedAt: Date;
    submittedAt: Date | null;
    jahresabschluss: { geschaeftsjahr: number } | null;
  }): BanzSubmissionListEntry {
    return {
      id: s.id,
      jahresabschlussId: s.jahresabschlussId,
      mandantId: s.mandantId,
      channel: s.channel,
      status: s.status,
      banzVorgangsnummer: s.banzBestellnummer,
      // Der Sortierwert des Cursor-Paging (Nachtrag 88).
      preparedAt: s.preparedAt,
      submittedAt: s.submittedAt,
      jahresabschluss: s.jahresabschluss
        ? { geschaeftsjahr: s.jahresabschluss.geschaeftsjahr }
        : undefined,
    };
  }
}

/**
 * Ein Einreichungsbeleg in der Form der oeffentlichen API.
 */
export interface BanzSubmissionListEntry {
  id: string;
  jahresabschlussId: string;
  mandantId: string;
  channel: string;
  status: string;
  /** Die BAnz-Vorgangsnummer (aus `banzBestellnummer`, siehe Nachtrag 88). */
  banzVorgangsnummer: string | null;
  /** Sortierwert des Cursor-Paging (die Submissions haben kein `updatedAt`). */
  preparedAt: Date;
  submittedAt: Date | null;
  jahresabschluss?: { geschaeftsjahr: number };
}
