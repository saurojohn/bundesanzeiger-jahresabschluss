/**
 * HGB-Kerntaxonomie v6 (2025-04-01) — Bilanz Aktiva (§ 266 Abs. 2 HGB).
 *
 * Mapping unserer HGB-Bilanz-Positionen (siehe
 * `backend/src/modules/bilanz/constants/hgb-bilanz.constants.ts`) auf
 * die offiziellen E-Bilanz-Taxonomie-Codes (`bs.ass.*`).
 *
 * Die Reihenfolge folgt § 266 Abs. 2 HGB:
 *   A. Anlagevermögen (12+ Unterpositionen)
 *   B. Umlaufvermögen (Vorräte, Forderungen, Wertpapiere, Liquide Mittel)
 *   C. Rechnungsabgrenzungsposten
 *   D. Aktive latente Steuern
 *
 * Berechnung: Alle Aktiva-Positionen sind `calculationSign: '+1'` — die
 * Berechnung der Bilanzsumme erfolgt durch Addition.
 */
import type { TaxonomyConcept } from './hgb-kt-v6.types';

const PF = true;
const OPT = false;

/**
 * A. Anlagevermögen (fixAss) — Immaterielle Vermögensgegenstände + Sachanlagen
 * + Finanzanlagen.
 */
const FIXED_ASSETS: TaxonomyConcept[] = [
  // A.I. Immaterielle Vermögensgegenstände (intangAss)
  {
    code: 'bs.ass.fixAss.intangAss.concessions',
    namespace: 'bs',
    labelDe: 'Entgeltlich erworbene Konzessionen, gewerbliche Schutzrechte und ähnliche Rechte und Werte sowie Lizenzen an solchen Rechten und Werten',
    conceptType: 'Aktiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: ['A.I.2.'],
    datevSkr04: ['0010', '0020'],
    isPflicht: OPT,
  },
  {
    code: 'bs.ass.fixAss.intangAss.develCost',
    namespace: 'bs',
    labelDe: 'Selbst geschaffene gewerbliche Schutzrechte und ähnliche Rechte und Werte',
    conceptType: 'Aktiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: ['A.I.1.'],
    datevSkr04: ['0010', '0020'],
    isPflicht: OPT,
  },
  {
    code: 'bs.ass.fixAss.intangAss.goWill',
    namespace: 'bs',
    labelDe: 'Geschäfts- oder Firmenwert',
    conceptType: 'Aktiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: ['A.I.3.'],
    datevSkr04: ['0030', '0035'],
    isPflicht: OPT,
  },
  {
    code: 'bs.ass.fixAss.intangAss.advPmt',
    namespace: 'bs',
    labelDe: 'Geleistete Anzahlungen auf immaterielle Vermögensgegenstände',
    conceptType: 'Aktiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: ['A.I.4.'],
    datevSkr04: ['0090'],
    isPflicht: OPT,
  },

  // A.II. Sachanlagen (tangAss)
  {
    code: 'bs.ass.fixAss.tangAss.land',
    namespace: 'bs',
    labelDe: 'Grundstücke, grundstücksgleiche Rechte und Bauten einschließlich der Bauten auf fremden Grundstücken',
    conceptType: 'Aktiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: ['A.II.1.'],
    datevSkr04: ['0050', '0060', '0070', '0080'],
    isPflicht: OPT,
  },
  {
    code: 'bs.ass.fixAss.tangAss.techEquip',
    namespace: 'bs',
    labelDe: 'Technische Anlagen und Maschinen',
    conceptType: 'Aktiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: ['A.II.2.'],
    datevSkr04: ['0100', '0110', '0120'],
    isPflicht: OPT,
  },
  {
    code: 'bs.ass.fixAss.tangAss.othEquip',
    namespace: 'bs',
    labelDe: 'Andere Anlagen, Betriebs- und Geschäftsausstattung',
    conceptType: 'Aktiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: ['A.II.3.'],
    datevSkr04: ['0200', '0210', '0220', '0230', '0240', '0250', '0260', '0270', '0280'],
    isPflicht: OPT,
  },
  {
    code: 'bs.ass.fixAss.tangAss.advPmt',
    namespace: 'bs',
    labelDe: 'Geleistete Anzahlungen und Anlagen im Bau',
    conceptType: 'Aktiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: ['A.II.4.'],
    datevSkr04: ['0290', '0400'],
    isPflicht: OPT,
  },

  // A.III. Finanzanlagen (finAss)
  {
    code: 'bs.ass.fixAss.finAss.affiliated',
    namespace: 'bs',
    labelDe: 'Anteile an verbundenen Unternehmen',
    conceptType: 'Aktiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: ['A.III.1.'],
    datevSkr04: ['0500'],
    isPflicht: OPT,
  },
  {
    code: 'bs.ass.fixAss.finAss.loansAffiliated',
    namespace: 'bs',
    labelDe: 'Ausleihungen an verbundene Unternehmen',
    conceptType: 'Aktiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: ['A.III.2.'],
    datevSkr04: ['0510'],
    isPflicht: OPT,
  },
  {
    code: 'bs.ass.fixAss.finAss.participations',
    namespace: 'bs',
    labelDe: 'Beteiligungen',
    conceptType: 'Aktiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: ['A.III.3.'],
    datevSkr04: ['0520'],
    isPflicht: OPT,
  },
  {
    code: 'bs.ass.fixAss.finAss.loansAssoc',
    namespace: 'bs',
    labelDe: 'Ausleihungen an Unternehmen, mit denen ein Beteiligungsverhältnis besteht',
    conceptType: 'Aktiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: ['A.III.4.'],
    datevSkr04: ['0530'],
    isPflicht: OPT,
  },
  {
    code: 'bs.ass.fixAss.finAss.securities',
    namespace: 'bs',
    labelDe: 'Wertpapiere des Anlagevermögens',
    conceptType: 'Aktiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: ['A.III.5.'],
    datevSkr04: ['0540', '0550'],
    isPflicht: OPT,
  },
  {
    code: 'bs.ass.fixAss.finAss.othLoans',
    namespace: 'bs',
    labelDe: 'Sonstige Ausleihungen',
    conceptType: 'Aktiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: ['A.III.6.'],
    datevSkr04: ['0560', '0570', '0580'],
    isPflicht: OPT,
  },
];

