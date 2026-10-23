import { describe, expect, it } from 'vitest';
import { bestimmeHgbPosition } from './hgb-position-auflosung';

/**
 * BEFUND 2026-10-24 (Nachtrag 91): Der User-Override im DATEV-Import hat
 * die Bilanzseite aus dem Nummernformat abgeleitet (`startsWith('A.')` →
 * AKTIVA). Nach § 266 HGB stehen A./B./C. auf BEIDEN Bilanzseiten — die
 * Kontonummer allein bestimmt die Seite nicht.
 *
 * GEMESSEN an der laufenden API (Override '3300' → 'C.4.'):
 *
 *     Auto-Mapping : AKTIVA B.IV. 1000.00 | PASSIVA C.4. 1000.00 (ausgeglichen)
 *     User-Override: AKTIVA B.IV. 1000.00 | AKTIVA  C.4. 1000.00 (NICHT ausgeglichen)
 *
 * Diese Tests sichern die AUFLOsung ab (welche Seite gehört zu welcher
 * Position) — der Wächter für die Wirkung ist der e2e-Test
 * `e2e/datev-override-seite.e2e.spec.ts`.
 */
describe('HGB-Position auflösen (Nachtrag 91)', () => {
  it('legt eine Passiva-Position auf die Passiva-Seite (BUG vor dem Fix)', () => {
    // 'C.4.' = Verbindlichkeiten aus Lieferungen und Leistungen
    // (§ 266 Abs. 3 HGB) — beginnt mit 'C.' und war deshalb AKTIVA.
    const r = bestimmeHgbPosition('C.4.');
    expect(r.art).toBe('BILANZ');
    if (r.art !== 'BILANZ') return;
    expect(r.seite).toBe('PASSIVA');
  });

  it('legt die Eigenkapital-Positionen auf die Passiva-Seite', () => {
    // Die Konvention der Anwendung (SKR04-Reverse-Tabelle):
    // 'A.I.' = Gezeichnetes Kapital, 'A.II.' = Kapitalrücklage,
    // 'A.III.' = Gewinnrücklagen, 'A.IV.' = Verlustvortrag.
    for (const position of ['A.I.', 'A.II.', 'A.III.', 'A.IV.', 'A.V.']) {
      const r = bestimmeHgbPosition(position);
      expect(r.art, position).toBe('BILANZ');
      if (r.art !== 'BILANZ') continue;
      expect(r.seite, position).toBe('PASSIVA');
    }
  });

  it('legt die Anlage- und Umlaufvermögens-Positionen auf die Aktiva-Seite', () => {
    for (const position of ['B.IV.', 'A.I.3.', 'A.II.2.', 'B.II.1.', 'C.']) {
      const r = bestimmeHgbPosition(position);
      expect(r.art, position).toBe('BILANZ');
      if (r.art !== 'BILANZ') continue;
      expect(r.seite, position).toBe('AKTIVA');
    }
  });

  it('erkennt die GuV-Positionen (Ziffern) als GuV', () => {
    for (const position of ['1.', '4.', '5a.', '5b.', '6.', '7a.', '13.', '16.']) {
      expect(bestimmeHgbPosition(position).art, position).toBe('GUV');
    }
  });

  it('erkennt eine Position, die auf BEIDEN Seiten existiert, als mehrdeutig', () => {
    // § 266 HGB: 'A.' steht als "Anlagevermögen" (Aktiva) und als
    // "Eigenkapital" (Passiva). In der SKR04-Tabelle kommt 'A.' nicht
    // vor — die Seite ist also nicht entscheidbar.
    const r = bestimmeHgbPosition('A.');
    expect(r.art).toBe('MEHRDEUTIG');
    if (r.art !== 'MEHRDEUTIG') return;
    expect(r.aktiva).toBeTruthy();
    expect(r.passiva).toBeTruthy();
  });

  it('erkennt eine unbekannte Position als unbekannt', () => {
    expect(bestimmeHgbPosition('X.YZ.').art).toBe('UNBEKANNT');
    expect(bestimmeHgbPosition('').art).toBe('UNBEKANNT');
    expect(bestimmeHgbPosition('   ').art).toBe('UNBEKANNT');
  });

  it('ignoriert Leerraum um die Position', () => {
    expect(bestimmeHgbPosition('  C.4.  ').art).toBe('BILANZ');
  });
});
