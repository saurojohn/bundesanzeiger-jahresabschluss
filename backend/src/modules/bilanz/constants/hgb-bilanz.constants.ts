/**
 * HGB § 266 Bilanzschema.
 *
 * Reihenfolge exakt nach § 266 Abs. 2 und 3 HGB:
 *   - Aktiva (linke Seite, Mittelherkunft aus Vermögensgegenständen)
 *   - Passiva (rechte Seite, Mittelherkunft aus Kapital)
 *
 * Jede Position hat:
 *   - `kontonummer`: HGB-interne Position (z.B. "A.I.1.").
 *   - `bezeichnung`: Deutsche Bezeichnung gem. HGB.
 *   - `parentId`: Verweis auf übergeordnete Position (für Hierarchie-Rendering).
 *   - `seite`: 'AKTIVA' | 'PASSIVA'.
 *
 * Quelle: HGB § 266 Abs. 2 (Aktiva) und Abs. 3 (Passiva).
 */
export type BilanzSeite = 'AKTIVA' | 'PASSIVA';

export interface HgbBilanzPosition {
  kontonummer: string;
  bezeichnung: string;
  seite: BilanzSeite;
  parentId?: string;
  /**
   * Optionale Gruppierung (z.B. "A" für Anlagevermögen,
   * "I" für Immaterielle Vermögensgegenstände). Nützlich für
   * visuelle Gruppierung und Summenbildung.
   */
  gruppe?: string;
  /** ID-Vergabe erfolgt automatisch via kontonummer. */
  id: string;
}

/**
 * Aktiva — vollständiges Schema nach § 266 Abs. 2 HGB.
 *
 * IDs werden aus der kontonummer abgeleitet (z.B. "A.I.1." → "A_I_1").
 */