/**
 * B. Umlaufvermögen (currAss) — Vorräte, Forderungen, Wertpapiere,
 * Kassenbestand/Bankguthaben.
 */
const CURRENT_ASSETS: TaxonomyConcept[] = [
  // B.I. Vorräte (inventories)
  {
    code: 'bs.ass.currAss.invsts.rawMat',
    namespace: 'bs',
    labelDe: 'Roh-, Hilfs- und Betriebsstoffe',
    conceptType: 'Aktiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: ['B.I.1.'],
    datevSkr04: ['0600', '0610', '0620'],
    isPflicht: OPT,
  },
  {
    code: 'bs.ass.currAss.invsts.workInProg',
    namespace: 'bs',
    labelDe: 'Unfertige Erzeugnisse, unfertige Leistungen',
    conceptType: 'Aktiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: ['B.I.2.'],
    datevSkr04: ['0630', '0640'],
    isPflicht: OPT,
  },
  {
    code: 'bs.ass.currAss.invsts.finGoods',
    namespace: 'bs',
    labelDe: 'Fertige Erzeugnisse und Waren',
    conceptType: 'Aktiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: ['B.I.3.'],
    datevSkr04: ['0650', '0660'],
    isPflicht: OPT,
  },
  {
    code: 'bs.ass.currAss.invsts.advPmt',
    namespace: 'bs',
    labelDe: 'Geleistete Anzahlungen auf Vorräte',
    conceptType: 'Aktiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: ['B.I.4.'],
    datevSkr04: ['0670'],
    isPflicht: OPT,
  },

  // B.II. Forderungen und sonstige Vermögensgegenstände (receivables)
  {
    code: 'bs.ass.currAss.recv.trade',
    namespace: 'bs',
    labelDe: 'Forderungen aus Lieferungen und Leistungen',
    conceptType: 'Aktiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: ['B.II.1.'],
    datevSkr04: ['1200', '1205', '1210', '1215', '1220'],
    isPflicht: PF,
  },
  {
    code: 'bs.ass.currAss.recv.affiliated',
    namespace: 'bs',
    labelDe: 'Forderungen gegen verbundene Unternehmen',
    conceptType: 'Aktiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: ['B.II.2.'],
    datevSkr04: ['1230', '1235', '1240'],
    isPflicht: OPT,
  },
  {
    code: 'bs.ass.currAss.recv.assoc',
    namespace: 'bs',
    labelDe: 'Forderungen gegen Unternehmen, mit denen ein Beteiligungsverhältnis besteht',
    conceptType: 'Aktiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: ['B.II.3.'],
    datevSkr04: ['1250'],
    isPflicht: OPT,
  },
  {
    code: 'bs.ass.currAss.recv.oth',
    namespace: 'bs',
    labelDe: 'Sonstige Vermögensgegenstände',
    conceptType: 'Aktiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: ['B.II.4.'],
    datevSkr04: ['1300', '1310', '1320', '1330', '1340', '1350', '1360', '1370', '1380'],
    isPflicht: OPT,
  },

  // B.III. Wertpapiere (securities)
  {
    code: 'bs.ass.currAss.securities.affiliated',
    namespace: 'bs',
    labelDe: 'Anteile an verbundenen Unternehmen',
    conceptType: 'Aktiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: ['B.III.1.'],
    datevSkr04: ['1500'],
    isPflicht: OPT,
  },
  {
    code: 'bs.ass.currAss.securities.oth',
    namespace: 'bs',
    labelDe: 'Sonstige Wertpapiere',
    conceptType: 'Aktiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: ['B.III.2.'],
    datevSkr04: ['1510', '1520', '1530', '1540', '1550'],
    isPflicht: OPT,
  },

  // B.IV. Kassenbestand, Bundesbankguthaben, Guthaben bei Kreditinstituten (cashEquiv)
  {
    code: 'bs.ass.currAss.cashEquiv.bank',
    namespace: 'bs',
    labelDe: 'Kassenbestand, Bundesbankguthaben, Guthaben bei Kreditinstituten und Schecks',
    conceptType: 'Aktiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: ['B.IV.'],
    datevSkr04: ['1000', '1010', '1020', '1030', '1040', '1100', '1110', '1120', '1130', '1140', '1150', '1160', '1170', '1180', '1190'],
    isPflicht: PF,
  },
];

