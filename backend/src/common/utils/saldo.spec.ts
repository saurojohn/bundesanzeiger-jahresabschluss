/**
 * Regressionstest: die Saldo-Toleranz ist CENT-genau, nicht EURO-genau.
 *
 * Bugfix 2026-10-06. Drei Module hatten eine eigene Kopie:
 *
 *   const SALDO_TOLERANZ_CENTS = 1; // 0.01 EUR Toleranz
 *   Math.abs(aktivaSumme - passivaSumme) < SALDO_TOLERANZ_CENTS
 *
 * Die Summen sind in Euro. Die Konstante sagt „Cents", verglichen wurde
 * in Euro — die wirksame Toleranz war 1,00 EUR statt 0,01 EUR. Eine
 * Differenz von 0,90 EUR galt als „saldostimmig".
 *
 * Dieser Test pinnt die Regel fest, damit die Einheit nicht erneut
 * verloren geht.
 */

import { describe, it, expect } from 'vitest';
import {
  SALDO_TOLERANZ_CENTS,
  saldoDifferenzInCent,
  saldoStimmt,
} from './saldo';

describe('Saldo-Regel', () => {
  it('Toleranz ist 1 Cent', () => {
    expect(SALDO_TOLERANZ_CENTS).toBe(1);
  });

  it('identische Summen stimmen', () => {
    expect(saldoStimmt(100000, 100000)).toBe(true);
    expect(saldoDifferenzInCent(100000, 100000)).toBe(0);
  });

  it('0,01 EUR Differenz ist noch toleriert', () => {
    expect(saldoStimmt(100000, 99999.99)).toBe(true);
    expect(saldoDifferenzInCent(100000, 99999.99)).toBe(1);
  });

  it('0,02 EUR Differenz ist NICHT mehr toleriert', () => {
    // Genau der Fall, der mit der Euro-Vergleichs-Variante durchging.
    expect(saldoDifferenzInCent(100000, 99999.98)).toBe(2);
    expect(saldoStimmt(100000, 99999.98)).toBe(false);
  });

  it('0,90 EUR Differenz ist NICHT toleriert', () => {
    expect(saldoStimmt(100000, 99999.1)).toBe(false);
  });

  it('symmetrisch: die Richtung spielt keine Rolle', () => {
    expect(saldoStimmt(99999.98, 100000)).toBe(false);
    expect(saldoStimmt(100000, 99999.98)).toBe(false);
  });

  it('Gleitkomma-Artefakte erzeugen keine Fehlentscheidung', () => {
    // 0.1 + 0.2 !== 0.3 in IEEE754. Ohne Rundung waere die
    // Differenz 0,30000000000000004 statt 30 Cent.
    expect(saldoDifferenzInCent(0.3, 0.1 + 0.2)).toBe(0);
    expect(saldoStimmt(0.3, 0.1 + 0.2)).toBe(true);
  });

  it('negative Summen werden korrekt behandelt', () => {
    expect(saldoStimmt(-100000, -100000)).toBe(true);
    expect(saldoStimmt(-100000, -99999.98)).toBe(false);
  });
});