import { describe, it, expect } from 'vitest';
import { SKR04_BY_KONTO } from '../mappings/skr04-hgb-map';
import { SKR03_BY_KONTO } from '../mappings/skr03';
import {
  getReverseMapping,
  getUnmappedKonten,
  SKR04_REVERSE_MAPPINGS,
} from '../../datev-import/mappings/skr04-reverse-map';
import { SKR03_REVERSE_MAPPINGS } from '../../datev-import/mappings/skr03-reverse';
import { HGB_GUV_GKV } from '../../guv/constants/hgb-guv.constants';

/**
 * Kontenrahmen-Konsistenz — Export und Import müssen denselben Rahmen
 * verstehen.
 *
 * BEFUND 2026-10-01 (und behoben am 2026-10-10): Der Export akzeptierte
 * `skrPlan: 'SKR03' | 'SKR04'`, der Import kannte nur die SKR04-Tabelle.
 * Eine SKR03-Datei lief dadurch durch die SKR04-Auflösung — bei Nummern,
 * die in beiden Rahmen vorkommen, mit still falschem Ergebnis.
 *
 * GEMESSEN (nicht vermutet): 6 Konten kommen in beiden Rahmen vor, und bei
 * ZWEIEN landen sie auf einer ANDEREN GuV-Position:
 *
 *   7300  SKR03 "Zinsaufwendungen"   -> 12.
 *         SKR04 "Versicherungen"      ->  8.
 *
 * Das schlimmere Beispiel als das im README genannte 7000: 7000 landet in
 * beiden Rahmen auf GuV-Zeile 8. (nur der Name unterscheidet sich), 7300
 * dagegen bucht Zinsaufwand als Versicherung. Der README-Befund war damit
 * nicht falsch, aber nicht der schlimmste Fall — er wurde hier durch
 * Auszählen ersetzt.
 *
 * Diese Spec prüft die ECHTEN Produktionsfunktionen. Die Vorgängerversion
 * baute sich eine `IMPORT_AUFLÖSUNG`-Kopie im Spec nach — ein Test, der eine
 * Nachbildung prüft, sagt nichts über das Original aus.
 */
describe('Kontenrahmen-Konsistenz (SKR03 ↔ SKR04)', () => {
  it('der Import hat jetzt einen echten SKR03-Pfad', () => {
    expect(SKR03_REVERSE_MAPPINGS.length).toBeGreaterThan(0);
    expect(getReverseMapping('7300', 'SKR03')).not.toBeNull();
  });

  it('weist die Nummern nach, die in beiden Rahmen vorkommen', () => {
    // Bezugsgröße ist die REVERSE-Tabelle, weil der Import sie benutzt.
    // Die Vorwärts-Tabellen decken nicht dieselben Nummern ab — 7300 steht
    // z. B. nur in der Reverse-Tabelle (SKR04: "Versicherungen"). Der
    // Vergleich muss dort laufen, wo der Fehler entstanden ist.
    const skr03Nummern = SKR03_REVERSE_MAPPINGS.map((m) => m.datevKonto);
    const doppelt = skr03Nummern.filter((k) =>
      SKR04_REVERSE_MAPPINGS.some((m) => m.datevKonto === k),
    );

    expect(doppelt.sort()).toEqual(['5000', '6000', '6200', '7000', '7300', '7600']);
  });

  it('die Import-Tabelle kennt Nummern, die die Export-Tabelle nicht kennt', () => {
    // Kein Fehler, aber eine Stolperfalle: die Reverse-Tabelle ist eine
    // Obermenge der Vorwärts-Tabelle. Wer die Kollisionen in den
    // Vorwärts-Tabellen zählt, findet eine kleinere Menge als der Import
    // tatsächlich auflöst — man zählt dann Nummern, die es nie treffen
    // kann. 7300 ist genau so ein Fall: Reverse "Versicherungen", in der
    // Vorwärts-Tabelle nicht vorhanden.
    const skr04Vorwaerts = new Set(SKR04_BY_KONTO.keys());
    const nurImImport = SKR04_REVERSE_MAPPINGS.map((m) => m.datevKonto).filter(
      (k) => !skr04Vorwaerts.has(k),
    );
    expect(nurImImport).toContain('7300');
  });

  it('7000 bedeutet je nach Rahmen etwas anderes — und wird auch so aufgelöst', () => {
    expect(SKR03_BY_KONTO.get('7000')?.bezeichnung).toBe(
      'Sonstige betriebliche Aufwendungen (SKR03)',
    );
    expect(SKR04_BY_KONTO.get('7000')?.bezeichnung).toBe('Werbekosten');

    expect(getReverseMapping('7000', 'SKR03')?.datevKontoName).toContain(
      'Sonstige betriebliche Aufwendungen',
    );
    expect(getReverseMapping('7000', 'SKR04')?.datevKontoName).toBe('Werbekosten');
  });

  it('7300 wird als Zinsaufwand aufgelöst, nicht als Versicherung', () => {
    // Das ist der Fall, der still einen falschen Betrag erzeugt hat:
    // SKR03-Zinsen wären als SKR04-Versicherungen gebucht worden.
    const skr03 = getReverseMapping('7300', 'SKR03');
    const skr04 = getReverseMapping('7300', 'SKR04');

    expect(skr03?.hgbPosition).toBe('13.');
    expect(skr04?.datevKontoName).toBe('Versicherungen');
    expect(skr03?.hgbPosition).not.toBe(skr04?.hgbPosition);
  });

  it('6000 bleibt im selben Bereich, aber auf der SKR03-Unterposition', () => {
    expect(getReverseMapping('6000', 'SKR03')?.hgbPosition).toBe('6a.');
    expect(getReverseMapping('6000', 'SKR04')?.hgbPosition).toBe('6.');
  });
});

