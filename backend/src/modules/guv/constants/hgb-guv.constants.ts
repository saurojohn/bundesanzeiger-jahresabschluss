/**
 * HGB § 275 — Gewinn- und Verlustrechnung.
 *
 * Zwei Verfahren:
 *   - GKV (Gesamtkostenverfahren, § 275 Abs. 2 HGB) — gruppiert nach
 *     Erlös-/Aufwandsarten. Standard für die meisten Unternehmen.
 *   - UKV (Umsatzkostenverfahren, § 275 Abs. 1 HGB) — gruppiert nach
 *     Funktionsbereichen (Herstellung, Vertrieb, Verwaltung).
 *
 * Jede Position hat:
 *   - `kontonummer`: HGB-interne Position (z.B. "1.").
 *   - `bezeichnung`: Deutsche Bezeichnung gem. HGB.
 *   - `kategorie`: ERLOES | MATERIAL | PERSONAL | ABSCHREIBUNG | SONSTIGE | STEUER | FINANZ.
 *   - `parentId`: Verweis auf übergeordnete Position (z.B. "5." → "5a" und "5b").
 */
export type GuVKategorie =
  | 'ERLOES'
  | 'MATERIAL'
  | 'PERSONAL'
  | 'ABSCHREIBUNG'
  | 'SONSTIGE'
  | 'STEUER'
  | 'FINANZ';

export interface HgbGuVPosition {
  kontonummer: string;
  bezeichnung: string;
  kategorie: GuVKategorie;
  parentId?: string;
  id: string;
}

/**
 * Gesamtkostenverfahren (GKV) — § 275 Abs. 2 HGB.
 *
 * Reihenfolge:
 *   1-4:   Betriebliche Erträge
 *   5-8:   Betriebliche Aufwendungen
 *   9-13:  Finanzergebnis
 *   14-15: Steuern und Ergebnis
 *   16-17: Sonstige Steuern + Jahresergebnis
 */
export const HGB_GUV_GKV: HgbGuVPosition[] = [
  // 1. Umsatzerlöse
  {
    id: '1',
    kontonummer: '1.',
    bezeichnung: 'Umsatzerlöse',
    kategorie: 'ERLOES',
  },
  // 2. Bestandsveränderungen
  {
    id: '2',
    kontonummer: '2.',
    bezeichnung:
      'Erhöhung oder Verminderung des Bestands an fertigen und unfertigen Erzeugnissen',
    kategorie: 'ERLOES',
  },
  // 3. Andere aktivierte Eigenleistungen
  {
    id: '3',
    kontonummer: '3.',
    bezeichnung: 'Andere aktivierte Eigenleistungen',
    kategorie: 'ERLOES',
  },
  // 4. Sonstige betriebliche Erträge
  {
    id: '4',
    kontonummer: '4.',
    bezeichnung: 'Sonstige betriebliche Erträge',
    kategorie: 'ERLOES',
  },
  // 5. Materialaufwand
  {
    id: '5',
    kontonummer: '5.',
    bezeichnung: 'Materialaufwand',
    kategorie: 'MATERIAL',
  },
  {
    id: '5a',
    kontonummer: '5a.',
    bezeichnung: 'a) Aufwendungen für Roh-, Hilfs- und Betriebsstoffe und für bezogene Waren',
    kategorie: 'MATERIAL',
    parentId: '5',
  },
  {
    id: '5b',
    kontonummer: '5b.',
    bezeichnung: 'b) Aufwendungen für bezogene Leistungen',
    kategorie: 'MATERIAL',
    parentId: '5',
  },
  // 6. Personalaufwand
  {
    id: '6',
    kontonummer: '6.',
    bezeichnung: 'Personalaufwand',
    kategorie: 'PERSONAL',
  },
  {
    id: '6a',
    kontonummer: '6a.',
    bezeichnung: 'a) Löhne und Gehälter',
    kategorie: 'PERSONAL',
    parentId: '6',
  },
  {
    id: '6b',
    kontonummer: '6b.',
    bezeichnung:
      'b) Soziale Abgaben und Aufwendungen für Altersversorgung und für Unterstützung',
    kategorie: 'PERSONAL',
    parentId: '6',
  },
  // 7. Abschreibungen
  {
    id: '7',
    kontonummer: '7.',
    bezeichnung: 'Abschreibungen',
    kategorie: 'ABSCHREIBUNG',
  },
  {
    id: '7a',
    kontonummer: '7a.',
    bezeichnung:
      'a) auf immaterielle Vermögensgegenstände des Anlagevermögens und Sachanlagen',
    kategorie: 'ABSCHREIBUNG',
    parentId: '7',
  },
  {
    id: '7b',
    kontonummer: '7b.',
    bezeichnung: 'b) auf Vermögensgegenstände des Umlaufvermögens, soweit diese die üblichen Abschreibungen überschreiten',
    kategorie: 'ABSCHREIBUNG',
    parentId: '7',
  },
  // 8. Sonstige betriebliche Aufwendungen
  {
    id: '8',
    kontonummer: '8.',
    bezeichnung: 'Sonstige betriebliche Aufwendungen',
    kategorie: 'SONSTIGE',
  },
  // 9. Erträge aus Beteiligungen
  {
    id: '9',
    kontonummer: '9.',
    bezeichnung: 'Erträge aus Beteiligungen',
    kategorie: 'FINANZ',
  },
  // 10. Erträge aus anderen Wertpapieren
  {
    id: '10',
    kontonummer: '10.',
    bezeichnung:
      'Erträge aus anderen Wertpapieren und Ausleihungen des Finanzanlagevermögens',
    kategorie: 'FINANZ',
  },
  // 11. Sonstige Zinsen und ähnliche Erträge
  {
    id: '11',
    kontonummer: '11.',
    bezeichnung: 'Sonstige Zinsen und ähnliche Erträge',
    kategorie: 'FINANZ',
  },
  // 12. Abschreibungen auf Finanzanlagen
  {
    id: '12',
    kontonummer: '12.',
    bezeichnung:
      'Abschreibungen auf Finanzanlagen und auf Wertpapiere des Umlaufvermögens',
    kategorie: 'FINANZ',
  },
  // 13. Zinsen und ähnliche Aufwendungen
  {
    id: '13',
    kontonummer: '13.',
    bezeichnung: 'Zinsen und ähnliche Aufwendungen',
    kategorie: 'FINANZ',
  },
  // 14. Steuern vom Einkommen und Ertrag
  {
    id: '14',
    kontonummer: '14.',
    bezeichnung: 'Steuern vom Einkommen und vom Ertrag',
    kategorie: 'STEUER',
  },
  // 15. Ergebnis nach Steuern
  {
    id: '15',
    kontonummer: '15.',
    bezeichnung: 'Ergebnis nach Steuern',
    kategorie: 'STEUER',
  },
  // 16. Sonstige Steuern
  {
    id: '16',
    kontonummer: '16.',
    bezeichnung: 'Sonstige Steuern',
    kategorie: 'STEUER',
  },
  // 17. Jahresüberschuss/Jahresfehlbetrag
  {
    id: '17',
    kontonummer: '17.',
    bezeichnung: 'Jahresüberschuss/Jahresfehlbetrag',
    kategorie: 'STEUER',
  },
];

