import { BadRequestException, PipeTransform } from '@nestjs/common';

/**
 * Pipes fuer Query-Parameter, die in typisierte Spalten gehen.
 *
 * BEFUND 2026-10-15: Mehrere Listen-Endpoints nahmen beliebige Strings fuer
 * Datum- und Jahres-Spalten. Gemessen, jeweils HTTP 500 mit unbehandeltem
 * Prisma-Fehler:
 *
 *   GET /api/audit?from=abc          -> 500
 *   GET /api/audit?to=31.12.2025     -> 500   (deutsches Format!)
 *   GET /api/audit?from=2025-13-45   -> 500   (kein Kalenderdatum)
 *   GET /api/bilanz?geschaeftsjahr=abc           -> 500
 *   GET /api/bilanz?geschaeftsjahr=99999999999   -> 500 (Int4-Ueberlauf)
 *
 * `to=31.12.2025` ist keine Fantasie: das ist die Schreibweise, in der ein
 * Anwender ein Datum eingibt und in der ein Formular es ungeprueft
 * weiterreichen kann.
 *
 * Ein Filter-Parameter ist Kunden-Eingabe. Er gehoert hierher und nicht in
 * einen Prisma-Fehler.
 */

/**
 * `geschaeftsjahr` — ganzzahlig, im Bereich der Int4-Spalte.
 *
 * Der Bereich ist technisch, nicht fachlich: die Spalte heisst `Int`. Eine
 * fachliche Untergrenze (etwa 1900) waere eine erfundene Regel und wuerde
 * historische Mandanten aussperren.
 */
export class GeschaeftsjahrPipe implements PipeTransform<unknown, number | undefined> {
  transform(value: unknown): number | undefined {
    if (value === undefined || value === null || value === '') return undefined;

    const roh = String(value).trim();
    // `parseInt` haette hier still 42 aus "42abc" gemacht — und "abc" zu NaN.
    if (!/^-?\d{1,10}$/.test(roh)) {
      throw new BadRequestException(
        `geschaeftsjahr muss eine ganze Zahl sein — war "${String(value).slice(0, 40)}"`,
      );
    }
    const zahl = Number.parseInt(roh, 10);
    if (!Number.isSafeInteger(zahl) || zahl > 2_147_483_647 || zahl < -2_147_483_648) {
      throw new BadRequestException(
        'geschaeftsjahr liegt ausserhalb des unterstützten Bereichs',
      );
    }
    return zahl;
  }
}

/**
 * Datums-Parameter fuer DateTime-Spalten (ISO-8601).
 *
 * Bewusst **nur** ISO-8601: `new Date()` akzeptiert viele Formate
 * (`31.12.2025`, `2025/12/31`), und eine Filter-API, die drei Formate
 * akzeptiert, ist am Ende eine, bei der niemand weiss welches gilt. Die
 * Oberflaeche formatiert ohnehin auf ISO.
 */
export class IsoDatumPipe implements PipeTransform<unknown, Date | undefined> {
  constructor(private readonly paramName = 'datum') {}

  transform(value: unknown): Date | undefined {
    if (value === undefined || value === null || value === '') return undefined;

    const roh = String(value).trim();
    //ISO-Datum mit Zeit, mit T oder Space, optionaler Zeitzone.
    if (!/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(roh)) {
      throw new BadRequestException(
        `${this.paramName} muss ein ISO-Datum sein (JJJJ-MM-TT) — war "${roh.slice(0, 40)}"`,
      );
    }
    const datum = new Date(roh.length === 10 ? `${roh}T00:00:00.000Z` : roh);
    if (Number.isNaN(datum.getTime())) {
      throw new BadRequestException(
        `${this.paramName} ist kein gueltiges Kalenderdatum — war "${roh.slice(0, 40)}"`,
      );
    }

    // `new Date('2025-02-30')` ist KEIN NaN — JavaScript rechnet auf den
    // 2. Maerz um. `2025-13-45` liefert NaN und wurde abgelehnt,
    // `2025-02-30` dagegen still zum 2. Maerz. Genau diese stille
    // Umwandlung ist der Befund, den diese Pipe abstellen soll — sie
    // darf ihn nicht selbst reproduzieren. Deshalb wird der Kalender
    // gegen seine eigene normalized Form geprueft.
    const [jahr, monat, tag] = roh.slice(0, 10).split('-').map(Number);
    if (
      datum.getUTCFullYear() !== jahr ||
      datum.getUTCMonth() + 1 !== monat ||
      datum.getUTCDate() !== tag
    ) {
      throw new BadRequestException(
        `${this.paramName} ist kein gueltiges Kalenderdatum — war "${roh.slice(0, 40)}"`,
      );
    }

    return datum;
  }
}

/** `geschaeftsjahr` in den Listen-Endpoints. */
export const geschaeftsjahrPipe = new GeschaeftsjahrPipe();

/** `from` im Audit-Log. */
export const auditFromPipe = new IsoDatumPipe('from');
/** `to` im Audit-Log. */
export const auditToPipe = new IsoDatumPipe('to');