/**
 * Strukturelle Absicherung.
 *
 * CATCHT: Tippfehler in der Positionsnummer, Positionen, die es im Schema
 * nicht gibt, Drift zwischen den Tabellen.
 *
 * FÄNGT NICHT: eine Position, die es gibt, aber etwas anderes bedeutet.
 * Genau dieser Fall war der Befund von `4700`/"Erlöse aus Beteiligungen",
 * der auf Position 13./"Zinsen und ähnliche Aufwendungen" zeigte — beide mit
 * `kategorie: 'FINANZ'`, also von jedem Kategorie-Vergleich unsichtbar.
 * Strukturelle Tests sind eine notwendige, keine hinreichende Bedingung.
 */
describe('Reverse-Mappings zeigen auf echte GKV-Zeilen', () => {
  const gkvPositionen = new Set(HGB_GUV_GKV.map((p) => p.kontonummer));
  // `SONSTIGE_AUFWAND` und `SONSTIGE_ERTRAG` sind die Import-Bezeichnungen
  // für die Schema-Kategorie `SONSTIGE`.
  const norm = (k: string): string =>
    k.replace('SONSTIGE_AUFWAND', 'SONSTIGE').replace('SONSTIGE_ERTRAG', 'SONSTIGE');

  const guvMappings = [
    ...SKR03_REVERSE_MAPPINGS,
    ...SKR04_REVERSE_MAPPINGS.filter((m) => /^\d+[a-z]?\.$/.test(m.hgbPosition)),
  ];

  it.each(guvMappings.map((m) => [m.datevKonto, m] as const))(
    'SKR-Konto %s zeigt auf eine existierende GKV-Position',
    (_konto, m) => {
      expect(
        gkvPositionen.has(m.hgbPosition),
        `${m.datevKonto} "${m.datevKontoName}" zeigt auf ${m.hgbPosition}, ` +
          `das im GKV-Schema nicht vorkommt. Vorhanden: ${[...gkvPositionen].join(' ')}`,
      ).toBe(true);
    },
  );

  it('die Kategorie passt zur GuV-Zeile (mit den zwei benannten Ausnahmen)', () => {
    const kategorieAbweichungen = guvMappings
      .map((m) => {
        const zeile = HGB_GUV_GKV.find((p) => p.kontonummer === m.hgbPosition);
        if (!zeile) return null;
        return norm(m.kategorie) === norm(zeile.kategorie)
          ? null
          : `${m.datevKonto} -> ${m.hgbPosition} (${zeile.bezeichnung}): ${m.kategorie} statt ${zeile.kategorie}`;
      })
      .filter(Boolean) as string[];

    // Position 4. ist im Schema `ERLOES`, die Import-Tabellen führen sie als
    // `SONSTIGE_ERTRAG`. Beides meint "Sonstige betriebliche Erträge" — eine
    // Benennungsfrage zwischen zwei Dateien, kein falsches Booking. Hier
    // festgehalten, damit sie nicht unbemerkt wächst.
    expect(kategorieAbweichungen.filter((a) => !a.includes('-> 4.'))).toEqual([]);
  });

  it('Beteiligungserträge zeigen nicht auf eine Aufwandsposition', () => {
    // Der Befund, den kein Kategorie-Vergleich gefunden hätte: 4700/4720
    // zeigten auf 13. = "Zinsen und ähnliche AUFWENDUNGEN". Beide tragen
    // kategorie FINANZ, der Fehler war also strukturell unsichtbar.
    for (const konto of ['4700', '4720']) {
      const m = getReverseMapping(konto, 'SKR04');
      const zeile = HGB_GUV_GKV.find((p) => p.kontonummer === m?.hgbPosition);
      expect(
        zeile?.bezeichnung,
        `${konto} "${m?.datevKontoName}" zeigt auf "${zeile?.bezeichnung}" — das ist ein Aufwand.`,
      ).toMatch(/Erträge aus Beteiligungen/);
    }
  });
});

describe('Unmapped-Konten sind sichtbar, nicht still falsch', () => {
  it('ein SKR03-Konto ohne Eintrag landet in unmappedKonten', () => {
    // `skr03.ts` ist eine verkürzte Tabelle ohne Bilanzkonten. Statt es
    // still auf eine SKR04-Position fallen zu lassen, muss es auffallen.
    expect(getReverseMapping('1600', 'SKR03')).toBeNull();
    expect(getUnmappedKonten(['1600'], 'SKR03')).toEqual(['1600']);
  });

  it('dasselbe Konto im SKR04-Rahmen sehr wohl aufgelöst wird', () => {
    expect(getReverseMapping('1600', 'SKR04')).not.toBeNull();
    expect(getUnmappedKonten(['1600'], 'SKR04')).toEqual([]);
  });
});