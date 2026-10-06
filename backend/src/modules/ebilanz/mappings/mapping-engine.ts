/**
 * Mapping-Engine: Bilanz-/GuV-Positionen → HGB-Kerntaxonomie-Codes.
 *
 * Wir verbinden unsere HGB-Positionen (`kontonummer` wie "A.I.1.") mit
 * den Taxonomie-Codes über die `hgbKontenraheezeile`-Arrays in den
 * Mapping-Files.
 */
import type { TaxonomyConcept } from '../mappings/hgb-kt-v6.types';
import {
  TAXONOMY_CONCEPT_BY_CODE,
  getTaxonomyConcept,
  HGB_KT_V6_GUV_GKV,
  HGB_KT_V6_GUV_UKV,
} from '../mappings/hgb-kt-v6';

/** GuV-Verfahrensvariante (GKV = Gesamtvollkosten, UKV = Umsatzkosten). */
export type GuVVerfahren = 'GKV' | 'UKV';

/**
 * Konzepte einer GuV-Variante.
 *
 * Bugfix 2026-10-06: GKV und UKV definieren 11 identische Concept-Codes
 * (`pl.netIncome`, `pl.tax.incomeTax`, `pl.finResult.participationIncome`,
 * …). In `TAXONOMY_CONCEPT_BY_CODE` überschrieb UKV als letzter Eintrag
 * GKV — ein GKV-GuV wurde folglich mit den BEDEUTUNGEN des UKV
 * abgebildet.
 *
 * Empirische Folge (echter GKV-GuV): „14. Steuern vom Einkommen und vom
 * Ertrag" (15.000 €) erschien als `pl.netIncome`, „8. Sonstige
 * betriebliche Aufwendungen" (50.000 €) als
 * `pl.finResult.participationIncome`. Die beim Bundesanzeiger eingereichte
 * E-Bilanz wies damit einen JAHRESÜBERSCHUSS VON 15.000 € statt der
 * tatsächlichen 35.100 € aus — HTTP 200, `saldostimmt: true`, und der
 * eigene Validator meldete die Datei als gültig.
 */
function guvKonzepte(verfahren?: GuVVerfahren | string): TaxonomyConcept[] {
  return (verfahren ?? '').toUpperCase() === 'UKV'
    ? HGB_KT_V6_GUV_UKV
    : HGB_KT_V6_GUV_GKV;
}

/**
 * Mappt eine HGB-Kontenrahmen-Zeile (z.B. "A.I.1.") auf das passende
 * Taxonomie-Konzept.
 *
 * Für GuV-Positionen muss `verfahren` übergeben werden — sonst kann die
 * GKV/UKV-Kollision nicht aufgelöst werden (siehe `guvKonzepte`).
 * Ohne Angabe gilt GKV, weil das der Standard in der Seed-/Pilot-
 * Konfiguration ist und es das vollständigere Konzept-Set hat.
 */
export function mapKontonummerToConcept(
  hgbKontenraheezeile: string,
  verfahren?: GuVVerfahren | string,
): TaxonomyConcept | null {
  // Erst die zur Variante passende GuV-Liste, dann der Rest der Map
  // (Bilanz/Abschluss/GenInfo — dort gibt es keine GKV/UKV-Kollision).
  for (const concept of guvKonzepte(verfahren)) {
    if (concept.hgbKontenraheezeile.includes(hgbKontenraheezeile)) {
      return concept;
    }
  }
  for (const concept of TAXONOMY_CONCEPT_BY_CODE.values()) {
    if (concept.hgbKontenraheezeile.includes(hgbKontenraheezeile)) {
      return concept;
    }
  }
  return null;
}

/**
 * Liefert alle Konzepte zu einer HGB-Kontenrahmen-Zeile.
 *
 * Wird für die Preview verwendet, um Mehrfach-Mappings sichtbar zu machen.
 */
export function mapKontonummerToAllConcepts(
  hgbKontenraheezeile: string,
  verfahren?: GuVVerfahren | string,
): TaxonomyConcept[] {
  const result: TaxonomyConcept[] = [];
  const gesehen = new Set<string>();
  for (const concept of [...guvKonzepte(verfahren), ...TAXONOMY_CONCEPT_BY_CODE.values()]) {
    if (gesehen.has(concept.code)) continue;
    if (concept.hgbKontenraheezeile.includes(hgbKontenraheezeile)) {
      gesehen.add(concept.code);
      result.push(concept);
    }
  }
  return result;
}

/**
 * Wird vom Service verwendet, um zu prüfen, ob ein Konzept-Code
 * gültig ist.
 */
export function isValidTaxonomyCode(code: string): boolean {
  return TAXONOMY_CONCEPT_BY_CODE.has(code);
}

/**
 * Liefert das Konzept für einen Bilanz-Top-Code (`bs.ass`,
 * `bs.eqLiab`) oder null.
 */
export function getTotalConcept(side: 'ass' | 'eqLiab'): TaxonomyConcept | null {
  const code = side === 'ass' ? 'bs.ass' : 'bs.eqLiab';
  return getTaxonomyConcept(code);
}