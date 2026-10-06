/**
 * Regressionstest: E-Bilanz-Generierung braucht eine saldostimmende
 * Bilanz.
 *
 * Bugfix 2026-10-06. `generateEbilanzXbrl()` berechnete `saldostimmt`,
 * gab den Wert aber nur als Metadatum zurueck und erzeugte die Datei
 * trotzdem.
 *
 * Empirischer Befund gegen die echte API (Demo GmbH, GJ 2025): Nach dem
 * PATCH der Bilanz auf Aktiva 0 / Passiva 30.000 antwortete
 * `POST /api/ebilanz/generate` mit HTTP 200 und lieferte eine
 * 4.837 Byte grosse XBRL-Datei. `metadata.saldostimmt` war `false`.
 * Das Gate lag damit im Response, nicht vor der Datei — § 264 Abs. 2
 * HGB verlangt aber, dass die Bilanz stimmig IST.
 */

import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { XbrlGeneratorService } from './xbrl-generator.service';

const MANDANT_ID = 'aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa';

function bilanzStub(aktiva: number, passiva: number) {
  return {
    id: 'b'.repeat(8) + '-3333-4333-8333-333333333333',
    geschaeftsjahr: 2025,
    positionen: [
      { seite: 'AKTIVA', kontonummer: 'A.', bezeichnung: 'Aktiva', betragAktuell: String(aktiva) },
      { seite: 'PASSIVA', kontonummer: 'P.', bezeichnung: 'Passiva', betragAktuell: String(passiva) },
    ],
  };
}

function buildService(aktiva: number, passiva: number): XbrlGeneratorService {
  return new XbrlGeneratorService(
    {
      mandant: {
        findUnique: vi.fn().mockResolvedValue({
          id: MANDANT_ID,
          firmenname: 'Test GmbH',
          rechtsform: 'GmbH',
          handelsregister: 'HRB 1',
          steuernummer: '12/345/67890',
        }),
      },
    } as never,
    { findWithPositionen: vi.fn().mockResolvedValue(bilanzStub(aktiva, passiva)) } as never,
    {
      findWithPositionen: vi.fn().mockResolvedValue({
        id: 'c'.repeat(8) + '-3333-4333-8333-333333333333',
        geschaeftsjahr: 2025,
        verfahren: 'GKV',
        ergebnis: '0.00',
        positionen: [],
      }),
    } as never,
    {
      findWithAbschnitte: vi.fn().mockResolvedValue({
        id: 'd'.repeat(8) + '-3333-4333-8333-333333333333',
        geschaeftsjahr: 2025,
        bilanzierungsMethoden: 'Nach HGB.',
        bewertungsMethoden: 'Niedrigster Wert.',
        sonstigePflichtangaben: 'Mitarbeiter: 3.',
        abschnitte: [],
      }),
    } as never,
    { record: vi.fn().mockResolvedValue(undefined) } as never,
  );
}

function generate(aktiva: number, passiva: number) {
  return buildService(aktiva, passiva).generateEbilanzXbrl(
    {
      bilanzId: 'b'.repeat(8) + '-3333-4333-8333-333333333333',
      guvId: 'c'.repeat(8) + '-3333-4333-8333-333333333333',
      anhangId: 'd'.repeat(8) + '-3333-4333-8333-333333333333',
      mandantId: MANDANT_ID,
    },
    {
      id: 'e'.repeat(8) + '-3333-4333-8333-333333333333',
      globalRole: null,
      mandanten: [{ id: MANDANT_ID, firmenname: 'Test GmbH', rolle: 'STEUERBERATER' }],
    } as never,
    {},
  );
}

