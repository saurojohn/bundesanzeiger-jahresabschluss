/**
 * Mapping-Engine: Bilanz-/GuV-Positionen → HGB-Kerntaxonomie-Codes.
 *
 * Wir verbinden unsere HGB-Positionen (`kontonummer` wie "A.I.1.") mit
 * den Taxonomie-Codes über die `hgbKontenraheezeile`-Arrays in den
 * Mapping-Files.
 */
import type { TaxonomyConcept } from '../mappings/hgb-kt-v6.types';
import { TAXONOMY_CONCEPT_BY_CODE, getTaxonomyConcept } from '../mappings/hgb-kt-v6';

/**
 * Mappt eine HGB-Kontenrahmen-Zeile (z.B. "A.I.1.") auf das passende
 * Taxonomie-Konzept.
 *
 * Es wird das ERSTE Konzept zurückgegeben, dessen `hgbKontenraheezeile`
 * die gegebene Position enthält. Bei Mehrfach-Treffern (selten) nehmen
 * wir den ersten — eine 1:n-Beziehung wäre möglich, wird aber in der
 * Praxis vermieden (1 Position → genau 1 Concept).
 */
export function mapKontonummerToConcept(
  hgbKontenraheezeile: string,
): TaxonomyConcept | null {
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
): TaxonomyConcept[] {
  const result: TaxonomyConcept[] = [];
  for (const concept of TAXONOMY_CONCEPT_BY_CODE.values()) {
    if (concept.hgbKontenraheezeile.includes(hgbKontenraheezeile)) {
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