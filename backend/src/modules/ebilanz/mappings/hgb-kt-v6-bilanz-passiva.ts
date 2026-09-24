/**
 * HGB-Kerntaxonomie v6 (2025-04-01) — Bilanz Passiva (§ 266 Abs. 3 HGB).
 *
 * Mapping der Passiva-Seite nach HGB § 266 Abs. 3:
 *   A. Eigenkapital (equity)
 *   B. Rückstellungen (provisions)
 *   C. Verbindlichkeiten (liab)
 *   D. Rechnungsabgrenzungsposten (deferredInc)
 *   E. Passive latente Steuern (defTax)
 *
 * Berechnung: Alle Passiva-Positionen sind `calculationSign: '+1'` — die
 * Berechnung der Bilanzsumme erfolgt durch Addition. Die Validierung
 * prüft AktivaSumme == PassivaSumme.
 */
import type { TaxonomyConcept } from './hgb-kt-v6.types';

const PF = true;
const OPT = false;

/**
 * A. Eigenkapital (equity).
 */
const EQUITY: TaxonomyConcept[] = [
  {
    code: 'bs.eqLiab.equity.subscribed',
    namespace: 'bs',
    labelDe: 'Gezeichnetes Kapital',
    conceptType: 'Passiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: ['A.I.'],
    datevSkr04: ['0800', '0801'],
    isPflicht: PF,
  },
  {
    code: 'bs.eqLiab.equity.capRes',
    namespace: 'bs',
    labelDe: 'Kapitalrücklage',
    conceptType: 'Passiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: ['A.II.'],
    datevSkr04: ['0820', '0825'],
    isPflicht: OPT,
  },
  {
    code: 'bs.eqLiab.equity.earnRes.statRes',
    namespace: 'bs',
    labelDe: 'Gesetzliche Rücklage',
    conceptType: 'Passiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: ['A.III.1.'],
    datevSkr04: ['0840'],
    isPflicht: OPT,
  },
  {
    code: 'bs.eqLiab.equity.earnRes.resOwnShares',
    namespace: 'bs',
    labelDe: 'Rücklage für eigene Anteile',
    conceptType: 'Passiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: ['A.III.2.'],
    datevSkr04: ['0850'],
    isPflicht: OPT,
  },
  {
    code: 'bs.eqLiab.equity.earnRes.statSustRes',
    namespace: 'bs',
    labelDe: 'Satzungsmäßige Rücklagen',
    conceptType: 'Passiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: ['A.III.3.'],
    datevSkr04: ['0860'],
    isPflicht: OPT,
  },
  {
    code: 'bs.eqLiab.equity.earnRes.othEarnRes',
    namespace: 'bs',
    labelDe: 'Andere Gewinnrücklagen',
    conceptType: 'Passiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: ['A.III.4.'],
    datevSkr04: ['0870', '0875', '0880'],
    isPflicht: OPT,
  },
  {
    code: 'bs.eqLiab.equity.profitLossPrevYear',
    namespace: 'bs',
    labelDe: 'Gewinnvortrag/Verlustvortrag',
    conceptType: 'Passiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: ['A.IV.'],
    datevSkr04: ['0900', '0910'],
    isPflicht: OPT,
  },
  {
    code: 'bs.eqLiab.equity.netIncome',
    namespace: 'bs',
    labelDe: 'Jahresüberschuss/Jahresfehlbetrag',
    conceptType: 'Passiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: ['A.V.'],
    datevSkr04: ['0980', '0985'],
    isPflicht: PF,
  },
];

/**
 * B. Rückstellungen (provisions).
 */
const PROVISIONS: TaxonomyConcept[] = [
  {
    code: 'bs.eqLiab.provisions.pension',
    namespace: 'bs',
    labelDe: 'Rückstellungen für Pensionen und ähnliche Verpflichtungen',
    conceptType: 'Passiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: ['B.1.'],
    datevSkr04: ['0700'],
    isPflicht: OPT,
  },
  {
    code: 'bs.eqLiab.provisions.tax',
    namespace: 'bs',
    labelDe: 'Steuerrückstellungen',
    conceptType: 'Passiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: ['B.2.'],
    datevSkr04: ['0740'],
    isPflicht: OPT,
  },
  {
    code: 'bs.eqLiab.provisions.oth',
    namespace: 'bs',
    labelDe: 'Sonstige Rückstellungen',
    conceptType: 'Passiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: ['B.3.'],
    datevSkr04: ['0760', '0765'],
    isPflicht: OPT,
  },
];

/**
 * C. Verbindlichkeiten (liab).
 */
