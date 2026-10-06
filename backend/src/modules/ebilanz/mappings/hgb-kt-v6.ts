/**
 * Aggregierte HGB-Kerntaxonomie v6 — kombinierte Mapping-Tabelle.
 *
 * Re-Export aller Sub-Module als ein einheitlicher Namespace für
 * bequemen Service-Zugriff.
 */
import { HGB_KT_V6_BILANZ_AKTIVA, HGB_KT_V6_AKTIVA_PFLICHT_CODES } from './hgb-kt-v6-bilanz-aktiva';
import { HGB_KT_V6_BILANZ_PASSIVA, HGB_KT_V6_PASSIVA_PFLICHT_CODES } from './hgb-kt-v6-bilanz-passiva';
import { HGB_KT_V6_GUV_GKV, HGB_KT_V6_GUV_GKV_PFLICHT_CODES } from './hgb-kt-v6-guv-gkv';
import { HGB_KT_V6_GUV_UKV, HGB_KT_V6_GUV_UKV_PFLICHT_CODES } from './hgb-kt-v6-guv-ukv';
import { HGB_KT_V6_GENINFO, HGB_KT_V6_GENINFO_PFLICHT_CODES } from './hgb-kt-v6-geninfo';
import { HGB_KT_V6_ANHANG, HGB_KT_V6_ANHANG_EXT } from './hgb-kt-v6-anhang';
import type { TaxonomyConcept } from './hgb-kt-v6.types';

export {
  HGB_KT_V6_BILANZ_AKTIVA,
  HGB_KT_V6_AKTIVA_PFLICHT_CODES,
  HGB_KT_V6_BILANZ_PASSIVA,
  HGB_KT_V6_PASSIVA_PFLICHT_CODES,
  HGB_KT_V6_GUV_GKV,
  HGB_KT_V6_GUV_GKV_PFLICHT_CODES,
  HGB_KT_V6_GUV_UKV,
  HGB_KT_V6_GUV_UKV_PFLICHT_CODES,
  HGB_KT_V6_GENINFO,
  HGB_KT_V6_GENINFO_PFLICHT_CODES,
  HGB_KT_V6_ANHANG,
  HGB_KT_V6_ANHANG_EXT,
};

export type {
  TaxonomyConcept,
  TaxonomyNamespace,
  Side,
  ConceptType,
  CalculationSign,
  ConceptInstance,
  ContextRef,
} from './hgb-kt-v6.types';

/**
 * Lookup-Map für Taxonomie-Konzepte nach Code.
 */
export const TAXONOMY_CONCEPT_BY_CODE: ReadonlyMap<string, TaxonomyConcept> = (() => {
  const all = new Map<string, TaxonomyConcept>();
  for (const list of [
    HGB_KT_V6_BILANZ_AKTIVA,
    HGB_KT_V6_BILANZ_PASSIVA,
    HGB_KT_V6_GUV_GKV,
    HGB_KT_V6_GUV_UKV,
    HGB_KT_V6_GENINFO,
    HGB_KT_V6_ANHANG,
  ]) {
    for (const concept of list) {
      all.set(concept.code, concept);
    }
  }
  return all;
})();

/*
 * Bugfix 2026-10-06: GKV und UKV teilen sich 11 Concept-Codes. Beide
 * Listen sind hier importiert und werden bewusst getrennt verwendet, damit
 * das Mapping verfahrensbewusst aufloesen kann (siehe `guvKonzepte()` in
 * mapping-engine.ts). `TAXONOMY_CONCEPT_BY_CODE` bleibt aus
 * Rueckwaertskompatibilitaet bestehen, ist fuer GuV-Positionen aber
 * NICHT mehr die Wahrheit.
 */

/**
 * Liefert ein Taxonomie-Konzept per Code oder null.
 */
export function getTaxonomyConcept(code: string): TaxonomyConcept | null {
  return TAXONOMY_CONCEPT_BY_CODE.get(code) ?? null;
}

/**
 * Liefert alle Konzepte eines bestimmten Concept-Typs.
 */
export function getTaxonomyConceptsByType(
  type: TaxonomyConcept['conceptType'],
): TaxonomyConcept[] {
  const result: TaxonomyConcept[] = [];
  for (const concept of TAXONOMY_CONCEPT_BY_CODE.values()) {
    if (concept.conceptType === type) result.push(concept);
  }
  return result;
}