export const HGB_BILANZ_AKTIVA: HgbBilanzPosition[] = [
  // A. Anlagevermögen
  { id: 'A', kontonummer: 'A.', bezeichnung: 'Anlagevermögen', seite: 'AKTIVA', gruppe: 'A' },
  {
    id: 'A_I',
    kontonummer: 'A.I.',
    bezeichnung: 'Immaterielle Vermögensgegenstände',
    seite: 'AKTIVA',
    parentId: 'A',
    gruppe: 'A.I',
  },
  {
    id: 'A_I_1',
    kontonummer: 'A.I.1.',
    bezeichnung: 'Selbst geschaffene gewerbliche Schutzrechte und ähnliche Rechte und Werte',
    seite: 'AKTIVA',
    parentId: 'A_I',
    gruppe: 'A.I',
  },
  {
    id: 'A_I_2',
    kontonummer: 'A.I.2.',
    bezeichnung:
      'Entgeltlich erworbene Konzessionen, gewerbliche Schutzrechte und ähnliche Rechte und Werte sowie Lizenzen an solchen Rechten und Werten',
    seite: 'AKTIVA',
    parentId: 'A_I',
    gruppe: 'A.I',
  },
  {
    id: 'A_I_3',
    kontonummer: 'A.I.3.',
    bezeichnung: 'Geschäfts- oder Firmenwert',
    seite: 'AKTIVA',
    parentId: 'A_I',
    gruppe: 'A.I',
  },
  {
    id: 'A_I_4',
    kontonummer: 'A.I.4.',
    bezeichnung: 'Geleistete Anzahlungen',
    seite: 'AKTIVA',
    parentId: 'A_I',
    gruppe: 'A.I',
  },
  {
    id: 'A_II',
    kontonummer: 'A.II.',
    bezeichnung: 'Sachanlagen',
    seite: 'AKTIVA',
    parentId: 'A',
    gruppe: 'A.II',
  },
  {
    id: 'A_II_1',
    kontonummer: 'A.II.1.',
    bezeichnung: 'Grundstücke, grundstücksgleiche Rechte und Bauten einschließlich der Bauten auf fremden Grundstücken',
    seite: 'AKTIVA',
    parentId: 'A_II',
    gruppe: 'A.II',
  },
  {
    id: 'A_II_2',
    kontonummer: 'A.II.2.',
    bezeichnung: 'Technische Anlagen und Maschinen',
    seite: 'AKTIVA',
    parentId: 'A_II',
    gruppe: 'A.II',
  },
  {
    id: 'A_II_3',
    kontonummer: 'A.II.3.',
    bezeichnung: 'Andere Anlagen, Betriebs- und Geschäftsausstattung',
    seite: 'AKTIVA',
    parentId: 'A_II',
    gruppe: 'A.II',
  },
  {
    id: 'A_II_4',
    kontonummer: 'A.II.4.',
    bezeichnung: 'Geleistete Anzahlungen und Anlagen im Bau',
    seite: 'AKTIVA',
    parentId: 'A_II',
    gruppe: 'A.II',
  },
  {
    id: 'A_III',
    kontonummer: 'A.III.',
    bezeichnung: 'Finanzanlagen',
    seite: 'AKTIVA',
    parentId: 'A',
    gruppe: 'A.III',
  },
  {
    id: 'A_III_1',
    kontonummer: 'A.III.1.',
    bezeichnung: 'Anteile an verbundenen Unternehmen',
    seite: 'AKTIVA',
    parentId: 'A_III',
    gruppe: 'A.III',
  },
  {
    id: 'A_III_2',
    kontonummer: 'A.III.2.',
    bezeichnung: 'Ausleihungen an verbundene Unternehmen',
    seite: 'AKTIVA',
    parentId: 'A_III',
    gruppe: 'A.III',
  },
  {
    id: 'A_III_3',
    kontonummer: 'A.III.3.',
    bezeichnung: 'Beteiligungen',
    seite: 'AKTIVA',
    parentId: 'A_III',
    gruppe: 'A.III',
  },
  {
    id: 'A_III_4',
    kontonummer: 'A.III.4.',
    bezeichnung:
      'Ausleihungen an Unternehmen, mit denen ein Beteiligungsverhältnis besteht',
    seite: 'AKTIVA',
    parentId: 'A_III',
    gruppe: 'A.III',
  },
  {
    id: 'A_III_5',
    kontonummer: 'A.III.5.',
    bezeichnung: 'Wertpapiere des Anlagevermögens',
    seite: 'AKTIVA',
    parentId: 'A_III',
    gruppe: 'A.III',
  },
  {
    id: 'A_III_6',
    kontonummer: 'A.III.6.',
    bezeichnung: 'Sonstige Ausleihungen',
    seite: 'AKTIVA',
    parentId: 'A_III',
    gruppe: 'A.III',
  },

  // B. Umlaufvermögen
  { id: 'B', kontonummer: 'B.', bezeichnung: 'Umlaufvermögen', seite: 'AKTIVA', gruppe: 'B' },
  {
    id: 'B_I',
    kontonummer: 'B.I.',
    bezeichnung: 'Vorräte',
    seite: 'AKTIVA',
    parentId: 'B',
    gruppe: 'B.I',
  },
  {
    id: 'B_I_1',
    kontonummer: 'B.I.1.',
    bezeichnung: 'Roh-, Hilfs- und Betriebsstoffe',
    seite: 'AKTIVA',
    parentId: 'B_I',
    gruppe: 'B.I',
  },
  {
    id: 'B_I_2',
    kontonummer: 'B.I.2.',
    bezeichnung: 'Unfertige Erzeugnisse, unfertige Leistungen',
    seite: 'AKTIVA',
    parentId: 'B_I',
    gruppe: 'B.I',
  },
  {
    id: 'B_I_3',
    kontonummer: 'B.I.3.',
    bezeichnung: 'Fertige Erzeugnisse und Waren',
    seite: 'AKTIVA',
    parentId: 'B_I',
    gruppe: 'B.I',
  },
  {
    id: 'B_I_4',
    kontonummer: 'B.I.4.',
    bezeichnung: 'Geleistete Anzahlungen',
    seite: 'AKTIVA',
    parentId: 'B_I',
    gruppe: 'B.I',
  },
  {
    id: 'B_II',
    kontonummer: 'B.II.',
    bezeichnung: 'Forderungen und sonstige Vermögensgegenstände',
    seite: 'AKTIVA',
    parentId: 'B',
    gruppe: 'B.II',
  },
  {
    id: 'B_II_1',
    kontonummer: 'B.II.1.',
    bezeichnung: 'Forderungen aus Lieferungen und Leistungen',
    seite: 'AKTIVA',
    parentId: 'B_II',
    gruppe: 'B.II',
  },
  {
    id: 'B_II_2',
    kontonummer: 'B.II.2.',
    bezeichnung: 'Forderungen gegen verbundene Unternehmen',
    seite: 'AKTIVA',
    parentId: 'B_II',
    gruppe: 'B.II',
  },
  {
    id: 'B_II_3',
    kontonummer: 'B.II.3.',
    bezeichnung:
      'Forderungen gegen Unternehmen, mit denen ein Beteiligungsverhältnis besteht',
    seite: 'AKTIVA',
    parentId: 'B_II',
    gruppe: 'B.II',
  },
  {
    id: 'B_II_4',
    kontonummer: 'B.II.4.',
    bezeichnung: 'Sonstige Vermögensgegenstände',
    seite: 'AKTIVA',
    parentId: 'B_II',
    gruppe: 'B.II',
  },
  {
    id: 'B_III',
    kontonummer: 'B.III.',
    bezeichnung: 'Wertpapiere',
    seite: 'AKTIVA',
    parentId: 'B',
    gruppe: 'B.III',
  },
  {
    id: 'B_III_1',
    kontonummer: 'B.III.1.',
    bezeichnung: 'Anteile an verbundenen Unternehmen',
    seite: 'AKTIVA',
    parentId: 'B_III',
    gruppe: 'B.III',
  },
  {
    id: 'B_III_2',
    kontonummer: 'B.III.2.',
    bezeichnung: 'Sonstige Wertpapiere',
    seite: 'AKTIVA',
    parentId: 'B_III',
    gruppe: 'B.III',
  },
  {
    id: 'B_IV',
    kontonummer: 'B.IV.',
    bezeichnung: 'Kassenbestand, Bundesbankguthaben, Guthaben bei Kreditinstituten und Schecks',
    seite: 'AKTIVA',
    parentId: 'B',
    gruppe: 'B.IV',
  },

  // C. Rechnungsabgrenzungsposten
  {
    id: 'C',
    kontonummer: 'C.',
    bezeichnung: 'Rechnungsabgrenzungsposten',
    seite: 'AKTIVA',
    gruppe: 'C',
  },

  // D. Aktive latente Steuern
  {
    id: 'D',
    kontonummer: 'D.',
    bezeichnung: 'Aktive latente Steuern',
    seite: 'AKTIVA',
    gruppe: 'D',
  },
];

