/**
 * Saldo-Regel fuer alle Abschluss-Arten (Einzelabschluss § 264 HGB,
 * Konzernabschluss PublG § 11).
 *
 * Bugfix 2026-10-06. Drei Stellen hatten jeweils eine eigene Kopie der
 * Toleranz — und KEINE davon hat sie so angewendet, wie sie benannt war:
 *
 *   const SALDO_TOLERANZ_CENTS = 1; // 0.01 EUR Toleranz
 *   ...
 *   Math.abs(aktivaSumme - passivaSumme) < SALDO_TOLERANZ_CENTS
 *
 * `aktivaSumme` ist in EUR. Die Konstante sagt „Cents", verglichen
 * wurde aber in Euro. Effektiv war die Toleranz 1,00 EUR statt der
 * dokumentierten 0,01 EUR — eine Differenz von 0,90 EUR galt als
 * saldostimmig. Im E-Bilanz-Modul stand zusaetzlich `differenz >
 * SALDO_TOLERANZ_CENTS`, sodass dort sogar genau 1,00 EUR durchging.
 *
 * Diese Datei ist die einzige Quelle der Wahrheit. Betraege werden
 * vorher auf Cent gerundet, damit Gleitkomma-Artefakte
 * (0.1 + 0.2 = 0.30000000000000004) nicht in eine Fehlentscheidung
 * fuehren.
 */

/** Toleranz in Cent: Differenzen bis einschliesslich 1 Cent sind toleriert. */
export const SALDO_TOLERANZ_CENTS = 1;

/**
 * Betragsdifferenz in Cent (gerundet, vorzeichenfrei).
 */
export function saldoDifferenzInCent(
  aktivaSumme: number,
  passivaSumme: number,
): number {
  return Math.round(Math.abs(aktivaSumme - passivaSumme) * 100);
}

/**
 * Stimmt die Bilanz ueberhaupt?
 *
 * Regel: eine Differenz von maximal `SALDO_TOLERANZ_CENTS` (1 Cent)
 * gilt als Rundungsdifferenz und ist toleriert.
 *
 * Diese Funktion wird ueberall dort benutzt, wo sonst eine eigene
 * Kopie der Toleranz entstanden ist. Gate (Generierung) und
 * Pruefung (Validator) muessen dieselbe Antwort geben — sonst erzeugt
 * das System im Grenzfall eine Datei und meldet sie gleichzeitig als
 * nicht saldostimmig.
 */
export function saldoStimmt(
  aktivaSumme: number,
  passivaSumme: number,
): boolean {
  return saldoDifferenzInCent(aktivaSumme, passivaSumme) <= SALDO_TOLERANZ_CENTS;
}