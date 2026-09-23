/**
 * Validation-Ergebnis einer GuV.
 *
 * Saldo = Σ Erlöse - Σ Aufwendungen (positive Werte = Erträge,
 * negative = Aufwendungen — oder umgekehrt je nach Konvention).
 *
 * Vereinfachte Konvention hier: betragAktuell ist IMMER positiv für
 * Erträge (ERLOES, FINANZ-Erträge) und IMMER positiv für Aufwendungen
 * (MATERIAL, PERSONAL, etc.) — die Vorzeichen-Korrektur passiert in
 * der Validation.
 */
export interface GuVValidierungDto {
  /** Summe aller Erlöse / Erträge (positive Werte). */
  summeErloese: number;

  /** Summe aller Aufwendungen (positive Werte, werden abgezogen). */
  summeAufwendungen: number;

  /** SummeErloese - SummeAufwendungen. */
  differenz: number;

  /** Positiv = Jahresüberschuss, Negativ = Jahresfehlbetrag. */
  jahresergebnis: number;

  /** True wenn differenz > 0 (Überschuss). */
  istUeberschuss: boolean;

  /** Welche Positionen den Saldo ggf. erklären. */
  positionenMitBetrag: number;

  fehlendePflichtfelder: string[];
}

/**
 * Response-Format für POST /api/guv (mit Warnings).
 */
export interface CreateGuVResponse {
  guv: import('../../../common/repositories/guv.repository').GuVEntity;
  validierung: GuVValidierungDto;
  warnungen?: string[];
}