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
 * ERLAUBT SIND BEIDE NOTATIONEN — und zwar dieselben wie in der Oberflaeche
 * (`frontend/src/lib/zahl.ts`, `parseZahl`):
 *
 *   "12345.67"   englisch
 *   "12345,67"   deutsch
 *   "1.234,56"   deutsch mit Tausendertrennzeichen
 *
 * KORREKTUR 2026-10-15: Die erste Fassung erlaubte nur ein einzelnes
 * Komma ODER einen Punkt am Ende — "1.234,56" wurde abgelehnt, waehrend
 * dasselbe Feld im Bilanz-Formular jetzt ausdruecklich unterstuetzt wird.
 * Die Anwendung hatte damit an einer Stelle eine Notation eingefuehrt und
 * an einer anderen verboten. Regeln, die auseinanderlaufen, sind zwei
 * Fehlerquellen statt einer.
 *
 * Der Test `betrag-grenzen.spec.ts` haelt beide Seiten deckungsgleich —
 * dieselbe Fallliste, dieselbe Erwartung.
 *
 * ZWEITER FEHLER DERSELBEN ÄNDERUNG — von der CI gefunden (Lauf 38876133530):
 * Die Fassung mit `\d+` im zweiten Zweig hatte **keine Zifferngrenze**. Damit
 * kam die 24-stellige Zahl wieder durch, die `Decimal(18,2)` nicht fasst —
 * der 500er aus Nachtrag 16, den diese Änderung eigentlich beheben sollte,
 * war damit erneut ausloesbar. Die Belegung ist jetzt an der Spaltenbreite
 * festgemacht: hoechstens 16 Ziffern im Ganzen, was `Decimal(18,2)` genau
 * entspricht.
 *
 * `\d{1,3}(?:\.\d{3}){0,5}` erlaubt 1 + 5*3 = 16 Ziffern in deutscher
 * Schreibweise; `\d{1,16}` dieselbe Zahl ohne Trenner. Geprueft gegen die
 * Datenbank, nicht gegen mein Gefuehl fuer "reicht".
 */
export const BETRAG_STRING_PATTERN =
  /^-?\d{1,3}(?:\.\d{3}){0,5}(?:,\d{1,2})?$|^-?\d{1,16}(?:[.,]\d{1,2})?$/;
