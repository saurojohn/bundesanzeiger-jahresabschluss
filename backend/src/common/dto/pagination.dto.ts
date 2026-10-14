import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { BadRequestException, PipeTransform } from '@nestjs/common';

/**
 * Standard-Eingabe-Parameter für Listen-Endpoints mit Cursor-Pagination.
 *
 * - `pageSize` (default 20, max 100) — Anzahl der Items pro Page
 * - `cursor` — opaque Cursor-Token vom vorherigen Response
 * - `searchTerm` — optionaler Volltext-Filter (Mandant-/Belegname)
 *
 * Backwards-Compatibility: `page` (legacy offset) wird separat via
 * Query-Param unterstützt (siehe Controller-Layer).
 */
export class PaginationInputDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? Number.parseInt(value, 10) : value))
  @IsInt({ message: 'pageSize muss eine Ganzzahl sein' })
  @Min(1, { message: 'pageSize muss >= 1 sein' })
  @Max(100, { message: 'pageSize darf max 100 sein' })
  pageSize?: number = 20;

  @IsOptional()
  @IsString({ message: 'cursor muss ein String sein' })
  cursor?: string;

  @IsOptional()
  @IsString({ message: 'searchTerm muss ein String sein' })
  searchTerm?: string;
}

/**
 * Standard-Response für Cursor-paginierte Listen.
 *
 * - `items` — gefundene Datensätze (max pageSize)
 * - `nextCursor` — Token für die nächste Page (null wenn letzte Page erreicht)
 * - `total` — Gesamtanzahl der Datensätze (für hasMore-Berechnung)
 * - `hasMore` — true wenn weitere Pages existieren
 */
export interface PaginatedResult<T> {
  items: T[];
  nextCursor: string | null;
  total: number;
  hasMore: boolean;
}

/**
 * Backwards-Compatibility: Legacy-Response mit Offset-Pagination.
 *
 * Bleibt für ältere Clients erhalten (z.B. Bilanzlisten mit `?page=2`).
 * Wird parallel zur Cursor-Response unterstützt.
 */
export interface LegacyPaginatedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

/**
 * Codec für opaque Cursor-Tokens.
 *
 * Cursors werden base64-kodiert als `<id>:<sortValue>` Paar gespeichert.
 * - `id` — Entity-ID (für Stable Tiebreaker)
 * - `sortValue` — Sort-Key (z.B. updatedAt ISO-String)
 *
 * Vorteile:
 * - Opaque für Clients (kein SQL-Injection-Risiko)
 * - Selbst-validierend (Decoder prüft Format)
 * - Sort-Field-Wechsel führt zu 400-Error (graceful)
 */
export class CursorCodec {
  /**
   * Encode id + sortValue to opaque cursor.
   */
  static encode(id: string, sortValue: string): string {
    return Buffer.from(`${id}:${sortValue}`, 'utf-8').toString('base64');
  }

  /**
   * Decode cursor to {id, sortValue}.
   *
   * STRIKT seit 2026-10-14. Zuvor galt: fehlt der Trenner, wurde die ganze
   * Zeichenkette als `id` UND `sortValue` gelesen, und ein nicht als Datum
   * interpretierbarer Wert fiel in `whereFromCursor` auf `null` — die
   * Anfrage lief dann einfach als "erste Seite" weiter. Gemessen: `?cursor=notbase64`,
   * `?cursor=!!!!`, `?cursor=x` lieferten alle 200 mit der ersten Seite,
   * ohne jede Fehlermeldung. Der Kommentar versprach hier "Selbst-validierend
   * (Decoder prueft Format)" und "Sort-Field-Wechsel fuehrt zu 400" — beides
   * war nicht implementiert.
   *
   * Fail-closed: ein Cursor, den der Server nie ausgegeben hat, ist ein
   * Fehler des Clients, und der wird gesagt. Ein stillschweigend ignorierter
   * Cursor liefert dem Aufrufer die erste Seite und laesst ihn glauben, er
   * blaettere weiter.
   */
  static decode(cursor: string): { id: string; sortValue: string } {
    let decoded: string;
    try {
      decoded = Buffer.from(cursor, 'base64').toString('utf-8');
    } catch {
      throw new BadRequestException('cursor ist ungueltig (kein Base64)');
    }

    const idx = decoded.indexOf(':');
    if (idx <= 0) {
      throw new BadRequestException(
        'cursor ist ungueltig (erwartet wird <id>:<sortierwert>)',
      );
    }
    const id = decoded.slice(0, idx);
    const sortValue = decoded.slice(idx + 1);
    if (!id || !sortValue) {
      throw new BadRequestException(
        'cursor ist ungueltig (id oder Sortierwert fehlt)',
      );
    }
    return { id, sortValue };
  }
}
/**
 * Pipe mit harter Obergrenze fuer ganzzahlige Query-Parameter.
 *
 * Warum nicht `ParseIntPipe` + `exceptionFactory`: die exceptionFactory wird
 * laut Nest nur aufgerufen, wenn das PARSEN scheitert. `pageSize=200` parst
 * erfolgreich — der Grenzwert wuerde also nie geprueft. Diese Pipe prueft
 * deshalb selbst im `transform`.
 */
export class BoundedIntPipe implements PipeTransform<unknown, number | undefined> {
  constructor(
    private readonly max: number,
    private readonly paramName: string,
  ) {}

  transform(value: unknown): number | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const parsed =
      typeof value === 'number' ? value : Number.parseInt(String(value), 10);
    if (Number.isNaN(parsed)) {
      throw new BadRequestException(`${this.paramName} muss eine Ganzzahl sein`);
    }
    if (parsed < 1) {
      throw new BadRequestException(`${this.paramName} muss >= 1 sein`);
    }
    if (parsed > this.max) {
      throw new BadRequestException(`${this.paramName} darf max ${this.max} sein`);
    }
    return parsed;
  }
}

/** `pageSize` — optional, 1..100. */
export const pageSizePipe = new BoundedIntPipe(100, 'pageSize');

/** `limit` — optional, 1..200 (Webhooks). */
export const limitPipe = new BoundedIntPipe(200, 'limit');
