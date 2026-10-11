/**
 * Aggregator + Lookup für SKR → HGB Reverse-Mapping, RAHMENABHÄNGIG.
 *
 * BEFUND 2026-10-10: Es gab nur eine SKR04-Tabelle und `getReverseMapping`
 * kannte keinen Kontenrahmen. Jede DATEV-Datei — auch SKR03 — lief dadurch
 * durch die SKR04-Auflösung. Bei Konten, die in beiden Rahmen vorkommen und
 * dort etwas anderes bedeuten, war das ein still falsch gebuchter Betrag:
 *
 *   7300  SKR03 "Zinsaufwendungen"  -> 13. Zinsen und ähnliche Aufwendungen
 *         SKR04 "Versicherungen"     ->  8. Sonstige betriebliche Aufwendungen
 *
 * Der Kontenrahmen ist deshalb jetzt Teil des Aufrufs. Er ist Pflicht, nicht
 * optional: Raten war der Fehler.
 *
 * Beide Tabellen zielen auf GKV (`HGB_GUV_GKV`), siehe `skr03-reverse.ts`.
 */
import type { ReverseMapping } from './skr04-reverse.types';
import { SKR04_REVERSE_ERTRAG } from './skr04-reverse-ertrag';
import { SKR04_REVERSE_AUFWAND } from './skr04-reverse-aufwand';
import { SKR04_REVERSE_BILANZ } from './skr04-reverse-bilanz';
import { SKR03_REVERSE_MAPPINGS, SKR03_REVERSE_BY_KONTO } from './skr03-reverse';

/** Unterstützte Kontenrahmen für den Import. */
export type ImportKontenrahmen = 'SKR03' | 'SKR04';

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
 * Liefert das Reverse-Mapping für ein DATEV-Konto im angegebenen Rahmen.
 *
 * @param datevKonto  z. B. "7300"
 * @param rahmen      SKR03 oder SKR04 — Pflicht. Ohne diesen Parameter
 *                    wüsste die Funktion nicht, welches Konto gemeint ist.
 * @returns ReverseMapping oder null, wenn der Rahmen das Konto nicht kennt.
 */
export function getReverseMapping(
  datevKonto: string,
  rahmen: ImportKontenrahmen,
): ReverseMapping | null {
  // Normalisierung: führende Nullen entfernen, damit "1800" === "0001800"
  const normalized = datevKonto.replace(/^0+/, '') || '0';
  const tabelle =
    rahmen === 'SKR03' ? SKR03_REVERSE_BY_KONTO : SKR04_REVERSE_BY_KONTO;

  return (
    tabelle.get(datevKonto) ??
    tabelle.get(normalized) ??
    // Manche DATEV-Dateien schreiben vierstellig "0730" statt "730".
    tabelle.get(datevKonto.padStart(4, '0')) ??
    null
  );
}

/**
 * Liefert alle verfügbaren Reverse-Mappings (für Admin-UIs).
 */
export function getAllReverseMappings(rahmen: ImportKontenrahmen = 'SKR04'): ReverseMapping[] {
  return rahmen === 'SKR03' ? [...SKR03_REVERSE_MAPPINGS] : [...SKR04_REVERSE_MAPPINGS];
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
 * Liefert die Liste der DATEV-Konten, die im gewählten Rahmen KEIN
 * Auto-Mapping haben.
 *
 * @param usedKonten Liste der im Import vorkommenden DATEV-Konten.
 * @param rahmen     SKR03 oder SKR04 — Pflicht (siehe `getReverseMapping`).
 * @returns Liste der Konten ohne Auto-Mapping (müssen manuell zugeordnet werden).
 */
export function getUnmappedKonten(
  usedKonten: string[],
  rahmen: ImportKontenrahmen,
): string[] {
  return usedKonten.filter((konto) => getReverseMapping(konto, rahmen) === null);
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