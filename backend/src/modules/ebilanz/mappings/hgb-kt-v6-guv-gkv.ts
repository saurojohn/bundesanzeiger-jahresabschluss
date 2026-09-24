/**
 * HGB-Kerntaxonomie v6 (2025-04-01) — GuV GKV (§ 275 Abs. 2 HGB).
 *
 * Gesamtkostenverfahren — Reihenfolge:
 *   1-4:   Betriebliche Erträge
 *   5-8:   Betriebliche Aufwendungen
 *   9-13:  Finanzergebnis
 *   14-15: Steuern und Ergebnis nach Steuern
 *   16-17: Sonstige Steuern + Jahresergebnis
 *
 * Sign-Convention (siehe docs/banz-schemata.md §2.3):
 *   - Aufwands-Konzepte (Material, Personal, Abschreibung, sonstige
 *     Aufwendungen, Zinsaufwand) haben `calculationSign: '-1'`.
 *     Die Beträge werden POSITIV in der XBRL-Instance gespeichert,
 *     die Calculation-Linkbase wendet weight=-1 → automatische Subtraktion.
 *   - Erlös-Konzepte (Umsatzerlöse, Bestandserhöhung, aktivierte
 *     Eigenleistungen, sonstige betriebliche Erträge, Finanzerträge)
 *     haben `calculationSign: '+1'`.
 *   - Ergebnis (Jahresüberschuss) hat `'+'`.
 *
 * Context-Ref: Alle Duration (V_D), da GuV-Period-bezogen.
 */
import type { TaxonomyConcept } from './hgb-kt-v6.types';

const PF = true;
const OPT = false;

/**
 * 1-4: Betriebliche Erträge.
 */
const OPERATING_REVENUES: TaxonomyConcept[] = [
  {
    code: 'pl.rev',
    namespace: 'pl',
    labelDe: 'Umsatzerlöse',
    conceptType: 'Erloes',
    calculationSign: '+1',
    instance: 'duration',
    contextRef: 'V_D',
    hgbKontenraheezeile: ['1.'],
    datevSkr04: ['8000', '8010', '8020', '8030', '8040', '8050', '8060', '8070', '8080', '8090'],
    isPflicht: PF,
  },
  {
    code: 'pl.chgInv',
    namespace: 'pl',
    labelDe:
      'Erhöhung oder Verminderung des Bestands an fertigen und unfertigen Erzeugnissen',
    conceptType: 'Erloes',
    calculationSign: '+1',
    instance: 'duration',
    contextRef: 'V_D',
    hgbKontenraheezeile: ['2.'],
    datevSkr04: ['8100', '8110'],
    isPflicht: OPT,
  },
  {
    code: 'pl.othOpRev.activatedOwnWork',
    namespace: 'pl',
    labelDe: 'Andere aktivierte Eigenleistungen',
    conceptType: 'Erloes',
    calculationSign: '+1',
    instance: 'duration',
    contextRef: 'V_D',
    hgbKontenraheezeile: ['3.'],
    datevSkr04: ['8200'],
    isPflicht: OPT,
  },
  {
    code: 'pl.othOpRev.oth',
    namespace: 'pl',
    labelDe: 'Sonstige betriebliche Erträge',
    conceptType: 'Erloes',
    calculationSign: '+1',
    instance: 'duration',
    contextRef: 'V_D',
    hgbKontenraheezeile: ['4.'],
    datevSkr04: ['8300', '8310', '8320', '8330', '8340', '8350', '8360', '8370', '8380', '8390'],
    isPflicht: PF,
  },
];

/**
 * 5-8: Betriebliche Aufwendungen (alle `calculationSign: '-1'`).
 */
