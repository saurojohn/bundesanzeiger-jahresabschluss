/**
 * DATEV — SKR-Kontenplan-Definitionen.
 *
 * Diese Datei beschreibt die gemeinsamen Typen für die Mapping-Tabellen
 * zwischen HGB-Konten und DATEV-SKR03/SKR04-Konten.
 *
 * Hintergrund (siehe docs/banz-schemata.md §3):
 *   DATEV akzeptiert Buchungen nur über SKR-Konten (Standard-Kontenrahmen 03 oder 04).
 *   Unser System erfasst Bilanz/GuV nach HGB-Positionen — die Mapping-Tabellen
 *   verbinden unsere HGB-Konten (z.B. "B.II.4.") mit SKR04-Konten (z.B. "1400").
 *
 * Kontenplan-Versionen:
 *   - SKR03: Standard-Kontenrahmen 03 (DATEV-Standard für ältere Kanzleien)
 *   - SKR04: Standard-Kontenrahmen 04 (DATEV-Standard seit 2011)
 *
 * Quelle: DATEV-Kontenplan-Spezifikation (https://www.datev.de)
 */

/** Unterstützte Kontenpläne. */
export type SkrPlan = 'SKR03' | 'SKR04';

/** Kategorie des SKR-Kontos. */
export type SkrKontoTyp =
  | 'ERTRAG' // Umsatzerlöse, sonstige Erträge (GuV-Erlösseite)
  | 'AUFWAND' // Material, Personal, Abschreibung, sonstige Aufwendungen
  | 'AKTIV' // Aktiva-Bilanz-Konto (Bestand)
  | 'PASSIV' // Passiva-Bilanz-Konto (Bestand)
  | 'NEUTRAL'; // Buchungs-/Gegen-Konto (z.B. 1800 Bank, 3300 Verbindlichkeiten L+L)

/**
 * Ein einzelnes DATEV-SKR-Konto.
 */
export interface SkrKonto {
  /** Kontonummer, 4- oder 5-stellig (z.B. "4400" oder "44000"). */
  konto: string;
  /** Bezeichnung (deutsch), z.B. "Beratungserlöse". */
  bezeichnung: string;
  /** Kontotyp für Mapping-Klassifikation. */
  kontoTyp: SkrKontoTyp;
  /** DATEV-Umsatzsteuer-Schlüssel: "0"=keine, "1"=19%, "3"=7%, "8"=10%, ... */
  umsatzsteuerCode?: string;
  /** DATEV-BU-Schlüssel (Standard "0" wenn leer). */
  buschluesselDefault?: string;
  /** HGB-Kategorien, die typischerweise auf dieses Konto gebucht werden. */
  hgbKategorien: string[];
  /** HGB-Kontenrahmen-Zeilen, die auf dieses Konto mappen (z.B. "B.II.4."). */
  hgbKontonummern: string[];
}