import { Injectable } from '@nestjs/common';
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
   * Berechnet den SQL-WHERE-Filter aus einem opaken Cursor-Token.
   *
   * Standard-Implementierung: Suche Items mit `updatedAt < sortValue`
   * (für DESC-Sort). Andere Sortier-Felder müssen analoge Helper
   * bereitstellen.
   */
  static whereFromCursor(
    cursor: string | undefined,
    field: 'updatedAt' | 'createdAt' = 'updatedAt',
  ): { field: string; sortValue: Date } | null {
    if (!cursor) return null;
    const { sortValue } = CursorCodec.decode(cursor);
    const parsed = new Date(sortValue);
    if (Number.isNaN(parsed.getTime())) {
      // Invalid cursor → null (Repository behandelt das als erste Page)
      return null;
    }
    return { field, sortValue: parsed };
  }
}