describe('E-Bilanz-Generierung: Saldo-Gate', () => {
  it('erzeugt die Datei bei saldostimmender Bilanz', async () => {
    const r = await generate(100000, 100000);
    expect(r.xbrlBase64).toBeTruthy();
    expect(r.metadata.saldostimmt).toBe(true);
  });

  it('bricht bei nicht saldostimmender Bilanz ab — ohne Datei', async () => {
    // Exakt der beobachtete Vorher-Zustand: Aktiva 0 / Passiva 30.000.
    await expect(generate(0, 30000)).rejects.toThrow(BadRequestException);
  });

  it('nennt im Fehler die Differenz und beide Summen', async () => {
    try {
      await generate(0, 30000);
      throw new Error('Sollte abbrechen');
    } catch (fehler) {
      expect(fehler).toBeInstanceOf(BadRequestException);
      const body = (fehler as BadRequestException).getResponse() as {
        message: string;
        code: string;
        aktivaSumme: number;
        passivaSumme: number;
        differenz: number;
      };
      expect(body.code).toBe('BILANZ_NICHT_SALDOSTIMMIG');
      expect(body.aktivaSumme).toBe(0);
      expect(body.passivaSumme).toBe(30000);
      expect(body.differenz).toBe(-30000);
      expect(body.message).toMatch(/nicht saldostimmig/i);
      expect(body.message).toContain('keine E-Bilanz erzeugt');
    }
  });

  it('weist auch die Gegenrichtung ab (Aktiva > Passiva)', async () => {
    // Vorher behandelte der Vergleich vermutlich nur eine Richtung oder
    // gar nicht — mit einer symmetrischen Pruefung darf der Fehler
    // nicht davon abhaengen, welche Seite groesser ist.
    await expect(generate(30000, 0)).rejects.toThrow(BadRequestException);
  });

  it('greift auch bei einer winzigen Differenz von 0,02 EUR', async () => {
    // Toleranz ist 0,01 EUR. Eine echte Differenz darf nicht durchrutschen.
    await expect(generate(100000, 99999.98)).rejects.toThrow(BadRequestException);
  });

  it('Gate und Metadatum benutzen dieselbe Bedingung', async () => {
    // Sonst koennte im Grenzfall eine Datei erzeugt und gleichzeitig
    // `saldostimmt: false` gemeldet werden.
    const service = buildService(100000, 99999.98);
    const intern = service as unknown as {
      saldoStimmt(t: { aktivaSumme: number; passivaSumme: number }): boolean;
    };
    expect(intern.saldoStimmt({ aktivaSumme: 100000, passivaSumme: 99999.98 })).toBe(false);
    expect(intern.saldoStimmt({ aktivaSumme: 100000, passivaSumme: 100000 })).toBe(true);
  });

  it('schreibt keinen Audit-Log, wenn abgebrochen wird', async () => {
    // Ein EXPORT-Eintrag fuer eine Datei, die es nicht gibt, waere ein
    // falscher Aufzeichnungsstand (§ 147 AO).
    const record = vi.fn().mockResolvedValue(undefined);
    const service = new XbrlGeneratorService(
      {
        mandant: {
          findUnique: vi.fn().mockResolvedValue({
            id: MANDANT_ID,
            firmenname: 'Test GmbH',
            rechtsform: 'GmbH',
            handelsregister: 'HRB 1',
            steuernummer: '12/345/67890',
          }),
        },
      } as never,
      { findWithPositionen: vi.fn().mockResolvedValue(bilanzStub(0, 30000)) } as never,
      {
        findWithPositionen: vi.fn().mockResolvedValue({
          id: 'c'.repeat(8) + '-3333-4333-8333-333333333333',
          geschaeftsjahr: 2025,
          verfahren: 'GKV',
          ergebnis: '0.00',
          positionen: [],
        }),
      } as never,
      {
        findWithAbschnitte: vi.fn().mockResolvedValue({
          id: 'd'.repeat(8) + '-3333-4333-8333-333333333333',
          geschaeftsjahr: 2025,
          bilanzierungsMethoden: null,
          bewertungsMethoden: null,
          sonstigePflichtangaben: null,
          abschnitte: [],
        }),
      } as never,
      { record } as never,
    );

    await expect(
      service.generateEbilanzXbrl(
        {
          bilanzId: 'b',
          guvId: 'c',
          anhangId: 'd',
          mandantId: MANDANT_ID,
        },
        { globalRole: null, mandanten: [{ id: MANDANT_ID }] } as never,
        {},
      ),
    ).rejects.toThrow(BadRequestException);
    expect(record).not.toHaveBeenCalled();
  });
});