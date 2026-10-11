/**
 * SKR03 → HGB Reverse-Mapping (Import-Richtung).
 *
 * BEFUND 2026-10-10 — Bis hierher gab es NUR eine SKR04-Reverse-Tabelle.
 * `getReverseMapping(konto)` kannte keinen Kontenrahmen, also wurde jede
 * DATEV-Datei durch die SKR04-Tabelle geschickt — auch SKR03-Dateien. Bei
 * sechs Konten, die in BEIDEN Rahmen vorkommen, ist das nicht harmlos:
 *
 *   7300  SKR03 "Zinsaufwendungen"            -> 12.
 *         SKR04 "Versicherungen"               ->  8.
 *
 * Zinsaufwand wäre als Versicherung gebucht worden, ohne jede Fehlermeldung.
 *
 * ZIEL-SCHEMA: GKV (`HGB_GUV_GKV`, § 275 Abs. 2 HGB).
 *
 * Das ist keine freie Entscheidung, sondern aus der bestehenden SKR04-
 * Tabelle abgeleitet: von deren 69 Einträgen lösen 35 GuV-Positionen auf,
 * und **alle 35 treffen genau eine GKV-Zeile**. Die Tabelle ist damit
 * GKV-only. Gegen `HGB_GUV_UKV` ist jeder einzelne davon falsch.
 *
 * JEDER Eintrag unten nennt die GKV-Zeile, auf die er sich bezieht. Das ist
 * Absicht: die Zuordnung ist an der GuV-Zeile nachprüfbar und nicht nur an
 * der Kontonummer. Bei SKR03 standen drei Konten im Vorwärts-Mapping
 * (`skr03.ts`) auf Positionen, die etwas anderes bedeuten:
 *
 *   8050  "Erlöse aus Beteiligungen"  -> 13. = "Zinsen und ähnliche Aufwendungen"
 *   8100  "Sonstige betriebliche Erträge" -> 11. = "Sonstige Zinsen und ähnliche Erträge"
 *   7300  "Zinsaufwendungen"          -> 12. = "Abschreibungen auf Finanzanlagen"
 *
 * Die Vorwärts-Tabelle bleibt unverändert (sie speist den Export) — hier im
 * Reverse wird auf die tatsächliche GuV-Zeile aufgelöst.
 *
 * NICHT ENTHALTEN: Bilanzkonten. `skr03.ts` ist ausdrücklich eine
 * "verkürzte Variante" und enthält nur Ertrags- und Aufwandskonten. SKR03-
 * Aktiva-/Passiva-Konten landen damit bewusst in `unmappedKonten` und
 * müssen manuell zugeordnet werden — sichtbar und benannt, statt still auf
 * eine SKR04-Position zu fallen.
 */
import type { ReverseMapping } from './skr04-reverse.types';

/** GKV-Zeile, auf die sich ein Eintrag bezieht — als Beleg im Kommentar. */
function map(
  datevKonto: string,
  datevKontoName: string,
  hgbPosition: string,
  hgbKontoNr: string,
  kategorie: ReverseMapping['kategorie'],
  confidence: number,
): ReverseMapping {
  return {
    datevKonto,
    datevKontoName,
    hgbPosition,
    hgbKontoNr,
    kategorie,
    side: 'NEUTRAL',
    isPflicht: false,
    confidence,
  };
}

/**
 * SKR03 → HGB (GKV).
 */
export const SKR03_REVERSE_MAPPINGS: readonly ReverseMapping[] = [
  // --- Ertrag ---
  map('8000', 'Erlöse (SKR03)', '1.', 'Umsatzerlöse', 'ERLOES', 0.95),
  // GKV 9. = "Erträge aus Beteiligungen" — der Ertrag, nicht Position 13.
  map('8050', 'Erlöse aus Beteiligungen (SKR03, steuerfrei)', '9.', 'Erträge aus Beteiligungen', 'FINANZ', 0.9),
  // GKV 4. = "Sonstige betriebliche Erträge" — wortgleich.
  map('8100', 'Sonstige betriebliche Erträge (SKR03)', '4.', 'Sonstige betriebliche Erträge', 'SONSTIGE_ERTRAG', 0.9),

  // --- Aufwand ---
  // GKV 5a. = "a) Aufwendungen für Roh-, Hilfs- und Betriebsstoffe …"
  map('5000', 'Materialaufwand (SKR03)', '5a.', 'Roh-, Hilfs- und Betriebsstoffe', 'MATERIAL', 0.9),
  // GKV 6a. = "a) Löhne und Gehälter"
  map('6000', 'Personalaufwand (SKR03)', '6a.', 'Löhne und Gehälter', 'PERSONAL', 0.85),
  // GKV 7a. = "a) auf immaterielle Vermögensgegenstände … und Sachanlagen"
  map('6200', 'Abschreibungen (SKR03)', '7a.', 'Abschreibungen auf Sachanlagen', 'ABSCHREIBUNG', 0.9),
  // GKV 8. = "Sonstige betriebliche Aufwendungen" — wortgleich.
  // ACHTUNG: In SKR04 ist 7000 "Werbekosten" und zeigt auf dieselbe
  // GuV-Zeile 8. Beide Rahmen nutzen also dieselbe NUMMER fuer
  // unterschiedliche Konten — genau der Fall, an dem eine rahmenuebergreifende
  // Tabelle scheitert.
  map('7000', 'Sonstige betriebliche Aufwendungen (SKR03)', '8.', 'Sonstige betriebliche Aufwendungen', 'SONSTIGE_AUFWAND', 0.9),
  // GKV 13. = "Zinsen und ähnliche Aufwendungen" — die Aufwandsseite.
  map('7300', 'Zinsaufwendungen (SKR03)', '13.', 'Zinsen und ähnliche Aufwendungen', 'FINANZ', 0.9),
  // GKV 14. = "Steuern vom Einkommen und vom Ertrag"
  map('7600', 'Steuern vom Einkommen und Ertrag (SKR03)', '14.', 'Steuern vom Einkommen und vom Ertrag', 'STEUER', 0.95),
];

/** Lookup: SKR03-Konto → ReverseMapping. */
export const SKR03_REVERSE_BY_KONTO: ReadonlyMap<string, ReverseMapping> = (() => {
  const map = new Map<string, ReverseMapping>();
  for (const m of SKR03_REVERSE_MAPPINGS) {
    if (!map.has(m.datevKonto)) map.set(m.datevKonto, m);
  }
  return map;
})();