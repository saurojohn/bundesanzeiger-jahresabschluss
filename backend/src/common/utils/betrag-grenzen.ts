/**
 * Betragsgrenzen — abgeleitet aus dem Schema, nicht geschaetzt.
 *
 * BEFUND 2026-10-14: Vier Felder nahmen beliebige Werte an und liessen den
 * Fehler in der Datenbank landen. Gemessen (jeweils HTTP 500):
 *
 *   POST /api/bilanz    betragAktuell: 1e20
 *                       -> Postgres 22003 "numeric field overflow"
 *   POST /api/mandant   bilanzsummeVorjahr: "keine-zahl"
 *                       -> ungueltiger Decimal
 *   POST /api/mandant   bilanzsummeVorjahr: "999999999999999999999999"
 *                       -> numeric field overflow
 *   POST /api/mandant   mitarbeiterAnzahl: 99999999999
 *                       -> value out of range (Int4)
 *
 * Ein Klick im Formular genuegt, um den Server zu beenden. Der Wert ist
 * Kunden-Eingabe, kein Systemwert — er gehoert in die Validierung, nicht in
 * eine Exception des Datenbanktreibers.
 */

/**
 * `Decimal(18,2)` — Postgres verlangt `|x| < 10^16`.
 *
 * Der Wert liegt bewusst bei `10^15 - 1` statt bei `10^16`: `10^16` ist im
 * IEEE-Double NICHT exakt darstellbar (10^16 = 2^16 · 5^16, und 5^16 braucht
 * 38 Bit; ein Double hat 53). Eine Grenze mit Gleitkomma-Artefakt waere eine
 * Grenze mit zwei Wahrheiten. Knapp darunter zu liegen ist die
 * fail-closed-Richtung, und 1 Billiarde EUR ist keine Geschaeftsziffer.
 */
export const BETRAG_MAX = 999_999_999_999_999;

/** `Decimal(18,4)` — `|x| < 10^14`, entsprechend zwei Stellen niedriger. */
export const BETRAG_MAX_4 = 99_999_999_999_999;

/** `Decimal(5,2)` — `|x| < 10^3`. Die Beteiligungsquote ist zudem ein
 *  Prozentsatz und damit fachlich auf 0..100 begrenzt. */
export const QUOTE_MAX = 999.99;

/** `Int4` — Postgres-Spalte `mitarbeiterAnzahl`. */
export const INT4_MAX = 2_147_483_647;

/**
 * Format fuer Betraege, die laut DTO als STRING transportiert werden
 * ("Decimal als String (Prisma)").
 *
 * Erlaubt sind optional `-`, optional `+` nicht (Geld ist nicht negativ
 * signiert zu schreiben), Ziffern mit optionalem Komma und genau zwei
 * Nachkommastellen. Ohne diese Pruefung landet jeder Freitext in der
 * Decimal-Spalte.
 */
export const BETRAG_STRING_PATTERN = /^-?\d{1,16}(?:[.,]\d{1,2})?$/;
