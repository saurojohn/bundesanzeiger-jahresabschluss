/**
 * Aggregator + Lookup für SKR04 → HGB Reverse-Mapping.
 *
 * Kombiniert die drei Mapping-Tabellen (Ertrag/Aufwand/Bilanz) zu einem
 * konsolidierten Lookup mit O(1)-Zugriff pro DATEV-Konto.
 *
 * Wichtige Eigenschaften:
 *   - Strikte 1:1-Zuordnung: jedes DATEV-Konto hat höchstens EIN Reverse-Mapping.
 *     Falls ein DATEV-Konto in mehreren Tabellen vorkommt, gewinnt der erste
 *     Treffer (Ertrag > Aufwand > Bilanz).
 *   - Confidence-Score dient der UI-Anzeige (Auto-Mapping > 0.8 ohne Confirm).
 */
import type { ReverseMapping } from './skr04-reverse.types';
import { SKR04_REVERSE_ERTRAG } from './skr04-reverse-ertrag';
import { SKR04_REVERSE_AUFWAND } from './skr04-reverse-aufwand';
import { SKR04_REVERSE_BILANZ } from './skr04-reverse-bilanz';

/**
 * Aggregierte Reverse-Mapping-Tabelle (alle Kategorien).
 *
 * Reihenfolge: Ertrag > Aufwand > Bilanz (Ertrag gewinnt bei Kollisionen).
 */
export const SKR04_REVERSE_MAPPINGS: readonly ReverseMapping[] = [
  ...SKR04_REVERSE_ERTRAG,
  ...SKR04_REVERSE_AUFWAND,
  ...SKR04_REVERSE_BILANZ,
];

/**
 * Lookup-Map für SKR04-Reverse-Mappings — Konto-Nummer → ReverseMapping.
 */
export const SKR04_REVERSE_BY_KONTO: ReadonlyMap<string, ReverseMapping> = (() => {
  const map = new Map<string, ReverseMapping>();
  for (const mapping of SKR04_REVERSE_MAPPINGS) {
    if (!map.has(mapping.datevKonto)) {
      map.set(mapping.datevKonto, mapping);
    }
  }
  return map;
})();

/**
 * Liefert das Reverse-Mapping für ein DATEV-Konto (z. B. "4400" → Erloes-Mapping).
 *
 * @returns ReverseMapping oder null, wenn kein Mapping existiert.
 */
export function getReverseMapping(datevKonto: string): ReverseMapping | null {
  // Normalisierung: führende Nullen entfernen, damit "1800" === "0001800"
  const normalized = datevKonto.replace(/^0+/, '') || '0';
  return (
    SKR04_REVERSE_BY_KONTO.get(datevKonto) ??
    SKR04_REVERSE_BY_KONTO.get(normalized) ??
    null
  );
}

/**
 * Liefert alle verfügbaren Reverse-Mappings (für Admin-UIs).
 */
export function getAllReverseMappings(): ReverseMapping[] {
  return [...SKR04_REVERSE_MAPPINGS];
}

/**
 * Liefert alle Mappings einer bestimmten Kategorie.
 */
export function getReverseMappingsByKategorie(
  kategorie: ReverseMapping['kategorie'],
): ReverseMapping[] {
  return SKR04_REVERSE_MAPPINGS.filter((m) => m.kategorie === kategorie);
}

/**
 * Liefert die Liste der DATEV-Konten, die KEIN Auto-Mapping haben.
 *
 * @param usedKonten Liste der im Import vorkommenden DATEV-Konten.
 * @returns Liste der Konten ohne Auto-Mapping (müssen manuell zugeordnet werden).
 */
export function getUnmappedKonten(usedKonten: string[]): string[] {
  return usedKonten.filter((konto) => getReverseMapping(konto) === null);
}

/**
 * Liefert die Bilanz-Positionen (Aktiva + Passiva) als Map HGB-Position → Bezeichnung.
 *
 * Wird verwendet, um eine UI-Dropdown-Auswahl für manuelle Kanzlei-Zuordnung zu füllen.
 */
export function getBilanzPositionLabels(): Array<{
  hgbPosition: string;
  bezeichnung: string;
  seite: 'AKTIVA' | 'PASSIVA';
}> {
  return SKR04_REVERSE_BILANZ
    .filter(
      (m) => m.kategorie === 'BILANZ_AKTIVA' || m.kategorie === 'BILANZ_PASSIVA',
    )
    .map((m) => ({
      hgbPosition: m.hgbPosition,
      bezeichnung: m.hgbKontoNr,
      seite: m.side === 'AKTIVA' || m.side === 'PASSIVA' ? m.side : 'AKTIVA',
    }));
}

/**
 * Liefert die GuV-Positionen als Map HGB-Position → Bezeichnung.
 */
export function getGuVPositionLabels(): Array<{
  hgbPosition: string;
  bezeichnung: string;
  kategorie: string;
}> {
  return SKR04_REVERSE_MAPPINGS
    .filter(
      (m) =>
        m.kategorie === 'ERLOES' ||
        m.kategorie === 'MATERIAL' ||
        m.kategorie === 'PERSONAL' ||
        m.kategorie === 'ABSCHREIBUNG' ||
        m.kategorie === 'SONSTIGE_AUFWAND' ||
        m.kategorie === 'SONSTIGE_ERTRAG' ||
        m.kategorie === 'FINANZ' ||
        m.kategorie === 'STEUER',
    )
    .map((m) => ({
      hgbPosition: m.hgbPosition,
      bezeichnung: m.hgbKontoNr,
      kategorie: m.kategorie,
    }));
}