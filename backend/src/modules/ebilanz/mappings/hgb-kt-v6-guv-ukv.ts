/**
 * HGB-Kerntaxonomie v6 (2025-04-01) — GuV UKV (§ 275 Abs. 1 HGB).
 *
 * Umsatzkostenverfahren — Reihenfolge:
 *   1.    Umsatzerlöse
 *   2.    Herstellungskosten
 *   3.    Bruttoergebnis vom Umsatz
 *   4-5.  Funktionsbereiche (Vertrieb, Verwaltung)
 *   6-7.  Sonstige betriebliche Erträge/Aufwendungen
 *   8-12. Finanzergebnis (analog GKV)
 *   13-15. Steuern + Ergebnis nach Steuern + sonstige Steuern
 *   16.   Jahresüberschuss/Jahresfehlbetrag
 *
 * Sign-Convention: identisch zu GKV — Aufwände `'-1'`, Erlöse `'+1'`.
 *
 * Context-Ref: Alle Duration (V_D).
 */
import type { TaxonomyConcept } from './hgb-kt-v6.types';

const PF = true;
const OPT = false;

const OPERATING_INCOME: TaxonomyConcept[] = [
  {
    code: 'pl.rev',
    namespace: 'pl',
    labelDe: 'Umsatzerlöse',
    conceptType: 'Erloes',
    calculationSign: '+1',
    instance: 'duration',
    contextRef: 'V_D',
    hgbKontenraheezeile: ['1.'],
    datevSkr04: ['8000', '8010', '8020', '8030', '8040', '8050'],
    isPflicht: PF,
  },
];

const COST_OF_SALES: TaxonomyConcept[] = [
  {
    code: 'pl.costOfSales',
    namespace: 'pl',
    labelDe: 'Herstellungskosten der zur Erzielung der Umsatzerlöse erbrachten Leistungen',
    conceptType: 'Aufwand',
    calculationSign: '-1',
    instance: 'duration',
    contextRef: 'V_D',
    hgbKontenraheezeile: ['2.'],
    datevSkr04: ['5000', '5010', '5020', '5030', '5040', '5050', '5060', '5070', '5080', '5090'],
    isPflicht: PF,
  },
];

const GROSS_PROFIT: TaxonomyConcept[] = [
  {
    code: 'pl.grossProfit',
    namespace: 'pl',
    labelDe: 'Bruttoergebnis vom Umsatz',
    conceptType: 'Ergebnis',
    calculationSign: '+1',
    instance: 'duration',
    contextRef: 'V_D',
    hgbKontenraheezeile: ['3.'],
    datevSkr04: [],
    isPflicht: PF,
  },
];

const FUNCTIONAL_COSTS: TaxonomyConcept[] = [
  {
    code: 'pl.sellCost',
    namespace: 'pl',
    labelDe: 'Vertriebskosten',
    conceptType: 'Aufwand',
    calculationSign: '-1',
    instance: 'duration',
    contextRef: 'V_D',
    hgbKontenraheezeile: ['4.'],
    datevSkr04: ['6000', '6010', '6020', '6030', '6040', '6050', '6060', '6070', '6080', '6090'],
    isPflicht: PF,
  },
  {
    code: 'pl.adminCost',
    namespace: 'pl',
    labelDe: 'Allgemeine Verwaltungskosten',
    conceptType: 'Aufwand',
    calculationSign: '-1',
    instance: 'duration',
    contextRef: 'V_D',
    hgbKontenraheezeile: ['5.'],
    datevSkr04: ['6100', '6110', '6120', '6130', '6140', '6150', '6160', '6170', '6180', '6190'],
    isPflicht: PF,
  },
];

const OTHER_OPERATING: TaxonomyConcept[] = [
  {
    code: 'pl.othOpRev.oth',
    namespace: 'pl',
    labelDe: 'Sonstige betriebliche Erträge',
    conceptType: 'Erloes',
    calculationSign: '+1',
    instance: 'duration',
    contextRef: 'V_D',
    hgbKontenraheezeile: ['6.'],
    datevSkr04: ['8300', '8310', '8320', '8330', '8340', '8350'],
    isPflicht: PF,
  },
  {
    code: 'pl.otherCost',
    namespace: 'pl',
    labelDe: 'Sonstige betriebliche Aufwendungen',
    conceptType: 'Aufwand',
    calculationSign: '-1',
    instance: 'duration',
    contextRef: 'V_D',
    hgbKontenraheezeile: ['7.'],
    datevSkr04: ['4300', '4310', '4320', '4330', '4340', '4350'],
    isPflicht: PF,
  },
];

