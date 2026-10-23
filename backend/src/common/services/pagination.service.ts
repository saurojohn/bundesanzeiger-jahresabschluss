import { BadRequestException, Injectable } from '@nestjs/common';
import {
  CursorCodec,
  type PaginatedResult,
} from '../dto/pagination.dto';

/**
 * Service-Helper für Cursor-Pagination-Responses.
 *
 * Implementiert das `take + 1`-Pattern: Der Repository fragt
 * `pageSize + 1` Datensätze ab; das `+ 1` Element signalisiert,
 * dass es eine weitere Seite gibt (ohne zweiten count() zu erfordern).
 *
 * Warum statische Methoden? Der Service ist zustandslos — kein
 * Constructor-Inject nötig. Er fungiert als pure Helper-Klasse.
 */
@Injectable()
export class PaginationService {
  /**
   * Erstellt eine Cursor-Pagination-Response.
   *
   * @param items — vom Repository geliefert (Länge = pageSize oder pageSize + 1)
   * @param total — Gesamtanzahl (via parallel count)
   * @param pageSize — angefragte Page-Window-Größe
   * @param sortValueExtractor — function(item) → string (z.B. createdAt.toISOString())
   */
  static buildResponse<T extends { id: string }>(
    items: T[],
    total: number,
    pageSize: number,
    sortValueExtractor: (item: T) => string,
  ): PaginatedResult<T> {
    const hasMore = items.length > pageSize;
    const trimmedItems = hasMore ? items.slice(0, pageSize) : items;
    const lastItem = trimmedItems[trimmedItems.length - 1];
    const nextCursor =
      hasMore && lastItem
        ? CursorCodec.encode(lastItem.id, sortValueExtractor(lastItem))
        : null;
    return {
      items: trimmedItems,
      nextCursor,
      total,
      hasMore,
    };
  }

  /**
   * Erstellt eine Legacy-Offset-Pagination-Response (für Backwards-Compat).
   *
   * @param items — aktuelle Page
   * @param total — Gesamtanzahl
   * @param page — aktuelle Seite (1-indexed)
   * @param pageSize — Größe pro Page
   */
  static buildLegacyResponse<T>(
    items: T[],
    total: number,
    page: number,
    pageSize: number,
  ): {
    items: T[];
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
  } {
    const hasMore = page * pageSize < total;
    return {
      items,
      page,
      pageSize,
      total,
      hasMore,
    };
  }

  /**
   * Baut die Keyset-Bedingung fuer `(sortField, id)` bei DESC-Sortierung.
   *
   * BEFUND 2026-10-14: Sieben Aufrufstellen filterten nur nach dem
   * Zeitstempel (`{ updatedAt: { lt: cursorDate } }`) und warfen die `id` aus
   * dem Token weg — obwohl `encode()` sie hineingeschrieben hatte und der
   * Kommentar einen "Stable Tiebreaker" versprach. Bei zwei Datensaetzen mit
   * identischem `updatedAt` heisst `< cursorDate`: alles mit GLEICHEM
   * Zeitstempel faellt weg.
   *
   * Gemessen (5 Bilanzen mit identischem `updatedAt`, `pageSize=2`):
   *
   *     Seite 1: 2 Items, nextCursor=ja
   *     Seite 2: 0 Items, nextCursor=nein
   *     erwartet GJ 2201-2205, gesehen: 2201
   *     ERGEBNIS: 1/5 — ITEMS FEHLEN
   *
   * Fuer eine Kanzlei ist das kein Schoenheitsfehler: wer die Bilanzliste
   * durchblaettert, uebersieht Belege, und `total` im Response behauptet
   * gleichzeitig, es gaebe sechs.
   *
   * Korrekt fuer DESC auf `(field, id)`:
   *   `(field < sortValue) OR (field = sortValue AND id < cursorId)`
   *
   * Eine zentrale Funktion statt sieben Kopien — die Wiederholung ist genau
   * der Grund, warum der Fehler ueberall stand.
   *
   * @param cast — wandelt den Sortierwert (z.B. ISO-Datum) in den Typ, den
   *   Prisma erwartet. Bei `firmenname` nicht noetig (String).
   */
  static cursorCondition(
    cursor: string | undefined,
    sortField: 'updatedAt' | 'createdAt' | 'firmenname' | 'preparedAt',
    richtung: 'asc' | 'desc',
    idRichtung: 'asc' | 'desc',
    cast?: (wert: string) => Date,
  ): Array<Record<string, unknown>> | undefined {
    if (!cursor) return undefined;

    const { id, sortValue } = CursorCodec.decode(cursor);
    const wert = cast ? cast(sortValue) : sortValue;
    if (wert instanceof Date && Number.isNaN(wert.getTime())) {
      throw new BadRequestException(
        `cursor ist ungueltig (Sortierwert "${sortValue}" ist kein Datum)`,
      );
    }

    // „Danach" heisst: streng groesser/kleiner ODER gleicher Sortierwert mit
    // passendem id-Vergleich. Die Richtung muss EXAKT dem `orderBy` der
    // aufrufenden Query entsprechen — deshalb sind beide Parameter Pflicht
    // und nicht mit einem Default vorbelegt.
    const vor = richtung === 'desc' ? { lt: wert } : { gt: wert };
    const idVergleich = idRichtung === 'desc' ? { lt: id } : { gt: id };

    return [{ [sortField]: vor }, { [sortField]: wert, id: idVergleich }];
  }
}