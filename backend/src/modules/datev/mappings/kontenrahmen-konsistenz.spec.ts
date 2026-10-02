import { describe, it, expect } from 'vitest';
import { SKR04_BY_KONTO } from '../mappings/skr04-hgb-map';
import { SKR04_REVERSE_AUFWAND } from '../../datev-import/mappings/skr04-reverse-aufwand';
import { SKR04_REVERSE_ERTRAG } from '../../datev-import/mappings/skr04-reverse-ertrag';
import { getSkr03Konto } from '../mappings/skr03';

/**
 * Konsistenzprüfung der beiden Kontenrahmen (2026-10-01).
 *
 * Befund, den dieser Test festhält: Export und Import kennen nicht
 * denselben Kontenrahmen.
 *
 *   - `datev-export.service.ts` akzeptiert `skrPlan: 'SKR03' | 'SKR04'`
 *     (Default SKR04) und schreibt für SKR03 die Nummern aus
 *     `mappings/skr03.ts`.
 *   - Der Import löst Kontonummern ausschließlich über
 *     `datev-import/mappings/skr04-reverse-*.ts` auf. Es gibt keinen
 *     SKR03-Pfad.
 *
 * Fünf Nummern kommen in BEIDEN Rahmen vor, teils mit abweichender
 * Bedeutung. Wird eine SKR03-Datei über den eigenen Import gelesen,
 * landen die Buchungen auf den falschen GuV-Positionen — und nichts
 * meldet einen Fehler, weil die Nummer formal gefunden wird.
 *
 * Der Test ist bewusst eine DOKUMENTATION des Zustands, keine
 * Wunschvorgabe: er schlägt fehl, solange der Bruch besteht. Damit
 * ist er zugleich die Spezifikation für die Reparatur.
 */

const SKR03_KONTEN = new Map<string, string>([
  ['5000', 'Materialaufwand (SKR03)'],
  ['6000', 'Personalaufwand (SKR03)'],
  ['6200', 'Abschreibungen (SKR03)'],
  ['7000', 'Sonstige betriebliche Aufwendungen (SKR03)'],
  ['7600', 'Steuern vom Einkommen und Ertrag (SKR03)'],
]);

/** Reverse-Map des Imports: Kontonummer → GuV-Position. */
const IMPORT_AUFLÖSUNG = new Map<string, { position: string; name: string }>([
  ...SKR04_REVERSE_AUFWAND.map((m) => [
    m.datevKonto,
    { position: m.hgbPosition, name: m.datevKontoName },
  ] as [string, { position: string; name: string }]),
  ...SKR04_REVERSE_ERTRAG.map((m) => [
    m.datevKonto,
    { position: m.hgbPosition, name: m.datevKontoName },
  ] as [string, { position: string; name: string }]),
]);

describe('Kontenrahmen-Konsistenz (SKR03 ↔ SKR04)', () => {
  // `it.fails` ist hier Absicht: der Bruch besteht zum Stand 2026-10-01 und
  // ist fachlich zu klären (siehe README). Der Test ist als ERWARTETER
  // Fehlschlag markiert, damit die Suite grün bleibt und der Befund nicht
  // verschwindet. Wird der Import um einen SKR03-Pfad erweitert, meldet
  // Vitest "expected to fail, but passed" — das ist das Signal, dass der
  // Punkt erledigt ist und der Test in ein `it` gewechselt werden kann.
  it.fails(
    'trägt fest, dass der Export SKR03 kann, der Import aber nicht',
    () => {
      // Der Export bietet SKR03 an …
      // … der Import löst ausschließlich über die SKR04-Reverse-Map auf.
      const hatSkr03PfadImImport = [...IMPORT_AUFLÖSUNG.values()].some(
        (v) => v.name.includes('SKR03'),
      );
      expect(
        hatSkr03PfadImImport,
        'Der Import hat einen SKR03-Pfad. Dieser Test kann ersetzt werden — ' +
          'dann bitte die SKR03-Dateien zusätzlich in die Reverse-Map aufnehmen ' +
          'und SKR03-Nummern getrennt behandeln.',
      ).toBe(true);
    },
  );

  it('weist die Nummern nach, die in beiden Rahmen vorkommen', () => {
    const doppelt = [...SKR03_KONTEN.keys()].filter((k) => SKR04_BY_KONTO.has(k));

    // Diese Liste ist der eigentliche Befund: bei diesen Nummern hängt die
    // Bedeutung vom gewählten Rahmen ab.
    expect(doppelt.sort()).toEqual(['5000', '6000', '6200', '7000', '7600']);
  });

  it('zeigt, dass 7000 je nach Rahmen etwas anderes bedeutet', () => {
    const skr03 = getSkr03Konto('7000');
    const skr04 = SKR04_BY_KONTO.get('7000');

    expect(skr03?.bezeichnung).toBe('Sonstige betriebliche Aufwendungen (SKR03)');
    expect(skr04?.bezeichnung).toBe('Werbekosten');

    // Der Import liest 7000 IMMER als Werbekosten — auch dann, wenn die
    // Datei aus einem SKR03-Export stammt.
    const importAufloesung = IMPORT_AUFLÖSUNG.get('7000');
    expect(importAufloesung?.name).toBe('Werbekosten');
  });

  it('zeigt, dass der Import SKR03-Dateien still falsch zuordnet', () => {
    // Ein SKR03-Buchungssatz auf 7000 bedeutet "sonstige betriebliche
    // Aufwendungen". Der Import legt ihn auf GuV-Position "8." (Werbekosten).
    const skr03Quelle = SKR03_KONTEN.get('7000')!;
    const importErgebnis = IMPORT_AUFLÖSUNG.get('7000')!;

    expect(skr03Quelle).toContain('Sonstige betriebliche');
    expect(importErgebnis.name).toBe('Werbekosten');
    // Kein Fehler wird geworfen — die Nummer wird gefunden, nur an der
    // falschen Stelle. Genau das macht den Bruch gefährlich.
    expect(importErgebnis.position).toBeTruthy();
  });
});