const FINANCIAL_RESULT: TaxonomyConcept[] = [
  {
    code: 'pl.finResult.participationIncome',
    namespace: 'pl',
    labelDe: 'Erträge aus Beteiligungen',
    conceptType: 'Erloes',
    calculationSign: '+1',
    instance: 'duration',
    contextRef: 'V_D',
    hgbKontenraheezeile: ['8.'],
    datevSkr04: ['3500'],
    isPflicht: OPT,
  },
  {
    code: 'pl.finResult.securitiesIncome',
    namespace: 'pl',
    labelDe: 'Erträge aus anderen Wertpapieren und Ausleihungen des Finanzanlagevermögens',
    conceptType: 'Erloes',
    calculationSign: '+1',
    instance: 'duration',
    contextRef: 'V_D',
    hgbKontenraheezeile: ['9.'],
    datevSkr04: ['3550'],
    isPflicht: OPT,
  },
  {
    code: 'pl.finResult.interestIncome',
    namespace: 'pl',
    labelDe: 'Sonstige Zinsen und ähnliche Erträge',
    conceptType: 'Erloes',
    calculationSign: '+1',
    instance: 'duration',
    contextRef: 'V_D',
    hgbKontenraheezeile: ['10.'],
    datevSkr04: ['3600', '3610', '3620'],
    isPflicht: PF,
  },
  {
    code: 'pl.finResult.deprFinAss',
    namespace: 'pl',
    labelDe: 'Abschreibungen auf Finanzanlagen und auf Wertpapiere des Umlaufvermögens',
    conceptType: 'Aufwand',
    calculationSign: '-1',
    instance: 'duration',
    contextRef: 'V_D',
    hgbKontenraheezeile: ['11.'],
    datevSkr04: ['3650', '3660'],
    isPflicht: OPT,
  },
  {
    code: 'pl.finResult.interestExpense',
    namespace: 'pl',
    labelDe: 'Zinsen und ähnliche Aufwendungen',
    conceptType: 'Aufwand',
    calculationSign: '-1',
    instance: 'duration',
    contextRef: 'V_D',
    hgbKontenraheezeile: ['12.'],
    datevSkr04: ['3700', '3710', '3720', '3730'],
    isPflicht: PF,
  },
];

const TAXES_AND_NET_INCOME: TaxonomyConcept[] = [
  {
    code: 'pl.tax.incomeTax',
    namespace: 'pl',
    labelDe: 'Steuern vom Einkommen und vom Ertrag',
    conceptType: 'Aufwand',
    calculationSign: '-1',
    instance: 'duration',
    contextRef: 'V_D',
    hgbKontenraheezeile: ['13.'],
    datevSkr04: ['3800', '3810', '3820'],
    isPflicht: PF,
  },
  {
    code: 'pl.netIncome',
    namespace: 'pl',
    labelDe: 'Ergebnis nach Steuern (Jahresüberschuss/-fehlbetrag)',
    conceptType: 'Ergebnis',
    calculationSign: '+1',
    instance: 'duration',
    contextRef: 'V_D',
    hgbKontenraheezeile: ['14.', '16.'],
    datevSkr04: ['0980', '0985'],
    isPflicht: PF,
  },
  {
    code: 'pl.tax.othTax',
    namespace: 'pl',
    labelDe: 'Sonstige Steuern',
    conceptType: 'Aufwand',
    calculationSign: '-1',
    instance: 'duration',
    contextRef: 'V_D',
    hgbKontenraheezeile: ['15.'],
    datevSkr04: ['3850', '3855', '3860'],
    isPflicht: PF,
  },
];

export const HGB_KT_V6_GUV_UKV: TaxonomyConcept[] = [
  ...OPERATING_INCOME,
  ...COST_OF_SALES,
  ...GROSS_PROFIT,
  ...FUNCTIONAL_COSTS,
  ...OTHER_OPERATING,
  ...FINANCIAL_RESULT,
  ...TAXES_AND_NET_INCOME,
];

export const HGB_KT_V6_GUV_UKV_PFLICHT_CODES: string[] = HGB_KT_V6_GUV_UKV.filter(
  (c) => c.isPflicht,
).map((c) => c.code);