const OPERATING_EXPENSES: TaxonomyConcept[] = [
  {
    code: 'pl.costOfMat.rawMat',
    namespace: 'pl',
    labelDe: 'Aufwendungen für Roh-, Hilfs- und Betriebsstoffe und für bezogene Waren',
    conceptType: 'Aufwand',
    calculationSign: '-1',
    instance: 'duration',
    contextRef: 'V_D',
    hgbKontenraheezeile: ['5a.'],
    datevSkr04: ['3000', '3010', '3020', '3030', '3040', '3050', '3060', '3070', '3080'],
    isPflicht: PF,
  },
  {
    code: 'pl.costOfMat.services',
    namespace: 'pl',
    labelDe: 'Aufwendungen für bezogene Leistungen',
    conceptType: 'Aufwand',
    calculationSign: '-1',
    instance: 'duration',
    contextRef: 'V_D',
    hgbKontenraheezeile: ['5b.'],
    datevSkr04: ['3100', '3110', '3120', '3130', '3140', '3150', '3160', '3170', '3180'],
    isPflicht: PF,
  },
  {
    code: 'pl.costOfEmpl.wages',
    namespace: 'pl',
    labelDe: 'Löhne und Gehälter',
    conceptType: 'Aufwand',
    calculationSign: '-1',
    instance: 'duration',
    contextRef: 'V_D',
    hgbKontenraheezeile: ['6a.'],
    datevSkr04: ['4100', '4110', '4120', '4130', '4140'],
    isPflicht: PF,
  },
  {
    code: 'pl.costOfEmpl.socialExp',
    namespace: 'pl',
    labelDe: 'Soziale Abgaben und Aufwendungen für Altersversorgung und für Unterstützung',
    conceptType: 'Aufwand',
    calculationSign: '-1',
    instance: 'duration',
    contextRef: 'V_D',
    hgbKontenraheezeile: ['6b.'],
    datevSkr04: ['4200', '4210', '4220', '4230', '4240', '4250', '4260', '4270', '4280'],
    isPflicht: PF,
  },
  {
    code: 'pl.deprAmort.fixAss',
    namespace: 'pl',
    labelDe: 'Abschreibungen auf immaterielle Vermögensgegenstände des Anlagevermögens und Sachanlagen',
    conceptType: 'Aufwand',
    calculationSign: '-1',
    instance: 'duration',
    contextRef: 'V_D',
    hgbKontenraheezeile: ['7a.'],
    datevSkr04: ['4800', '4810', '4820', '4830'],
    isPflicht: PF,
  },
  {
    code: 'pl.deprAmort.currAss',
    namespace: 'pl',
    labelDe: 'Abschreibungen auf Vermögensgegenstände des Umlaufvermögens, soweit diese die üblichen Abschreibungen überschreiten',
    conceptType: 'Aufwand',
    calculationSign: '-1',
    instance: 'duration',
    contextRef: 'V_D',
    hgbKontenraheezeile: ['7b.'],
    datevSkr04: ['4850', '4860'],
    isPflicht: OPT,
  },
  {
    code: 'pl.otherCost',
    namespace: 'pl',
    labelDe: 'Sonstige betriebliche Aufwendungen',
    conceptType: 'Aufwand',
    calculationSign: '-1',
    instance: 'duration',
    contextRef: 'V_D',
    hgbKontenraheezeile: ['8.'],
    datevSkr04: ['4300', '4310', '4320', '4330', '4340', '4350', '4360', '4370', '4380', '4390'],
    isPflicht: PF,
  },
];

/**
 * 9-13: Finanzergebnis (Erträge +, Aufwand FxA -).
 */
const FINANCIAL_RESULT: TaxonomyConcept[] = [
  {
    code: 'pl.finResult.participationIncome',
    namespace: 'pl',
    labelDe: 'Erträge aus Beteiligungen',
    conceptType: 'Erloes',
    calculationSign: '+1',
    instance: 'duration',
    contextRef: 'V_D',
    hgbKontenraheezeile: ['9.'],
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
    hgbKontenraheezeile: ['10.'],
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
    hgbKontenraheezeile: ['11.'],
    datevSkr04: ['3600', '3610', '3620', '3630'],
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
    hgbKontenraheezeile: ['12.'],
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
    hgbKontenraheezeile: ['13.'],
    datevSkr04: ['3700', '3710', '3720', '3730', '3740', '3750', '3760', '3770', '3780', '3790'],
    isPflicht: PF,
  },
];

/**
 * 14-15: Steuern vom Einkommen und Ertrag + Ergebnis nach Steuern.
 */
const TAXES_AND_RESULT: TaxonomyConcept[] = [
  {
    code: 'pl.tax.incomeTax',
    namespace: 'pl',
    labelDe: 'Steuern vom Einkommen und vom Ertrag',
    conceptType: 'Aufwand',
    calculationSign: '-1',
    instance: 'duration',
    contextRef: 'V_D',
    hgbKontenraheezeile: ['14.'],
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
    hgbKontenraheezeile: ['15.', '17.'],
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
    hgbKontenraheezeile: ['16.'],
    datevSkr04: ['3850', '3855', '3860', '3870'],
    isPflicht: PF,
  },
];

/**
 * Kombinierte GKV-Mapping-Tabelle.
 */
export const HGB_KT_V6_GUV_GKV: TaxonomyConcept[] = [
  ...OPERATING_REVENUES,
  ...OPERATING_EXPENSES,
  ...FINANCIAL_RESULT,
  ...TAXES_AND_RESULT,
];

/**
 * Pflicht-GKV-Positionen.
 */
export const HGB_KT_V6_GUV_GKV_PFLICHT_CODES: string[] = HGB_KT_V6_GUV_GKV.filter(
  (c) => c.isPflicht,
).map((c) => c.code);