/**
 * Umsatzkostenverfahren (UKV) — § 275 Abs. 1 HGB.
 *
 * Vereinfachtes Schema (vereinfachte Darstellung gem. § 276 HGB
 * für Kleinstkapitalgesellschaften).
 */
export const HGB_GUV_UKV: HgbGuVPosition[] = [
  {
    id: '1',
    kontonummer: '1.',
    bezeichnung: 'Umsatzerlöse',
    kategorie: 'ERLOES',
  },
  {
    id: '2',
    kontonummer: '2.',
    bezeichnung: 'Herstellungskosten der zur Erzielung der Umsatzerlöse erbrachten Leistungen',
    kategorie: 'MATERIAL',
  },
  {
    id: '3',
    kontonummer: '3.',
    bezeichnung: 'Bruttoergebnis vom Umsatz',
    kategorie: 'ERLOES',
  },
  {
    id: '4',
    kontonummer: '4.',
    bezeichnung: 'Vertriebskosten',
    kategorie: 'SONSTIGE',
  },
  {
    id: '5',
    kontonummer: '5.',
    bezeichnung: 'Allgemeine Verwaltungskosten',
    kategorie: 'SONSTIGE',
  },
  {
    id: '6',
    kontonummer: '6.',
    bezeichnung: 'Sonstige betriebliche Erträge',
    kategorie: 'ERLOES',
  },
  {
    id: '7',
    kontonummer: '7.',
    bezeichnung: 'Sonstige betriebliche Aufwendungen',
    kategorie: 'SONSTIGE',
  },
  {
    id: '8',
    kontonummer: '8.',
    bezeichnung: 'Erträge aus Beteiligungen',
    kategorie: 'FINANZ',
  },
  {
    id: '9',
    kontonummer: '9.',
    bezeichnung: 'Erträge aus anderen Wertpapieren und Ausleihungen des Finanzanlagevermögens',
    kategorie: 'FINANZ',
  },
  {
    id: '10',
    kontonummer: '10.',
    bezeichnung: 'Sonstige Zinsen und ähnliche Erträge',
    kategorie: 'FINANZ',
  },
  {
    id: '11',
    kontonummer: '11.',
    bezeichnung: 'Abschreibungen auf Finanzanlagen und auf Wertpapiere des Umlaufvermögens',
    kategorie: 'FINANZ',
  },
  {
    id: '12',
    kontonummer: '12.',
    bezeichnung: 'Zinsen und ähnliche Aufwendungen',
    kategorie: 'FINANZ',
  },
  {
    id: '13',
    kontonummer: '13.',
    bezeichnung: 'Steuern vom Einkommen und vom Ertrag',
    kategorie: 'STEUER',
  },
  {
    id: '14',
    kontonummer: '14.',
    bezeichnung: 'Ergebnis nach Steuern',
    kategorie: 'STEUER',
  },
  {
    id: '15',
    kontonummer: '15.',
    bezeichnung: 'Sonstige Steuern',
    kategorie: 'STEUER',
  },
  {
    id: '16',
    kontonummer: '16.',
    bezeichnung: 'Jahresüberschuss/Jahresfehlbetrag',
    kategorie: 'STEUER',
  },
];

/**
 * GuV-Verfahren-Konstanten.
 */
export const GUV_VERFAHREN = ['GKV', 'UKV'] as const;
export type GuVVerfahren = (typeof GUV_VERFAHREN)[number];

/**
 * Status-Konstanten für GuV.
 */
export const GUV_STATUS = ['DRAFT', 'VALIDATED', 'ARCHIVED'] as const;
export type GuVStatus = (typeof GUV_STATUS)[number];

/**
 * Kategorie-Konstanten.
 */
export const GUV_KATEGORIEN = [
  'ERLOES',
  'MATERIAL',
  'PERSONAL',
  'ABSCHREIBUNG',
  'SONSTIGE',
  'STEUER',
  'FINANZ',
] as const;

/**
 * Liefert das passende Schema für ein Verfahren.
 */
export function getGuVSchema(verfahren: GuVVerfahren): HgbGuVPosition[] {
  return verfahren === 'GKV' ? HGB_GUV_GKV : HGB_GUV_UKV;
}