/**
 * Validation-Ergebnis einer Bilanz.
 *
 * Wird sowohl vom Server (POST /api/bilanz/:id/validate) als auch vom
 * Frontend (Live-Feedback) konsumiert.
 */
export interface BilanzValidierungDto {
  /** Summe aller AKTIVA-Positionen. */
  aktivaSumme: number;

  /** Summe aller PASSIVA-Positionen. */
  passivaSumme: number;

  /** |aktivaSumme - passivaSumme|. */
  differenz: number;

  /** True wenn aktivaSumme == passivaSumme (innerhalb 1¢ Toleranz). */
  saldostimmt: boolean;

  /** Liste von Pflichtpositionen, die nicht befüllt sind (z.B. "B.IV. Kassenbestand"). */
  fehlendePflichtfelder: string[];

  /** Anzahl AKTIVA-Positionen. */
  anzahlAktivaPositionen: number;

  /** Anzahl PASSIVA-Positionen. */
  anzahlPassivaPositionen: number;
}

/**
 * Response-Format für POST /api/bilanz (mit Warning-Block bei
 * Saldo-Ungleichgewicht).
 */
export interface CreateBilanzResponse {
  bilanz: import('../../../common/repositories/bilanz.repository').BilanzEntity;
  validierung: BilanzValidierungDto;
  warnungen?: string[];
}