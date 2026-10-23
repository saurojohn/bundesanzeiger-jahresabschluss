/**
 * Die Seite einer HGB-Position bestimmen — aus der Konvention der
 * Anwendung, NICHT aus dem Format der Kontonummer.
 *
 * BEFUND 2026-10-24 (Nachtrag 91): Der User-Override im DATEV-Import hat
 * die Bilanzseite aus dem Nummernformat abgeleitet:
 *
 *     isBilanzAktiva  = startsWith('A.') || startsWith('B.') || startsWith('C.')
 *     isBilanzPassiva = startsWith('PA'..'PE') || exakt A.I./A.II./A.III./A.IV./A.V.
 *
 * GEMESSEN an der laufenden API (Override '3300' -> 'C.4.'):
 *
 *     Auto-Mapping : AKTIVA  B.IV. 1000.00 | PASSIVA C.4. 1000.00  (ausgeglichen)
 *     User-Override : AKTIVA  B.IV. 1000.00 | AKTIVA  C.4. 1000.00  (NICHT ausgeglichen)
 *
 * 'C.4.' (Verbindlichkeiten aus Lieferungen und Leistungen, § 266 Abs. 3
 * HGB) beginnt mit 'C.' — die Heuristik machte daraus AKTIVA.
 *
 * DAS GRUNDPROBLEM: Nach § 266 HGB verwenden **beide** Bilanzseiten
 * dieselben Buchstaben (A./B./C.) — die Kontonummer allein bestimmt die
 * Seite also NICHT. Das gilt auch in dieser Anwendung: der Seed legt
 * 'A.III.1.' als AKTIVA ("Anteile an verbundenen Unternehmen", § 266
 * Abs. 2) UND als PASSIVA ("Gesetzliche Rücklage", § 266 Abs. 3) an.
 * Die Seite ist Teil der Identität einer Position.
 *
 * Die Auflösung nutzt deshalb die Quellen, die in der Anwendung
 * **eindeutig** sind:
 *
 *   1. Die SKR04-Reverse-Tabelle (die gepflegte Konvention der App):
 *      'A.I.' -> PASSIVA (Gezeichnetes Kapital), 'B.IV.' -> AKTIVA,
 *      'C.4.' -> PASSIVA. Sie ist widerspruchsfrei.
 *   2. Der HGB-Bilanz-Katalog (§ 266), wenn die Position dort nur auf
 *      EINER Seite steht.
 *   3. Andernfalls: mehrdeutig -> der Import darf nicht raten und
 *      lehnt den Override ab (fail-closed).
 *
 * GuV-Positionen (Ziffern wie '1.', '5a.') sind keine Bilanzpositionen
 * und werden als solche erkannt.
 */
import {
  HGB_BILANZ_AKTIVA,
  HGB_BILANZ_PASSIVA,
} from '../../bilanz/constants/hgb-bilanz.constants';
import { SKR04_REVERSE_BILANZ } from './skr04-reverse-bilanz';

export type BilanzSeite = 'AKTIVA' | 'PASSIVA';

export type HgbPositionAufloesung =
  | {
      art: 'BILANZ';
      seite: BilanzSeite;
      bezeichnung: string;
      /** Woher die Seite stammt — für die Protokollierung. */
      quelle: 'SKR04-Reverse-Tabelle' | 'HGB-Bilanz-Katalog';
    }
  | { art: 'GUV' }
  | {
      art: 'MEHRDEUTIG';
      aktiva: string;
      passiva: string;
    }
  | { art: 'UNBEKANNT' };

/** HGB-Position -> Seite, aus der SKR04-Reverse-Tabelle. */
const SEITE_AUS_SKR04 = (() => {
  const map = new Map<string, { seite: BilanzSeite; bezeichnung: string }>();
  for (const m of SKR04_REVERSE_BILANZ) {
    if (m.kategorie !== 'BILANZ_AKTIVA' && m.kategorie !== 'BILANZ_PASSIVA') {
      continue;
    }
    const seite: BilanzSeite =
      m.kategorie === 'BILANZ_AKTIVA' ? 'AKTIVA' : 'PASSIVA';
    // Die Tabelle ist widerspruchsfrei; eine spätere Zeile gewinnt nicht
    // stillschweigend — ein Widerspruch wäre ein Datenfehler.
    map.set(m.hgbPosition, { seite, bezeichnung: m.hgbKontoNr });
  }
  return map;
})();

/** HGB-Position -> Bezeichnung, je Seite (HGB § 266). */
const AKTIVA = new Map(HGB_BILANZ_AKTIVA.map((p) => [p.kontonummer, p.bezeichnung]));
const PASSIVA = new Map(HGB_BILANZ_PASSIVA.map((p) => [p.kontonummer, p.bezeichnung]));

/** GuV-Positionen: Ziffern, optional mit Kleinbuchstabe ('5a.'). */
const GUV_MUSTER = /^\d+[a-z]?\.?$/i;

/**
 * Löst eine HGB-Position auf: Bilanz (mit Seite), GuV, mehrdeutig oder
 * unbekannt.
 */
export function bestimmeHgbPosition(
  position: string,
): HgbPositionAufloesung {
  const p = (position ?? '').trim();
  if (p.length === 0) return { art: 'UNBEKANNT' };

  // 1. Die Konvention der Anwendung (SKR04-Reverse-Tabelle).
  const ausSkr04 = SEITE_AUS_SKR04.get(p);
  if (ausSkr04) {
    return {
      art: 'BILANZ',
      seite: ausSkr04.seite,
      bezeichnung: ausSkr04.bezeichnung,
      quelle: 'SKR04-Reverse-Tabelle',
    };
  }

  // 2. Der HGB-Bilanz-Katalog — nur wenn die Position dort eindeutig ist.
  const aktiva = AKTIVA.get(p);
  const passiva = PASSIVA.get(p);
  if (aktiva && !passiva) {
    return {
      art: 'BILANZ',
      seite: 'AKTIVA',
      bezeichnung: aktiva,
      quelle: 'HGB-Bilanz-Katalog',
    };
  }
  if (passiva && !aktiva) {
    return {
      art: 'BILANZ',
      seite: 'PASSIVA',
      bezeichnung: passiva,
      quelle: 'HGB-Bilanz-Katalog',
    };
  }
  if (aktiva && passiva) {
    // § 266 HGB: A./B./C. stehen auf BEIDEN Seiten — die Nummer allein
    // entscheidet nicht. Die Anwendung darf hier nicht raten.
    return { art: 'MEHRDEUTIG', aktiva, passiva };
  }

  // 3. GuV-Positionen (Ziffern) — keine Bilanzseite.
  if (GUV_MUSTER.test(p)) return { art: 'GUV' };

  // 4. Unbekannt.
  return { art: 'UNBEKANNT' };
}
