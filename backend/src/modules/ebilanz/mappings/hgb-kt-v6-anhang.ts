/**
 * HGB-Kerntaxonomie v6 (2025-04-01) — Anhang (Notes).
 *
 * Der Anhang enthält erläuternde Angaben zur Bilanz und GuV:
 *   - Bilanzierungs- und Bewertungsmethoden (§ 284 HGB)
 *   - Erläuterungen zur Bilanz
 *   - Erläuterungen zur GuV
 *   - Sonstige Pflichtangaben
 *
 * Die Taxonomie führt für jeden Notes-Abschnitt Taxonomie-Konzepte;
 * wir mappen hier auf die wesentlichen Pflicht-Codes.
 */
import type { TaxonomyConcept } from './hgb-kt-v6.types';

const PF = true;
const OPT = false;

/**
 * Notes-Konzepte (Anhangs-Pflichtangaben).
 *
 * `correspondingTaxonomyConcepts` wird hier dokumentarisch über das
 * Standard-TaxonomyConcept-Interface hinaus ergänzt — wir definieren
 * die Konzepte hier als reine Mapping-Hilfen; die eigentliche XBRL-
 * Generierung nutzt die Konzepte direkt.
 */
export interface AnhangNotesConcept extends TaxonomyConcept {
  /** Verknüpfte Taxonomie-Codes (z.B. für Plausibilitäts-Checks). */
  correspondingTaxonomyConcepts: string[];
}

const NOTES_DEFINITIONS: AnhangNotesConcept[] = [
  {
    code: 'genInfo.accountingPolicies.de.ing',
    namespace: 'genInfo',
    labelDe: 'Angaben zu den Bilanzierungs- und Bewertungsmethoden (§ 284 HGB)',
    conceptType: 'Aktiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: [],
    datevSkr04: [],
    isPflicht: PF,
    correspondingTaxonomyConcepts: [],
  },
  {
    code: 'genInfo.accountingPolicies.de.g',
    namespace: 'genInfo',
    labelDe: 'Angaben zu den Bewertungsmethoden (§ 284 HGB)',
    conceptType: 'Aktiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: [],
    datevSkr04: [],
    isPflicht: PF,
    correspondingTaxonomyConcepts: [],
  },
  {
    code: 'genInfo.notes.balanceSheet',
    namespace: 'genInfo',
    labelDe: 'Erläuterungen zur Bilanz (§ 285 HGB)',
    conceptType: 'Aktiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: [],
    datevSkr04: [],
    isPflicht: OPT,
    correspondingTaxonomyConcepts: [
      'bs.ass.fixAss.intangAss.develCost',
      'bs.eqLiab.equity.subscribed',
      'bs.eqLiab.liab.trade',
    ],
  },
  {
    code: 'genInfo.notes.incomeStatement',
    namespace: 'genInfo',
    labelDe: 'Erläuterungen zur GuV (§ 285 HGB)',
    conceptType: 'Aktiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: [],
    datevSkr04: [],
    isPflicht: OPT,
    correspondingTaxonomyConcepts: ['pl.rev', 'pl.netIncome'],
  },
  {
    code: 'genInfo.notes.other',
    namespace: 'genInfo',
    labelDe: 'Sonstige Pflichtangaben (§ 285 HGB)',
    conceptType: 'Aktiva',
    calculationSign: '+1',
    instance: 'instant',
    contextRef: 'V_Y',
    hgbKontenraheezeile: [],
    datevSkr04: [],
    isPflicht: OPT,
    correspondingTaxonomyConcepts: [],
  },
];

/**
 * Reine TaxonomyConcept-Liste für Konsistenz mit den anderen Mapping-Files.
 */
export const HGB_KT_V6_ANHANG: TaxonomyConcept[] = NOTES_DEFINITIONS.map(
  ({ correspondingTaxonomyConcepts: _unused, ...rest }) => rest,
);

/**
 * Erweiterte Notes-Liste mit `correspondingTaxonomyConcepts`.
 */
export const HGB_KT_V6_ANHANG_EXT: AnhangNotesConcept[] = NOTES_DEFINITIONS;