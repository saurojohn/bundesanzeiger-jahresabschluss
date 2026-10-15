import { describe, expect, it } from 'vitest';
import { BETRAG_STRING_PATTERN } from './betrag-grenzen';

/**
 * Der Betrag im Mandanten-Stamm wird als STRING transportiert
 * ("Decimal als String (Prisma)"). Damit muss das Backend dieselbe
 * Schreibweise akzeptieren wie die Oberflaeche im Bilanz-Formular —
 * sonst lehrt die Anwendung an einer Stelle eine Notation und verbietet sie
 * an einer anderen.
 *
 * KORREKTUR 2026-10-15: Die erste Fassung erlaubte nur `"12345.67"` und
 * `"12345,67"`, aber kein `"1.234,56"` — also genau die Schreibweise, die
 * `frontend/src/lib/zahl.ts` seit demselben Tag unterstuetzt.
 *
 * Diese Fallliste ist absichtlich mit der des Frontend-Tests identisch
 * (siehe `frontend/e2e/betrag-eingabe.spec.ts`).
 */
const ANNAHMEN: string[] = [
  '12345.67',
  '12345,67',
  '1.234,56',
  '1.234.567,89',
  '0,00',
  '-500',
  '1500',
  '1234567.89',
];

const ABLEHNUNGEN: string[] = [
  'keine-zahl',
  '1.234.567,8a',
  '',
  'abc',
  '1 234,56',
  '1.2.3',
  '--5',
  '12,345',
];

describe('Betrags-String (Decimal als String)', () => {
  for (const wert of ANNAHMEN) {
    it(`akzeptiert ${JSON.stringify(wert)}`, () => {
      expect(BETRAG_STRING_PATTERN.test(wert), `${wert} wird abgelehnt`).toBe(true);
    });
  }

  for (const wert of ABLEHNUNGEN) {
    it(`lehnt ${JSON.stringify(wert)} ab`, () => {
      expect(BETRAG_STRING_PATTERN.test(wert), `${wert} wird akzeptiert`).toBe(false);
    });
  }
});
