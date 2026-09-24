/**
 * Mapping-Engine — Aggregation HGB-Konten → SKR04/SKR03.
 *
 * Zentrale Lookup-Funktion `mapHgbPositionToDatevKonten`:
 *   - Nimmt eine oder mehrere HGB-Kontonummern (z.B. ["1.", "5a."]) entgegen
 *   - Liefert alle passenden SKR-Konten aus den Sub-Tabellen
 *   - Bei Mehrfach-Treffern werden alle Konten zurückgegeben
 *
 * Diese Funktion ist die Brücke zwischen GuV-Positionen und DATEV-Buchungsstapel.
 */
import type { SkrKonto, SkrPlan } from './skr04-hgb.types';
import { SKR04_ERTRAG } from './skr04-ertrag';
import { SKR04_AUFWAND } from './skr04-aufwand';
import { SKR04_AKTIV, SKR04_PASSIV } from './skr04-aktiv-passiv';

/**
 * Aggregierte SKR04-Tabellen — Kombination aus Ertrag/Aufwand/Aktiv/Passiv.
 */
export const SKR04_KONTEN: readonly SkrKonto[] = [
  ...SKR04_ERTRAG,
  ...SKR04_AUFWAND,
  ...SKR04_AKTIV,
  ...SKR04_PASSIV,
];

/**
 * Lookup-Map für SKR04 — Konto-Nummer → SkrKonto.
 */
export const SKR04_BY_KONTO: ReadonlyMap<string, SkrKonto> = (() => {
  const map = new Map<string, SkrKonto>();
  for (const konto of SKR04_KONTEN) {
    map.set(konto.konto, konto);
  }
  return map;
})();

/**
 * Mappt eine oder mehrere HGB-Kontenrahmen-Zeilen auf DATEV-SKR04-Konten.
 *
 * @example
 *   mapHgbPositionToDatevKonten(['5a.']) === [SKR04_AUFWAND[0]] // "4400"-artiges Konto
 *   mapHgbPositionToDatevKonten(['1.']) === [SKR04_ERTRAG[0]] // "4400"
 */
export function mapHgbPositionToDatevKonten(
  hgbKontos: string[],
  plan: SkrPlan = 'SKR04',
): SkrKonto[] {
  if (plan !== 'SKR04') {
    // SKR03 wird als Fallback auf SKR04-Tabellen gemappt, da wir für SKR03
    // keine separate Tabelle pflegen. In M3 kann eine SKR03-spezifische
    // Tabelle nachgereicht werden.
    return mapHgbPositionToDatevKonten(hgbKontos, 'SKR04');
  }

  const result: SkrKonto[] = [];
  for (const hgbKonto of hgbKontos) {
    for (const konto of SKR04_KONTEN) {
      if (konto.hgbKontonummern.includes(hgbKonto)) {
        if (!result.find((k) => k.konto === konto.konto)) {
          result.push(konto);
        }
      }
    }
  }
  return result;
}

/**
 * Liefert ein einzelnes DATEV-Konto anhand der Konto-Nummer.
 */
export function getSkrKonto(konto: string, plan: SkrPlan = 'SKR04'): SkrKonto | null {
  if (plan === 'SKR03') {
    // SKR03 wird derzeit nicht separat abgebildet — Rückfall auf SKR04.
    return SKR04_BY_KONTO.get(konto) ?? null;
  }
  return SKR04_BY_KONTO.get(konto) ?? null;
}

/**
 * Convenience-Funktion: Mappt eine GuV-Position auf das Standard-Konto.
 *
 * Wenn das Mapping mehrere Konten liefert, wird das ERSTE verwendet
 * (typischerweise das "Hauptkonto" für die jeweilige Kategorie).
 *
 * @returns SkrKonto oder null, wenn kein Mapping gefunden wurde
 */
export function mapGuVPositionToDefaultKonto(
  kontonummer: string,
  kategorie: string,
  plan: SkrPlan = 'SKR04',
): SkrKonto | null {
  const candidates = mapHgbPositionToDatevKonten([kontonummer, kategorie], plan);
  if (candidates.length > 0) return candidates[0] ?? null;
  return null;
}

/**
 * Gegenkonto für die Buchungs-Zeile — Standard ist "1800" (Bank).
 *
 * Hintergrund: Bei jeder GuV-Position wird eine paarige Buchung erzeugt:
 *   - Aufwand: Soll=Aufwandskonto, Haben=1800 (Bank)
 *   - Ertrag:  Soll=1800 (Bank),    Haben=Ertragskonto
 *
 * Die tatsächliche Wahl des Bankkontos könnte in M3 über
 * Mandant-Stammdaten konfigurierbar gemacht werden.
 */
export const STANDARD_BANK_KONTO_SKR04 = '1800';