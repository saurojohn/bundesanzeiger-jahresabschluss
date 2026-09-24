/**
 * IDW PS 880 — Plausibilitätsregeln für die Vorprüfung elektronisch
 * vorgelegter Jahresabschlüsse.
 *
 * 5 Standardregeln für den M3-Pilot:
 *   1. IDW_EK_QUOTE             — Eigenkapitalquote ≥ 0 (keine Überschuldung, § 19 InsO)
 *   2. IDW_LIQUIDITAET_1        — Liquidität 1. Grades ≥ 0 (flüssige Mittel)
 *   3. IDW_VERSCHULDUNGSGRAD    — Verschuldungsgrad ≤ 1000%
 *   4. IDW_ANLAGEVERMOEGEN_BIS_AKTIVA — Anlagevermögen ≤ Bilanzsumme
 *   5. IDW_GOING_CONCERN        — EK + langfristige Rückstellungen ≥ 50% Aktiva
 *
 * Jede Regel hat eine Konfiguration mit Schwellwert, Vergleichsoperator
 * und Einheit. Diese werden bei der Auswertung gegen den berechneten Wert
 * geprüft. PASSED wenn Vergleich erfüllt, KRITISCH/WARNUNG sonst.
 */

export type RegelStatus = 'PASSED' | 'WARNUNG' | 'KRITISCH';
export type RegelSchweregrad = 'INFO' | 'WARNUNG' | 'KRITISCH';
export type VergleichsOperator = '>=' | '<=' | '>' | '<' | '==' | '!=';
export type Einheit = 'PROZENT' | 'EURO' | 'FAKTOR';

export interface IDWRegelKonfiguration {
  schwellwert: number;
  vergleichsOperator: VergleichsOperator;
  einheit: Einheit;
}

export interface IDWRegelDefinition {
  code: string;
  name: string;
  beschreibung: string;
  schweregrad: RegelSchweregrad;
  konfiguration: IDWRegelKonfiguration;
  reihenfolge: number;
}

/**
 * Die 5 IDW-Standardregeln für den Pilot-Workflow.
 *
 * Quelle: IDW PS 880 (Stand 2024), ergänzt um bankübliche Schwellwerte
 * (Verschuldungsgrad 1000% als oberer Plausi-Wert).
 */
export const IDW_STANDARDREgeln: IDWRegelDefinition[] = [
  {
    code: 'IDW_EK_QUOTE',
    name: 'Eigenkapitalquote ≥ 0 (keine Überschuldung)',
    beschreibung:
      'Die Eigenkapitalquote muss ≥ 0 sein, sonst liegt eine bilanzielle Überschuldung gemäß § 19 InsO vor.',
    schweregrad: 'KRITISCH',
    konfiguration: { schwellwert: 0, vergleichsOperator: '>=', einheit: 'PROZENT' },
    reihenfolge: 1,
  },
  {
    code: 'IDW_LIQUIDITAET_1',
    name: 'Liquidität 1. Grades ≥ 0',
    beschreibung:
      'Die flüssigen Mittel (Kassenbestand + Bankguthaben, HGB-Position B.IV.) müssen ≥ 0 sein.',
    schweregrad: 'KRITISCH',
    konfiguration: { schwellwert: 0, vergleichsOperator: '>=', einheit: 'EURO' },
    reihenfolge: 2,
  },
  {
    code: 'IDW_VERSCHULDUNGSGRAD',
    name: 'Verschuldungsgrad ≤ 1000%',
    beschreibung:
      'Verbindlichkeiten + Rückstellungen / Eigenkapital × 100 ≤ 1000%. Branchenabhängig — Industrieunternehmen typisch ≤ 500%.',
    schweregrad: 'WARNUNG',
    konfiguration: { schwellwert: 1000, vergleichsOperator: '<=', einheit: 'PROZENT' },
    reihenfolge: 3,
  },
  {
    code: 'IDW_ANLAGEVERMOEGEN_BIS_AKTIVA',
    name: 'Anlagevermögen ≤ Aktiva-Summe',
    beschreibung:
      'Das Anlagevermögen (HGB-Position A.) darf die Bilanzsumme nicht überschreiten — sonst liegt ein Sanktionierungs-Verbot vor.',
    schweregrad: 'KRITISCH',
    konfiguration: { schwellwert: 0, vergleichsOperator: '>=', einheit: 'EURO' },
    reihenfolge: 4,
  },
  {
    code: 'IDW_GOING_CONCERN',
    name: 'Going Concern: EK + langfristige Rückstellungen ≥ 50% Aktiva',
    beschreibung:
      'Wenn Eigenkapital + langfristige Rückstellungen < 50% der Bilanzsumme, besteht ein Going-Concern-Risiko (§ 252 HGB).',
    schweregrad: 'WARNUNG',
    konfiguration: { schwellwert: 50, vergleichsOperator: '>=', einheit: 'PROZENT' },
    reihenfolge: 5,
  },
];

/**
 * Schneller Lookup per Code.
 */
export const IDW_REGEL_BY_CODE: Record<string, IDWRegelDefinition> =
  IDW_STANDARDREgeln.reduce<Record<string, IDWRegelDefinition>>((acc, r) => {
    acc[r.code] = r;
    return acc;
  }, {});

/**
 * HGB-Kontonummern-Gruppen, die für die IDW-Regeln relevant sind.
 */
export const HGB_KONTONUMMER = {
  ANLAGEVERMOEGEN_GRUPPE: 'A.', // Obergruppe Anlagevermögen (Aktiva)
  FLUESSIGE_MITTEL: 'B.IV.', // Kassenbestand, Bankguthaben, Schecks
  EIGENKAPITAL_OBERGRUPPE: 'A.', // Passiv-Seite EK (HGB kontonummer-Konflikt mit Aktiva!)
  GEZEICHNETES_KAPITAL: 'A.I.', // Gezeichnetes Kapital (Passiv)
  KAPITALRUECKLAGE: 'A.II.',
  GEWINNRUECKLAGEN: 'A.III.',
  GEWINNVORTRAG: 'A.IV.',
  JAHRESUEBERSCHUSS: 'A.V.',
  RUECKSTELLUNGEN_OBERGRUPPE: 'B.',
  PENSIONSRUECKSTELLUNGEN: 'B.1.', // langfristig
  STEUERRUECKSTELLUNGEN: 'B.2.', // kurzfristig (idR)
  SONSTIGE_RUECKSTELLUNGEN: 'B.3.',
  VERBINDLICHKEITEN_OBERGRUPPE: 'C.',
} as const;

/**
 * Langfristige Rückstellungen (für Going-Concern-Berechnung).
 * Per IDW-Konvention: Pensionsrückstellungen gelten als langfristig.
 */
export const LANGFRISTIGE_RUECKSTELLUNGEN_KONTONUMMERN = new Set<string>([
  HGB_KONTONUMMER.PENSIONSRUECKSTELLUNGEN,
]);

/**
 * Helper: führt einen numerischen Vergleich durch und liefert PASSED,
 * falls die Bedingung erfüllt ist.
 */
export function evaluateOperator(
  berechneterWert: number,
  operator: VergleichsOperator,
  schwellwert: number,
): boolean {
  switch (operator) {
    case '>=':
      return berechneterWert >= schwellwert;
    case '<=':
      return berechneterWert <= schwellwert;
    case '>':
      return berechneterWert > schwellwert;
    case '<':
      return berechneterWert < schwellwert;
    case '==':
      return berechneterWert === schwellwert;
    case '!=':
      return berechneterWert !== schwellwert;
    default:
      return false;
  }
}