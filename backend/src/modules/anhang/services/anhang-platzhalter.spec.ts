import { describe, expect, it } from 'vitest';
import { AnhangService } from './anhang.service';
import { ANHANG_VORLAGEN_PLATZHALTER } from '../constants/anhang.constants';

/**
 * Anhang: unaufgeloeste Vorlagen-Platzhalter.
 *
 * BEFUND 2026-10-17, gemessen ueber die API:
 *
 *   1. Anhang MIT Vorlage angelegt: HTTP 201
 *   2. Platzhalter im gespeicherten Anhang: 7
 *      -> [Ort], [Nummer], [Steuernummer], [Name], [Anzahl]
 *   3. Validieren: (keine Route — der Anhang hat gar keine)
 *   4. PDF erzeugen: HTTP 200
 *
 * Ein unausgefuellter Anhang erzeugt also ein veroeffentlichungsfaehiges
 * PDF mit "[Ort]" darin. § 264 Abs. 4 HGB verlangt konkrete Angaben.
 *
 * Der HTTP-Weg (legt einen echten Anhang an und fragt die Detailantwort ab)
 * steht in `e2e/anhang-platzhalter.e2e.spec.ts`. Hier ist die reine
 * Logik — sie braucht keinen Server.
 *
 * Geprueft wird beides: dass die Liste gefunden wird UND dass sie
 * verschwindet, sobald der Platzhalter ersetzt ist. Ein Test, der nur die
 * Meldung prueft, wuerde einen Fix belohnen, der immer "0 offen"
 * zurueckgibt.
 */
describe('Anhang.offenePlatzhalter', () => {
  // `offenePlatzhalter` ist eine reine Funktion ohne Zustand — die
  // Abhaengigkeiten werden hier nicht gebraucht.
  const svc = new AnhangService(null as never, null as never, null as never);

  it('die Liste stammt aus der Vorlage und ist nicht hartcodiert', () => {
    // Laesst man sie hartcodieren, verschwindet eine Vorlagen-Aenderung
    // still aus der Meldung. Deshalb wird hier die Konstante geprueft.
    expect(ANHANG_VORLAGEN_PLATZHALTER.length).toBeGreaterThan(0);
    expect([...ANHANG_VORLAGEN_PLATZHALTER].sort()).toEqual(
      ['Anzahl', 'Name', 'Nummer', 'Ort', 'Steuernummer'].sort(),
    );
  });

  it('ein aus der Vorlage angelegter Anhang meldet seine offenen Platzhalter', () => {
    const offen = svc.offenePlatzhalter({ abschnitte: [
      { inhalt: 'Sitz: [Ort], HRB [Nummer], Steuernummer [Steuernummer], Inhaber [Name], Mitarbeiter [Anzahl]' },
    ] });
    expect(offen.sort()).toEqual([...ANHANG_VORLAGEN_PLATZHALTER].sort());
  });

  it('nach dem Ausfuellen ist die Liste leer', () => {
    const offen = svc.offenePlatzhalter({ abschnitte: [
      { inhalt: 'Sitz: Berlin, HRB 123456, Steuernummer 123/456/789, Inhaber: Max Mustermann, Mitarbeiter: 42' },
    ] });
    expect(offen).toEqual([]);
  });

  it('eckige Klammern aus eigenem Text sind KEIN Platzhalter', () => {
    // Gegenprobe: "Vgl. [Anlage zum Anhang]" ist eine legitime Angabe.
    // Eine Mustererkennung auf eckige Klammern wuerde hier anschlagen und
    // den Anwender mit einem Fehler behelligen, der keiner ist. Genau
    // deshalb ist es eine Liste und kein Muster.
    const offen = svc.offenePlatzhalter({ abschnitte: [
      { inhalt: 'Vgl. [Anlage zum Anhang] und [Anlage 1]' },
    ] });
    expect(offen).toEqual([]);
  });

  it('nur die Abschnitte, die den Platzhalter wirklich enthalten, zaehlen', () => {
    const offen = svc.offenePlatzhalter({ abschnitte: [
      { inhalt: 'Sitz: [Ort]' },
      { inhalt: 'Allgemeine Angaben ohne Platzhalter.' },
    ] });
    expect(offen).toEqual(['Ort']);
  });
});
