/**
 * HGB-Kerntaxonomie v6 (2025-04-01) — Allgemeine Informationen (genInfo.*).
 *
 * Felder gemäß amtlicher Taxonomie:
 *   - companyInfo.*    → Firmenname, Rechtsform, Steuernummer, etc.
 *   - reporting.*      → Berichtsperiode, fiscalYearBegin/End
 *   - preparer.*       → Beraterstammdaten
 *
 * Alle Felder sind Context-Ref V_Y (Instant) — sie beschreiben den
 * Berichterstatter zum Stichtag.
 *
 * Die `xmlgenInstant`-Eigenschaft spiegelt nicht den XBRL-Period-Type
 * wider, sondern ist die Konvention für Felder, die einen Zeitpunkt
 * repräsentieren.
 */
import type { TaxonomyConcept } from './hgb-kt-v6.types';

const PF = true;
const OPT = false;

/**
 * Allgemeine Informationen zum Berichterstatter (Mandant).
 *
 * Diese Konzepte werden NICHT aus Positionen gemappt, sondern direkt
 * aus dem Mandant-Datensatz befüllt.
 */
export const HGB_KT_V6_GENINFO: TaxonomyConcept[] = [
  {
    code: 'genInfo.companyInfo.companyName',
    namespace: 'genInfo',
    labelDe: 'Name des Unternehmens / Firmenname',
    conceptType: 'Aktiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: [],
    datevSkr04: [],
    isPflicht: PF,
  },
  {
    code: 'genInfo.companyInfo.legalForm',
    namespace: 'genInfo',
    labelDe: 'Rechtsform',
    conceptType: 'Aktiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: [],
    datevSkr04: [],
    isPflicht: PF,
  },
  {
    code: 'genInfo.companyInfo.taxNumber',
    namespace: 'genInfo',
    labelDe: 'Steuernummer',
    conceptType: 'Aktiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: [],
    datevSkr04: [],
    isPflicht: PF,
  },
  {
    code: 'genInfo.companyInfo.commercialRegister',
    namespace: 'genInfo',
    labelDe: 'Handelsregister',
    conceptType: 'Aktiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: [],
    datevSkr04: [],
    isPflicht: OPT,
  },
  {
    code: 'genInfo.companyInfo.managingDirector',
    namespace: 'genInfo',
    labelDe: 'Geschäftsführer',
    conceptType: 'Aktiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: [],
    datevSkr04: [],
    isPflicht: OPT,
  },
  {
    code: 'genInfo.companyInfo.shareholdersList',
    namespace: 'genInfo',
    labelDe: 'Gesellschafterverzeichnis',
    conceptType: 'Aktiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: [],
    datevSkr04: [],
    isPflicht: OPT,
  },
  {
    code: 'genInfo.reporting.fiscalYearBegin',
    namespace: 'genInfo',
    labelDe: 'Geschäftsjahresbeginn',
    conceptType: 'Aktiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: [],
    datevSkr04: [],
    isPflicht: PF,
  },
  {
    code: 'genInfo.reporting.fiscalYearEnd',
    namespace: 'genInfo',
    labelDe: 'Geschäftsjahresende',
    conceptType: 'Aktiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: [],
    datevSkr04: [],
    isPflicht: PF,
  },
  {
    code: 'genInfo.reporting.periodStart',
    namespace: 'genInfo',
    labelDe: 'Beginn des Berichtszeitraums',
    conceptType: 'Aktiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: [],
    datevSkr04: [],
    isPflicht: OPT,
  },
  {
    code: 'genInfo.reporting.periodEnd',
    namespace: 'genInfo',
    labelDe: 'Ende des Berichtszeitraums',
    conceptType: 'Aktiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: [],
    datevSkr04: [],
    isPflicht: OPT,
  },
  {
    code: 'genInfo.preparer.name',
    namespace: 'genInfo',
    labelDe: 'Name des Steuerberaters / der Kanzlei',
    conceptType: 'Aktiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: [],
    datevSkr04: [],
    isPflicht: OPT,
  },
  {
    code: 'genInfo.preparer.memberNumber',
    namespace: 'genInfo',
    labelDe: 'Beraternummer',
    conceptType: 'Aktiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: [],
    datevSkr04: [],
    isPflicht: OPT,
  },
  {
    code: 'genInfo.preparer.clientNumber',
    namespace: 'genInfo',
    labelDe: 'Mandantennummer',
    conceptType: 'Aktiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: [],
    datevSkr04: [],
    isPflicht: OPT,
  },
  {
    code: 'genInfo.preparer.telefon',
    namespace: 'genInfo',
    labelDe: 'Telefon des Beraters',
    conceptType: 'Aktiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: [],
    datevSkr04: [],
    isPflicht: OPT,
  },
  {
    code: 'genInfo.preparer.email',
    namespace: 'genInfo',
    labelDe: 'E-Mail des Beraters',
    conceptType: 'Aktiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: [],
    datevSkr04: [],
    isPflicht: OPT,
  },
];

/**
 * Pflicht-GenInfo-Codes.
 */
export const HGB_KT_V6_GENINFO_PFLICHT_CODES: string[] = HGB_KT_V6_GENINFO.filter(
  (c) => c.isPflicht,
).map((c) => c.code);