/**
 * C. Rechnungsabgrenzungsposten (prepaidExp).
 */
const PREPAID_EXPENSES: TaxonomyConcept[] = [
  {
    code: 'bs.ass.prepaidExp',
    namespace: 'bs',
    labelDe: 'Rechnungsabgrenzungsposten',
    conceptType: 'Aktiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: ['C.'],
    datevSkr04: ['1800', '1810', '1820', '1830', '1840', '1850', '1860', '1870', '1880', '1890'],
    isPflicht: OPT,
  },
];

/**
 * D. Aktive latente Steuern (defTax).
 */
const DEFERRED_TAX_ASSETS: TaxonomyConcept[] = [
  {
    code: 'bs.ass.defTax',
    namespace: 'bs',
    labelDe: 'Aktive latente Steuern',
    conceptType: 'Aktiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: ['D.'],
    datevSkr04: ['1900'],
    isPflicht: OPT,
  },
];

/**
 * Summe Aktiva — Top-Level-Aggregat (Taxonomie-Konvention).
 * Wird in der XBRL-Instance mit `total="true"` ausgegeben.
 */
const TOTAL_ASSETS: TaxonomyConcept[] = [
  {
    code: 'bs.ass',
    namespace: 'bs',
    labelDe: 'Summe Aktiva',
    conceptType: 'Aktiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: [],
    datevSkr04: [],
    isPflicht: PF,
  },
];

/**
 * Kombinierte Aktiva-Mapping-Tabelle.
 */
export const HGB_KT_V6_BILANZ_AKTIVA: TaxonomyConcept[] = [
  ...FIXED_ASSETS,
  ...CURRENT_ASSETS,
  ...PREPAID_EXPENSES,
  ...DEFERRED_TAX_ASSETS,
  ...TOTAL_ASSETS,
];

/**
 * Pflicht-Aktiva-Positionen (für Validation).
 */
export const HGB_KT_V6_AKTIVA_PFLICHT_CODES: string[] = HGB_KT_V6_BILANZ_AKTIVA.filter(
  (c) => c.isPflicht,
).map((c) => c.code);