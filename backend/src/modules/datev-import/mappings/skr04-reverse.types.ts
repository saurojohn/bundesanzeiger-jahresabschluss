/**
 * DATEV-SKR04 → HGB Reverse-Mapping — Typen.
 *
 * Beim DATEV-Import mappen wir DATEV-Sachkonten zurück auf unsere internen
 * HGB-Positionen. Diese Typen beschreiben die Mapping-Struktur.
 *
 * Konvention:
 *   - `side: 'AKTIVA' | 'PASSIVA' | 'NEUTRAL'`: Bilanz-Seite der HGB-Position
 *   - `kategorie`: Wechselt zwischen Bilanz (BILANZ_AKTIVA/PASSIVA) und
 *     GuV-Kategorien (ERLOES, MATERIAL, PERSONAL, ...).
 *   - `confidence`: 0-1, drückt die Eindeutigkeit des Mappings aus.
 *     - 1.0: Eindeutig (z. B. "1800 Bank" → B.IV. Bankguthaben)
 *     - 0.7: Default (Standard-Mapping)
 *     - < 0.5: Sammelkonto, das mehrere HGB-Positionen abdeckt
 */
export type HgbKategorie =
  | 'ERLOES'
  | 'MATERIAL'
  | 'PERSONAL'
  | 'ABSCHREIBUNG'
  | 'SONSTIGE_ERTRAG'
  | 'SONSTIGE_AUFWAND'
  | 'STEUER'
  | 'FINANZ'
  | 'BILANZ_AKTIVA'
  | 'BILANZ_PASSIVA';

export type HgbSide = 'AKTIVA' | 'PASSIVA' | 'NEUTRAL';

export interface ReverseMapping {
  /** DATEV-Sachkonto (z. B. "4400"). */
  datevKonto: string;
  /** Bezeichnung des DATEV-Kontos (z. B. "Beratungserlöse"). */
  datevKontoName: string;
  /**
   * HGB-Position (z. B. "1." für Umsatzerlöse, "B.IV." für Bankguthaben).
   * Wird als Schlüssel für Bilanz-/GuV-Positionen verwendet.
   */
  hgbPosition: string;
  /** HGB-Referenz-Kontonummer (z. B. "8400"). */
  hgbKontoNr: string;
  /** Kategorie für GuV-Mapping oder Bilanz-Indikator. */
  kategorie: HgbKategorie;
  /** Bilanz-Seite. */
  side: HgbSide;
  /**
   * true, wenn das Konto HGB-pflichtig befüllt sein muss
   * (z. B. Bankguthaben, Gezeichnetes Kapital).
   */
  isPflicht: boolean;
  /**
   * 0-1 Confidence-Score.
   *   - 1.0: Eindeutig
   *   - 0.7-0.9: Standard-Mapping
   *   - < 0.5: Sammelkonto, mehrere HGB-Positionen möglich
   */
  confidence: number;
  /** Optionale Notizen für die Kanzlei. */
  notes?: string;
}

/**
 * Mapping-Ergebnis pro Sachkonto nach Auto-Mapping + ggf. User-Override.
 */
export interface MappedPosition {
  /** DATEV-Sachkonto. */
  datevKonto: string;
  /** Saldo (Σ Soll - Σ Haben). */
  saldo: number;
  /** Anzahl der Buchungen zu diesem Konto. */
  buchungsCount: number;
  /** Resolved Reverse-Mapping (nach Auto + Override). */
  mapping: ReverseMapping | null;
  /** true, wenn Auto-Mapping erfolgreich (ohne User-Override). */
  autoMapped: boolean;
  /** true, wenn User-Override angewendet wurde. */
  userOverride: boolean;
  /** Warning (falls Mapping-Confidence niedrig oder Override fehlt). */
  warning?: string;
}