/**
 * Passiva — vollständiges Schema nach § 266 Abs. 3 HGB.
 */
export const HGB_BILANZ_PASSIVA: HgbBilanzPosition[] = [
  // A. Eigenkapital
  { id: 'PA', kontonummer: 'A.', bezeichnung: 'Eigenkapital', seite: 'PASSIVA', gruppe: 'PA' },
  {
    id: 'PA_I',
    kontonummer: 'A.I.',
    bezeichnung: 'Gezeichnetes Kapital',
    seite: 'PASSIVA',
    parentId: 'PA',
    gruppe: 'PA.I',
  },
  {
    id: 'PA_II',
    kontonummer: 'A.II.',
    bezeichnung: 'Kapitalrücklage',
    seite: 'PASSIVA',
    parentId: 'PA',
    gruppe: 'PA.II',
  },
  {
    id: 'PA_III',
    kontonummer: 'A.III.',
    bezeichnung: 'Gewinnrücklagen',
    seite: 'PASSIVA',
    parentId: 'PA',
    gruppe: 'PA.III',
  },
  {
    id: 'PA_III_1',
    kontonummer: 'A.III.1.',
    bezeichnung: 'Gesetzliche Rücklage',
    seite: 'PASSIVA',
    parentId: 'PA_III',
    gruppe: 'PA.III',
  },
  {
    id: 'PA_III_2',
    kontonummer: 'A.III.2.',
    bezeichnung: 'Rücklage für eigene Anteile',
    seite: 'PASSIVA',
    parentId: 'PA_III',
    gruppe: 'PA.III',
  },
  {
    id: 'PA_III_3',
    kontonummer: 'A.III.3.',
    bezeichnung: 'Satzungsmäßige Rücklagen',
    seite: 'PASSIVA',
    parentId: 'PA_III',
    gruppe: 'PA.III',
  },
  {
    id: 'PA_III_4',
    kontonummer: 'A.III.4.',
    bezeichnung: 'Andere Gewinnrücklagen',
    seite: 'PASSIVA',
    parentId: 'PA_III',
    gruppe: 'PA.III',
  },
  {
    id: 'PA_IV',
    kontonummer: 'A.IV.',
    bezeichnung: 'Gewinnvortrag/Verlustvortrag',
    seite: 'PASSIVA',
    parentId: 'PA',
    gruppe: 'PA.IV',
  },
  {
    id: 'PA_V',
    kontonummer: 'A.V.',
    bezeichnung: 'Jahresüberschuss/Jahresfehlbetrag',
    seite: 'PASSIVA',
    parentId: 'PA',
    gruppe: 'PA.V',
  },

  // B. Rückstellungen
  {
    id: 'PB',
    kontonummer: 'B.',
    bezeichnung: 'Rückstellungen',
    seite: 'PASSIVA',
    gruppe: 'PB',
  },
  {
    id: 'PB_1',
    kontonummer: 'B.1.',
    bezeichnung: 'Rückstellungen für Pensionen und ähnliche Verpflichtungen',
    seite: 'PASSIVA',
    parentId: 'PB',
    gruppe: 'PB',
  },
  {
    id: 'PB_2',
    kontonummer: 'B.2.',
    bezeichnung: 'Steuerrückstellungen',
    seite: 'PASSIVA',
    parentId: 'PB',
    gruppe: 'PB',
  },
  {
    id: 'PB_3',
    kontonummer: 'B.3.',
    bezeichnung: 'Sonstige Rückstellungen',
    seite: 'PASSIVA',
    parentId: 'PB',
    gruppe: 'PB',
  },

  // C. Verbindlichkeiten
  {
    id: 'PC',
    kontonummer: 'C.',
    bezeichnung: 'Verbindlichkeiten',
    seite: 'PASSIVA',
    gruppe: 'PC',
  },
  {
    id: 'PC_1',
    kontonummer: 'C.1.',
    bezeichnung: 'Anleihen',
    seite: 'PASSIVA',
    parentId: 'PC',
    gruppe: 'PC',
  },
  {
    id: 'PC_2',
    kontonummer: 'C.2.',
    bezeichnung: 'Verbindlichkeiten gegenüber Kreditinstituten',
    seite: 'PASSIVA',
    parentId: 'PC',
    gruppe: 'PC',
  },
  {
    id: 'PC_3',
    kontonummer: 'C.3.',
    bezeichnung: 'Erhaltene Anzahlungen auf Bestellungen',
    seite: 'PASSIVA',
    parentId: 'PC',
    gruppe: 'PC',
  },
  {
    id: 'PC_4',
    kontonummer: 'C.4.',
    bezeichnung: 'Verbindlichkeiten aus Lieferungen und Leistungen',
    seite: 'PASSIVA',
    parentId: 'PC',
    gruppe: 'PC',
  },
  {
    id: 'PC_5',
    kontonummer: 'C.5.',
    bezeichnung: 'Verbindlichkeiten aus der Annahme gezogener Wechsel und der Ausstellung eigener Wechsel',
    seite: 'PASSIVA',
    parentId: 'PC',
    gruppe: 'PC',
  },
  {
    id: 'PC_6',
    kontonummer: 'C.6.',
    bezeichnung: 'Verbindlichkeiten gegenüber verbundenen Unternehmen',
    seite: 'PASSIVA',
    parentId: 'PC',
    gruppe: 'PC',
  },
  {
    id: 'PC_7',
    kontonummer: 'C.7.',
    bezeichnung:
      'Verbindlichkeiten gegenüber Unternehmen, mit denen ein Beteiligungsverhältnis besteht',
    seite: 'PASSIVA',
    parentId: 'PC',
    gruppe: 'PC',
  },
  {
    id: 'PC_8',
    kontonummer: 'C.8.',
    bezeichnung: 'Sonstige Verbindlichkeiten',
    seite: 'PASSIVA',
    parentId: 'PC',
    gruppe: 'PC',
  },

  // D. Rechnungsabgrenzungsposten
  {
    id: 'PD',
    kontonummer: 'D.',
    bezeichnung: 'Rechnungsabgrenzungsposten',
    seite: 'PASSIVA',
    gruppe: 'PD',
  },

  // E. Passive latente Steuern
  {
    id: 'PE',
    kontonummer: 'E.',
    bezeichnung: 'Passive latente Steuern',
    seite: 'PASSIVA',
    gruppe: 'PE',
  },
];

/**
 * Kombiniertes Schema (für GET /api/bilanz/schema).
 */
export const HGB_BILANZ_SCHEMA: HgbBilanzPosition[] = [
  ...HGB_BILANZ_AKTIVA,
  ...HGB_BILANZ_PASSIVA,
];

/**
 * Status-Konstanten für Bilanz.
 */
export const BILANZ_STATUS = ['DRAFT', 'VALIDATED', 'ARCHIVED'] as const;
export type BilanzStatus = (typeof BILANZ_STATUS)[number];

/**
 * Seite-Konstanten.
 */
export const BILANZ_SEITEN = ['AKTIVA', 'PASSIVA'] as const;