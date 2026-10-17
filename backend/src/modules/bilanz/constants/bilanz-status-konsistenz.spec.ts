import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BILANZ_STATUS,
  BILANZ_DATENSTATUS,
} from './hgb-bilanz.constants';

/**
 * Der Status, den der Wirtschaftsprüfer setzt, muss in der Oberflaeche
 * übersetzt sein.
 *
 * BEFUND 2026-10-17, im Browser gemessen: Nach der Vier-Augen-Freigabe
 * zeigte die Bilanzliste den **rohen Schlüssel** `bilanz.status.APPROVED`.
 * `APPROVED` stand in keiner der beiden Statusmengen des Backends und in
 * keiner Übersetzung — obwohl der WP-Service genau das schreibt.
 *
 * Dieser Test ist die repo-übergreifende Invariante:
 *
 *   1. Jeder Status, in der Datenbank stehen kann, hat eine Übersetzung.
 *   2. `APPROVED` ist **nicht** per API setzbar — sonst könnte ein Bearbeiter
 *      eine Bilanz ohne Vier-Augen-Prüfung als freigegeben markieren.
 */
describe('Bilanz-Status: Datenbestand und Übersetzung decken sich', () => {
  const messagesPath = join(
    process.cwd(),
    '..',
    'frontend',
    'src',
    'messages',
    'de-DE.json',
  );

  it('jeder Datenstatus hat eine Übersetzung', () => {
    const meldungen = JSON.parse(readFileSync(messagesPath, 'utf-8')) as {
      bilanz?: { status?: Record<string, string> };
    };
    const uebersetzungen = Object.keys(meldungen.bilanz?.status ?? {});

    const ohne = BILANZ_DATENSTATUS.filter(
      (s) => !uebersetzungen.includes(s),
    );
    expect(
      ohne,
      `Status ohne Übersetzung: ${ohne.join(', ')} — die Oberfläche zeigt dann ` +
        'den rohen Schlüsselpfad statt einer Beschriftung',
    ).toEqual([]);
  });

  it('APPROVED ist nicht per API setzbar (Vier-Augen-Prinzip)', () => {
    // `BILANZ_STATUS` ist die Menge, die der Client setzen darf. APPROVED
    // darf dort NICHT stehen: der Wirtschaftsprüfer setzt es direkt, und
    // jeder andere darf es nicht.
    expect(BILANZ_STATUS).not.toContain('APPROVED');
    expect(BILANZ_DATENSTATUS).toContain('APPROVED');
  });

  it('die beiden Mengen unterscheiden sich nur in APPROVED', () => {
    const setzbar: readonly string[] = BILANZ_STATUS;
    const extra = BILANZ_DATENSTATUS.filter((s) => !setzbar.includes(s));
    expect(extra).toEqual(['APPROVED']);
  });
});
