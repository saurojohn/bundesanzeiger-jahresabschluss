/**
 * Zahlen im deutschen Zahlenformat.
 *
 * BEFUND 2026-10-15: Alle Betragsfelder waren `<input type="number">`, und
 * das erlaubt nur den Punkt als Dezimaltrenner. In einer deutschen
 * Buchhaltung tippt niemand Punkte. Gemessen im Browser:
 *
 *   Eingabe "1.500"       -> Wert "1.500"  -> gespeichert als 1,5
 *   Eingabe "150000,50"   -> Wert "0150000.50" (das Komma wird verworfen)
 *
 * Der erste Fall ist der schwere: Wer "1.500" tippt, meint tausendfünfhundert
 * und bekommt eineinhalb — ein Faktor-1000-Fehler in einer Bilanzposition,
 * ohne Fehlermeldung, ohne Markierung, beim Speichern still übernommen.
 *
 * `type="number"` kann das nicht lösen: "1.500" ist dort ein gültiger Wert,
 * und die Absicht des Tippenden ist von der Eingabe nicht unterscheidbar.
 * Nur eine explizite Auflösung der deutschen Schreibweise hilft.
 *
 * Die Schreibweise ist eindeutig, weil sie eindeutig ist:
 *   Punkt = Tausendertrenner, Komma = Dezimaltrenner.
 * "1.500" ist demnach 1500 (kein Tausendertrenner ergibt eine Dreistelligkeit
 * mit Nachkommastelle in diesem Feld) und "1500,50" ist 1500,50.
 */

/** Erlaubte Eingabe: Ziffern, optional ein Punkt als Tausendertrenner, optional Komma+DZ. */
const DEUTSCH = /^-?\d{1,3}(?:\.\d{3})*(?:,\d+)?$|^-?\d+(?:,\d+)?$/;

/**
 * Wandelt eine deutsche Eingabe in eine Zahl.
 *
 * @returns die Zahl, oder `null` wenn die Eingabe keine Zahl ist.
 *   `null` statt `0` — denn 0 ist ein gueltiger Buchungswert, und ein
 *   Tippfehler darf nicht wie eine 0 aussehen.
 */
export function parseZahl(roh: string): number | null {
  const wert = roh.trim();
  if (wert === '' || wert === '-') return null;
  // "1.234.567,89" bzw. "1234,89" bzw. "-1.234,56"
  if (!DEUTSCH.test(wert)) return null;

  const normalisiert = wert.replace(/\./g, '').replace(',', '.');
  const zahl = Number(normalisiert);
  return Number.isFinite(zahl) ? zahl : null;
}

/**
 * Formatiert eine Zahl in der deutschen Schreibweise — der Wert, der dem
 * Nutzer angezeigt wird, ist damit exakt der Wert, der gespeichert wird.
 */
export function formatZahl(
  wert: number | null | undefined,
  nachkommaStellen: 0 | 2 = 2,
): string {
  if (wert === null || wert === undefined || !Number.isFinite(wert)) return '';
  return wert.toLocaleString('de-DE', {
    minimumFractionDigits: nachkommaStellen,
    maximumFractionDigits: nachkommaStellen,
  });
}
