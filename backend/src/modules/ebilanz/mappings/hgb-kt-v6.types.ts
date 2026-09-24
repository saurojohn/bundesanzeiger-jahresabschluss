/**
 * HGB-Kerntaxonomie v6 (2025-04-01) — gemeinsame Typen.
 *
 * Die HGB-Kerntaxonomie (kurz HGB-KT) wird vom XBRL Deutschland e.V. im
 * Auftrag des BMF veröffentlicht. Die aktuelle Version v6 (2025-04-01)
 * bildet § 266 HGB (Bilanz) und § 275 HGB (GuV) ab und ist Pflichttaxonomie
 * für E-Bilanz-Submissions via ERiC (§ 5b EStG).
 *
 * Quelle: https://www.xbrl.de/taxonomies/
 *
 * Hinweis: Die hier definierten Codes sind die offiziellen Taxonomie-Bezeichner
 * (z.B. `bs.ass.fixAss.intangAss.develCost`). Sie werden in den folgenden
 * Mapping-Dateien (`hgb-kt-v6-bilanz-aktiva.ts`, etc.) instanziiert.
 */

/** XBRL-Namespaces, die wir nutzen. */
export type TaxonomyNamespace = 'bs' | 'pl' | 'genInfo' | 'de-gaap-ci';

/** Bilanz-Seite (für ConceptType-Klassifikation). */
export type Side = 'Aktiva' | 'Passiva';

/**
 * ConceptType — fachliche Kategorie. Steuert u.a. die Wahl des
 * `calculationSign` und das Kontext-Ref-Default.
 *
 * - Aktiva / Passiva: Bilanz-Positionen, immer ContextRef V_Y (Instant)
 * - Erloes / Aufwand: GuV-Positionen, immer ContextRef V_D (Duration)
 * - Steuer / Ergebnis: spezielle GuV-Positionen
 */
export type ConceptType = 'Aktiva' | 'Passiva' | 'Erloes' | 'Aufwand' | 'Steuer' | 'Ergebnis';

/**
 * CalculationSign — XBRL-Calculation-Linkbase Gewicht.
 *
 * Per HGB-KT-Konvention:
 * - +1 für Aktiva, Passiva, Erlöse (Einnahmen) und Ergebnis
 * - -1 für Aufwände (Material, Personal, Abschreibung, Zinsen etc.)
 *
 * Die XBRL-Engine wendet das Gewicht bei der Berechnung an. Wir geben
 * die Beträge IMMER als positive Werte aus, der Validator rechnet mit
 * weight=-1 → automatische Subtraktion.
 */
export type CalculationSign = '+1' | '-1';

/**
 * ConceptInstance — XBRL-Period-Type.
 * - instant: Stichtag (für Bilanz, GenInfo-Felder)
 * - duration: Berichtszeitraum (für GuV)
 */
export type ConceptInstance = 'instant' | 'duration';

/**
 * Context-Ref-Identifier. Wir verwenden:
 * - V_D  (Duration)        → GuV
 * - V_Y  (Instant)         → Bilanz, GenInfo
 * - openDate_V_Y           → Eröffnungsbilanz-Wert (selten genutzt)
 */
export type ContextRef = 'V_D' | 'V_Y' | 'openDate_V_Y';

/**
 * Ein einzelnes Taxonomie-Konzept (Mapping-Eintrag).
 */
export interface TaxonomyConcept {
  /** Offizieller XBRL-Taxonomie-Code, z.B. `bs.ass.fixAss.intangAss.develCost`. */
  code: string;
  /** XBRL-Namespace. */
  namespace: TaxonomyNamespace;
  /** Deutsche Bezeichnung gem. HGB §266 / §275 / E-Bilanz-Taxonomie. */
  labelDe: string;
  /** Fachliche Kategorie. */
  conceptType: ConceptType;
  /** XBRL-Calculation-Weight (`+1` addiert, `-1` subtrahiert). */
  calculationSign: CalculationSign;
  /** XBRL-Period-Type. */
  instance: ConceptInstance;
  /** Bevorzugter Context-Ref. */
  contextRef: ContextRef;
  /** HGB-Kontenrahmen-Zeile(n), z.B. ["A.I.1."]. */
  hgbKontenraheezeile: string[];
  /** DATEV-SKR04-Konten (zur Orientierung), z.B. ["0010", "0020"]. */
  datevSkr04: string[];
  /** Pflichtfeld für Kleinstkapitalgesellschaft (§ 267a HGB)? */
  isPflicht: boolean;
}

/**
 * Konstanten für die HGB-KT-Namespace-URIs.
 *
 * Per amtlicher Taxonomie-Version 2025-04-01 (HGB-KT v6).
 */
export const TAXONOMY_NAMESPACE_URIS = {
  bs: 'http://www.xbrl.de/taxonomies/hgb-kt-2025-04-01/bs',
  pl: 'http://www.xbrl.de/taxonomies/hgb-kt-2025-04-01/pl',
  genInfo: 'http://www.xbrl.de/taxonomies/hgb-kt-2025-04-01/genInfo',
  'de-gaap-ci': 'http://www.xbrl.de/taxonomies/hgb-kt-2025-04-01/de-gaap-ci',
} as const;

/** ISO-4217 EUR (für `unitRef`). */
export const UNIT_REF_EUR = 'EUR';

/**
 * Vollständige Bezeichnung der Taxonomie-Version.
 */
export const TAXONOMY_VERSION = 'hgb-kt-2025-04-01';

/**
 * Anzahl Dezimalstellen für monetäre Werte (per XBRL-Spec).
 * `240` = unlimited precision.
 */
export const DECIMALS_MONETARY = '240';