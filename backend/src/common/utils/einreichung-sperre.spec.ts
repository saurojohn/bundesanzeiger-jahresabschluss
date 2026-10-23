import { describe, expect, it } from 'vitest';
import {
  EINGEREICHTE_ABSCHLUSS_STATUS,
  eingereichtSperrtext,
  istEingereicht,
} from './einreichung-sperre';

/**
 * BEFUND 2026-10-24 (Nachtrag 95): Nach der Einreichung beim
 * Bundesanzeiger (SUBMITTED) bzw. der Veroeffentlichung (PUBLISHED) war
 * der Inhalt der Bestandteile (Anhang-Pflichtangaben, `hinweise` der
 * Bilanz und der GuV) weiterhin änderbar.
 *
 * GEMESSEN an der laufenden API (Abschluss SUBMITTED, Bestellnummer
 * gesetzt):
 *
 *     PATCH /api/anhang/<id> { bilanzierungsMethoden: '…' } -> HTTP 200
 *     in der Datenbank: "NACHTRAG nach der Einreichung"
 *
 * Eine erneute Signatur ist für einen eingereichten Abschluss gesperrt
 * (Nachtrag 78), der Einreichungsweg setzt `SIGNED` voraus — die Änderung
 * konnte also **nie** nachgezogen werden (§ 147 AO: das eingereichte
 * Dokument ist die Fassung).
 *
 * Diese Datei ist die **eine** Stelle, an der die Regel steht: alle drei
 * Bestandteile (Anhang, Bilanz, GuV) fragen sie ab.
 */
describe('Einreichungs-Sperre (Nachtrag 95)', () => {
  it('friert den Bestand nach der Einreichung und der Veroeffentlichung ein', () => {
    expect(istEingereicht('SUBMITTED')).toBe(true);
    expect(istEingereicht('PUBLISHED')).toBe(true);
  });

  it('laesst den Korrekturvorgang bis zur Einreichung offen', () => {
    // Bis hierher darf geaendert und danach neu signiert werden
    // (Entscheidung der Fachverantwortlichen vom 2026-10-14).
    for (const status of ['DRAFT', 'FINALIZED', 'VALIDATED', 'SIGNED']) {
      expect(istEingereicht(status), status).toBe(false);
    }
  });

  it('behandelt fehlende und unsinnige Werte als "nicht eingereicht"', () => {
    expect(istEingereicht(null)).toBe(false);
    expect(istEingereicht(undefined)).toBe(false);
    expect(istEingereicht('')).toBe(false);
    expect(istEingereicht('IRGENDWAS')).toBe(false);
  });

  it('nennt im Text den Status und den Grund', () => {
    const text = eingereichtSperrtext('SUBMITTED');
    expect(text).toContain('SUBMITTED');
    expect(text).toContain('Bundesanzeiger');
    expect(text).toContain('§ 147 AO');
  });

  it('die gesperrten Status stehen in genau einer Liste', () => {
    expect([...EINGEREICHTE_ABSCHLUSS_STATUS]).toEqual(['SUBMITTED', 'PUBLISHED']);
  });
});
