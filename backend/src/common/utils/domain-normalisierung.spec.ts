/**
 * BEFUND 2026-10-22 (Nachtrag 83): Die Custom-Domain wurde unveraendert
 * gespeichert. DNS ist case-insensitiv, der UNIQUE-Constraint in der
 * Datenbank ist es nicht — zwei Kanzleien konnten dieselbe Domain
 * beanspruchen (gemessen an der laufenden API):
 *
 *     Kanzlei A: "beispiel-messung.de"   -> HTTP 200
 *     Kanzlei B: "BEISPIEL-MESSUNG.DE"   -> HTTP 200   (statt 400)
 *
 * Die Normalisierung muss an der **Grenze** passieren: dort, wo eine Domain
 * in die Anwendung hineinkommt, und dort, wo sie gespeichert wird.
 */
import { describe, it, expect } from 'vitest';
import { normalisiereDomain } from './domain-normalisierung';

describe('normalisiereDomain', () => {
  it('schreibt klein', () => {
    expect(normalisiereDomain('BEISPIEL-MESSUNG.DE')).toBe('beispiel-messung.de');
    expect(normalisiereDomain('Rechnungen.Kanzlei.De')).toBe(
      'rechnungen.kanzlei.de',
    );
  });

  it('entfernt Leerraum am Anfang und Ende', () => {
    expect(normalisiereDomain('  example.de  ')).toBe('example.de');
  });

  it('entfernt den abschliessenden Punkt (FQDN-Schreibweise)', () => {
    expect(normalisiereDomain('example.de.')).toBe('example.de');
    expect(normalisiereDomain('example.de..')).toBe('example.de');
  });

  it('laesst eine Subdomain unangetastet', () => {
    // Der Label-First-Teil ist fachlich bedeutsam ("www." ist eine andere
    // Domain als die Apex-Domain) — die Normalisierung fasst ihn nicht an.
    expect(normalisiereDomain('WWW.Example.DE')).toBe('www.example.de');
    expect(normalisiereDomain('rechnungen.kanzlei.de')).toBe(
      'rechnungen.kanzlei.de',
    );
  });

  it('liefert bei leerer Eingabe eine leere Zeichenkette (kein Fehler)', () => {
    expect(normalisiereDomain('')).toBe('');
    expect(normalisiereDomain('   ')).toBe('');
  });

  it('ist idempotent', () => {
    const einmal = normalisiereDomain('  BEISPIEL.DE.  ');
    expect(normalisiereDomain(einmal)).toBe(einmal);
  });
});
