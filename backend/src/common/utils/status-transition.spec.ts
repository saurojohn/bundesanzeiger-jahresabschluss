import { describe, it, expect } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import {
  BEARBEITUNGSSTATUS,
  FREIGABEMARKER,
  assertFreigabemarkerUnveraendert,
  assertKeinZuruecksetzenInBearbeitung,
  istInBearbeitung,
} from './status-transition';

/**
 * BEFUND 2026-10-09 — `status` kam ungeprueft aus dem Request. Damit war
 * die Sperre „Positionen nur in DRAFT" ueber einen einzigen PATCH
 * aufzuheben:
 *
 *   PATCH { status: 'DRAFT' }   -> 200
 *   PATCH { positionen: [...] } -> 200   (Betraege wirklich neu)
 *
 * Live gemessen an einer Bilanz, vier Requests ueber die oeffentliche API.
 */
describe('Statusübergang: Bearbeitung ist monoton', () => {
  it('ein abgeschlossener Satz darf nicht wieder in Bearbeitung', () => {
    expect(() =>
      assertKeinZuruecksetzenInBearbeitung('VALIDATED', 'DRAFT', 'Bilanz'),
    ).toThrow(BadRequestException);
  });

  it('auch der Vier-Augen-Stand APPROVED ist geschuetzt', () => {
    // Die WP-Pruefung setzt APPROVED direkt (`setBilanzStatus`). Von dort
    // aus genuegte derselbe PATCH, um die Freigabe anschliessend
    // wegzurechnen — die Kontrolle lag an zwei Requests verteilt.
    expect(() =>
      assertKeinZuruecksetzenInBearbeitung('APPROVED', 'DRAFT', 'Bilanz'),
    ).toThrow(BadRequestException);
    expect(() =>
      assertKeinZuruecksetzenInBearbeitung('ARCHIVED', 'DRAFT', 'Anhang'),
    ).toThrow(BadRequestException);
  });

  it('aus DRAFT heraus ist jeder Zielstatus erlaubt', () => {
    // Das ist der normale Weg: Entwurf -> Validierung -> Archiv.
    expect(() => assertKeinZuruecksetzenInBearbeitung('DRAFT', 'VALIDATED', 'Bilanz')).not.toThrow();
    expect(() => assertKeinZuruecksetzenInBearbeitung('DRAFT', 'ARCHIVED', 'Bilanz')).not.toThrow();
  });

  it('vorwaertsgerichtete Wege unter abgeschlossenen Zustaenden bleiben offen', () => {
    // Hier wird bewusst KEINE vollstaendige Zustandsmaschine erfunden:
    // welcher Uebergang wann erlaubt ist, ist eine Fachentscheidung.
    expect(() => assertKeinZuruecksetzenInBearbeitung('VALIDATED', 'ARCHIVED', 'Bilanz')).not.toThrow();
  });

  it('ohne status im Request passiert nichts', () => {
    expect(() => assertKeinZuruecksetzenInBearbeitung('VALIDATED', undefined, 'GuV')).not.toThrow();
  });

  it('derselbe Status ist kein Uebergang', () => {
    expect(() => assertKeinZuruecksetzenInBearbeitung('VALIDATED', 'VALIDATED', 'GuV')).not.toThrow();
  });

  it('die Meldung nennt den Ist-Status und das Gesetz', () => {
    const fehler = (() => {
      try {
        assertKeinZuruecksetzenInBearbeitung('ARCHIVED', 'DRAFT', 'Anhang');
        return null;
      } catch (e) {
        return e as BadRequestException;
      }
    })();

    expect(fehler).toBeInstanceOf(BadRequestException);
    expect(fehler?.message).toContain('ARCHIVED');
    expect(fehler?.message).toContain('Anhang');
    expect(fehler?.message).toContain('147');
  });

  it('istInBearbeitung entscheidet ueber die Inhaltssperre', () => {
    expect(istInBearbeitung(BEARBEITUNGSSTATUS)).toBe(true);
    expect(istInBearbeitung('VALIDATED')).toBe(false);
    expect(istInBearbeitung('ARCHIVED')).toBe(false);
    expect(istInBearbeitung('APPROVED')).toBe(false);
  });
});

describe('Statusübergang: der Vier-Augen-Freigabemarker ist Endzustand', () => {
  // BEFUND 2026-10-22 (Nachtrag 81): Die Regel blockierte nur den Uebergang
  // nach DRAFT. Jeder andere Uebergang aus APPROVED war frei — der Marker
  // liess sich also wegraeumen, und das PDF druckt `Status: ${status}`.
  it('der Marker kann nicht auf VALIDATED gesetzt werden', () => {
    expect(() =>
      assertFreigabemarkerUnveraendert('APPROVED', 'VALIDATED', 'Bilanz'),
    ).toThrow(BadRequestException);
  });

  it('der Marker kann auch nicht auf ARCHIVED gesetzt werden', () => {
    expect(() =>
      assertFreigabemarkerUnveraendert('APPROVED', 'ARCHIVED', 'Bilanz'),
    ).toThrow(BadRequestException);
  });

  it('ohne Statusangabe passiert nichts', () => {
    expect(() =>
      assertFreigabemarkerUnveraendert('APPROVED', undefined, 'Bilanz'),
    ).not.toThrow();
  });

  it('derselbe Status ist kein Wechsel', () => {
    expect(() =>
      assertFreigabemarkerUnveraendert('APPROVED', 'APPROVED', 'Bilanz'),
    ).not.toThrow();
  });

  it('ohne Freigabe bleibt der Vorwaertsweg offen', () => {
    // VALIDATED -> ARCHIVED ist ein vorwaertsgerichteter Schritt und bleibt
    // erlaubt — die Regel schliesst nur den Freigabemarker aus.
    expect(() =>
      assertFreigabemarkerUnveraendert('VALIDATED', 'ARCHIVED', 'Bilanz'),
    ).not.toThrow();
    expect(() =>
      assertFreigabemarkerUnveraendert('DRAFT', 'VALIDATED', 'Bilanz'),
    ).not.toThrow();
  });

  it('die Meldung nennt den Freigabestatus und das Gesetz', () => {
    const fehler = (() => {
      try {
        assertFreigabemarkerUnveraendert('APPROVED', 'VALIDATED', 'Bilanz');
        return null;
      } catch (e) {
        return e as BadRequestException;
      }
    })();
    expect(fehler).toBeInstanceOf(BadRequestException);
    expect(fehler?.message).toContain('APPROVED');
    expect(fehler?.message).toContain('146');
  });

  it('der Freigabemarker ist die bekannte Datenbank-Menge', () => {
    expect(FREIGABEMARKER).toBe('APPROVED');
  });
});