const LIABILITIES: TaxonomyConcept[] = [
  {
    code: 'bs.eqLiab.liab.bond',
    namespace: 'bs',
    labelDe: 'Anleihen',
    conceptType: 'Passiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: ['C.1.'],
    datevSkr04: ['2200'],
    isPflicht: OPT,
  },
  {
    code: 'bs.eqLiab.liab.bank',
    namespace: 'bs',
    labelDe: 'Verbindlichkeiten gegenüber Kreditinstituten',
    conceptType: 'Passiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: ['C.2.'],
    datevSkr04: ['1700', '1705', '1710', '1715', '1720', '1725', '1730', '1735'],
    isPflicht: OPT,
  },
  {
    code: 'bs.eqLiab.liab.advPmt',
    namespace: 'bs',
    labelDe: 'Erhaltene Anzahlungen auf Bestellungen',
    conceptType: 'Passiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: ['C.3.'],
    datevSkr04: ['1900'],
    isPflicht: OPT,
  },
  {
    code: 'bs.eqLiab.liab.trade',
    namespace: 'bs',
    labelDe: 'Verbindlichkeiten aus Lieferungen und Leistungen',
    conceptType: 'Passiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: ['C.4.'],
    datevSkr04: ['3300', '3305', '3310', '3315', '3320', '3325'],
    isPflicht: PF,
  },
  {
    code: 'bs.eqLiab.liab.billOfExch',
    namespace: 'bs',
    labelDe: 'Verbindlichkeiten aus der Annahme gezogener Wechsel und der Ausstellung eigener Wechsel',
    conceptType: 'Passiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: ['C.5.'],
    datevSkr04: ['2310'],
    isPflicht: OPT,
  },
  {
    code: 'bs.eqLiab.liab.affiliated',
    namespace: 'bs',
    labelDe: 'Verbindlichkeiten gegenüber verbundenen Unternehmen',
    conceptType: 'Passiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: ['C.6.'],
    datevSkr04: ['3400', '3405', '3410'],
    isPflicht: OPT,
  },
  {
    code: 'bs.eqLiab.liab.assoc',
    namespace: 'bs',
    labelDe: 'Verbindlichkeiten gegenüber Unternehmen, mit denen ein Beteiligungsverhältnis besteht',
    conceptType: 'Passiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: ['C.7.'],
    datevSkr04: ['3500'],
    isPflicht: OPT,
  },
  {
    code: 'bs.eqLiab.liab.oth',
    namespace: 'bs',
    labelDe: 'Sonstige Verbindlichkeiten',
    conceptType: 'Passiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: ['C.8.'],
    datevSkr04: ['3700', '3710', '3720', '3730', '3740', '3750', '3760', '3770', '3780', '3790'],
    isPflicht: PF,
  },
];

/**
 * D. Rechnungsabgrenzungsposten (deferredIncome).
 */
const DEFERRED_INCOME: TaxonomyConcept[] = [
  {
    code: 'bs.eqLiab.deferredInc',
    namespace: 'bs',
    labelDe: 'Rechnungsabgrenzungsposten',
    conceptType: 'Passiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: ['D.'],
    datevSkr04: ['3900', '3910', '3920', '3930', '3940'],
    isPflicht: OPT,
  },
];

/**
 * E. Passive latente Steuern (defTax).
 */
const DEFERRED_TAX_LIAB: TaxonomyConcept[] = [
  {
    code: 'bs.eqLiab.defTax',
    namespace: 'bs',
    labelDe: 'Passive latente Steuern',
    conceptType: 'Passiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: ['E.'],
    datevSkr04: ['3790'],
    isPflicht: OPT,
  },
];

/**
 * Summe Passiva — Top-Level-Aggregat.
 */
const TOTAL_PASSIVA: TaxonomyConcept[] = [
  {
    code: 'bs.eqLiab',
    namespace: 'bs',
    labelDe: 'Summe Passiva',
    conceptType: 'Passiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: [],
    datevSkr04: [],
    isPflicht: PF,
  },
];

/**
 * Kombinierte Passiva-Mapping-Tabelle.
 */
export const HGB_KT_V6_BILANZ_PASSIVA: TaxonomyConcept[] = [
  ...EQUITY,
  ...PROVISIONS,
  ...LIABILITIES,
  ...DEFERRED_INCOME,
  ...DEFERRED_TAX_LIAB,
  ...TOTAL_PASSIVA,
];

/**
 * Pflicht-Passiva-Positionen.
 */
export const HGB_KT_V6_PASSIVA_PFLICHT_CODES: string[] = HGB_KT_V6_BILANZ_PASSIVA.filter(
  (c) => c.isPflicht,
).map((c) => c.code);