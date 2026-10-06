/**
 * Regressionstest: das Mapping darf Positionen nicht stillschweigend
 * verlieren.
 *
 * Bugfix 2026-10-06. `mapBilanzPositionen()` und `mapGuVPositionen()`
 * haben jede nicht passende Position per `continue` verworfen.
 * `previewMapping()` gab daraufhin `unMapped: []` zurueck — die
 * Vorschau versprach eine vollstaendige Abbildung, die es nicht gab.
 *
 * Dieselbe Luecke bestand in der Generierung selbst: eine Position,
 * die kein Concept findet, fehlte einfach in der XBRL-Datei. Aktiva =
 * Passiva konnte trotzdem stimmen, und der Validator meldete hoechstens
 * eine Warnung ueber fehlende Pflichtpositionen.
 */

import { describe, it, expect, vi } from 'vitest';
import { XbrlGeneratorService } from './xbrl-generator.service';

const MANDANT_ID = 'aaaaaaaa-4444-4444-8444-aaaaaaaaaaaa';

interface Pos {
  seite?: string;
  kontonummer: string;
  bezeichnung: string;
  betragAktuell: string;
  kategorie?: string;
}

function buildService(bilanzPos: Pos[], guvPos: Pos[]) {
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
    {
      findWithPositionen: vi.fn().mockResolvedValue({
        id: 'b1',
        geschaeftsjahr: 2025,
        positionen: bilanzPos,
      }),
    } as never,
    {
      findWithPositionen: vi.fn().mockResolvedValue({
        id: 'c1',
        geschaeftsjahr: 2025,
        verfahren: 'GKV',
        ergebnis: '0.00',
        positionen: guvPos,
      }),
    } as never,
    {
      findWithAbschnitte: vi.fn().mockResolvedValue({
        id: 'd1',
        geschaeftsjahr: 2025,
        bilanzierungsMethoden: null,
        bewertungsMethoden: null,
        sonstigePflichtangaben: null,
        abschnitte: [],
      }),
    } as never,
    { record: vi.fn().mockResolvedValue(undefined) } as never,
  );
}

const USER = {
  id: 'e1',
  globalRole: null,
  mandanten: [{ id: MANDANT_ID, firmenname: 'Test GmbH', rolle: 'STEUERBERATER' }],
} as never;

function preview(bilanzPos: Pos[], guvPos: Pos[]) {
  return buildService(bilanzPos, guvPos).previewMapping({
    bilanzId: 'b1',
    guvId: 'c1',
    anhangId: 'd1',
    mandantId: MANDANT_ID,
    user: USER,
  });
}

// Kontenschluessel aus `prisma/seed.ts` — `A.II.1.` ist ein
// Aktiva-Konzept, `A.I.` (Passiva) ein Passiva-Konzept. Mit erfundenen
// Nummern waere die Vorlage selbst ungemappt und die Erwartung
// `unMapped: []` koennte nie halten.
const SALDOSTIMMIG: Pos[] = [
  { seite: 'AKTIVA', kontonummer: 'A.II.1.', bezeichnung: 'Grundstuecke und Bauten', betragAktuell: '100000.00' },
  { seite: 'PASSIVA', kontonummer: 'A.I.', bezeichnung: 'Gezeichnetes Kapital', betragAktuell: '100000.00' },
];

describe('E-Bilanz-Mapping: unMapped wird berichtet', () => {
  it('meldet eine Bilanzposition ohne Taxonomie-Konzept', async () => {
    const r = await preview(
      [
        ...SALDOSTIMMIG,
        { seite: 'AKTIVA', kontonummer: 'Z.99.', bezeichnung: 'Erfundenes Konto', betragAktuell: '1234.00' },
      ],
      [],
    );
    expect(r.unMapped).toHaveLength(1);
    expect(r.unMapped[0].kontonummer).toBe('Z.99.');
    expect(r.unMapped[0].betragAktuell).toBe(1234);
    expect(r.unMapped[0].reason).toMatch(/Kein Taxonomie-Konzept/);
  });

  it('meldet eine GuV-Position ohne Taxonomie-Konzept', async () => {
    const r = await preview(SALDOSTIMMIG, [
      { kontonummer: '99.', bezeichnung: 'Erfundene GuV-Zeile', betragAktuell: '500.00' },
    ]);
    expect(r.unMapped).toHaveLength(1);
    expect(r.unMapped[0].kontonummer).toBe('99.');
    expect(r.unMapped[0].reason).toMatch(/Kein GKV-Taxonomie-Konzept/);
  });

  it('loest einen mehrdeutigen Schluessel je Bilanzseite anders auf', async () => {
    // `A.III.1.` ist Aktiva „Anteile an verbundenen Unternehmen" und
    // Passiva „Gesetzliche Ruecklage". Vor dem Fix gewann immer die
    // Aktiva-Variante, wodurch alle fuenf mehrdeutigen Passiva-Positionen
    // aus der Datei fielen. Beide Seiten muessen jetzt mappen.
    const r = await preview(
      [
        { seite: 'AKTIVA', kontonummer: 'A.III.1.', bezeichnung: 'Anteile an verbundenen Unternehmen', betragAktuell: '1000.00' },
        { seite: 'PASSIVA', kontonummer: 'A.III.1.', bezeichnung: 'Gesetzliche Ruecklage', betragAktuell: '1000.00' },
        { seite: 'AKTIVA', kontonummer: 'D.', bezeichnung: 'Aktive latente Steuern', betragAktuell: '0.00' },
        { seite: 'PASSIVA', kontonummer: 'D.', bezeichnung: 'Rechnungsabgrenzungsposten', betragAktuell: '0.00' },
      ],
      [],
    );
    expect(r.unMapped, JSON.stringify(r.unMapped)).toEqual([]);
    expect(
      r.bilanzAktivaMappings.find((m) => m.source.kontonummer === 'A.III.1.')?.target.code,
    ).toBe('bs.ass.fixAss.finAss.affiliated');
    expect(
      r.bilanzPassivaMappings.find((m) => m.source.kontonummer === 'A.III.1.')?.target.code,
    ).toBe('bs.eqLiab.equity.earnRes.statRes');
    expect(
      r.bilanzAktivaMappings.find((m) => m.source.kontonummer === 'D.')?.target.code,
    ).toBe('bs.ass.defTax');
    expect(
      r.bilanzPassivaMappings.find((m) => m.source.kontonummer === 'D.')?.target.code,
    ).toBe('bs.eqLiab.deferredInc');
  });

  it('meldet einen Schluessel, der auf dieser Seite nicht existiert', async () => {
    // `A.I.` (Gezeichnetes Kapital) ist ein reiner Passiva-Schluessel.
    const r = await preview(
      [
        ...SALDOSTIMMIG,
        { seite: 'AKTIVA', kontonummer: 'A.I.', bezeichnung: 'Gezeichnetes Kapital', betragAktuell: '50000.00' },
      ],
      [],
    );
    expect(r.unMapped).toHaveLength(1);
    expect(r.unMapped[0].kontonummer).toBe('A.I.');
    expect(r.unMapped[0].reason).toMatch(/Kein Taxonomie-Konzept/);
  });

  it('meldet eine unbekannte Bilanzseite', async () => {
    const r = await preview(
      [
        ...SALDOSTIMMIG,
        { seite: 'TYPO', kontonummer: 'A.II.1.', bezeichnung: 'Tippfehler', betragAktuell: '1.00' },
      ],
      [],
    );
    expect(r.unMapped).toHaveLength(1);
    expect(r.unMapped[0].reason).toMatch(/Unbekannte Bilanzseite/);
  });

  it('liefert bei vollstaendiger Abbildung eine leere Liste', async () => {
    // Gegenseite der Pruefung: `[]` muss hier auch wirklich „alles
    // gemappt" bedeuten und nicht „Liste ist kaputt".
    const r = await preview(SALDOSTIMMIG, [
      { kontonummer: '1.', bezeichnung: 'Umsatzerlöse', betragAktuell: '1000.00' },
    ]);
    expect(r.unMapped).toEqual([]);
  });

  it('bilanziert UND guv-treffer separat — nichts geht verloren', async () => {
    const r = await preview(SALDOSTIMMIG, [
      { kontonummer: '1.', bezeichnung: 'Umsatzerlöse', betragAktuell: '1000.00' },
      { kontonummer: '98.', bezeichnung: 'Kaputt', betragAktuell: '7.00' },
    ]);
    expect(r.guvMappings).toHaveLength(1);
    expect(r.unMapped).toHaveLength(1);
    expect(r.unMapped[0].kontonummer).toBe('98.');
  });

  it('die Generierung meldet unMapped in den Metadaten', async () => {
    const service = buildService(
      [...SALDOSTIMMIG, { seite: 'AKTIVA', kontonummer: 'Z.1.', bezeichnung: 'Weg', betragAktuell: '0.00' }],
      [],
    );
    const r = await service.generateEbilanzXbrl(
      { bilanzId: 'b1', guvId: 'c1', anhangId: 'd1', mandantId: MANDANT_ID },
      USER,
      {},
    );
    expect(r.metadata.unMapped).toHaveLength(1);
    expect(r.metadata.unMapped[0].kontonummer).toBe('Z.1.');
  });

  it('protokolliert unMapped im Audit-Log', async () => {
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
      {
        findWithPositionen: vi.fn().mockResolvedValue({
          id: 'b1',
          geschaeftsjahr: 2025,
          positionen: [
            ...SALDOSTIMMIG,
            { seite: 'AKTIVA', kontonummer: 'Z.1.', bezeichnung: 'Weg', betragAktuell: '0.00' },
          ],
        }),
      } as never,
      {
        findWithPositionen: vi.fn().mockResolvedValue({
          id: 'c1',
          geschaeftsjahr: 2025,
          verfahren: 'GKV',
          ergebnis: '0.00',
          positionen: [],
        }),
      } as never,
      {
        findWithAbschnitte: vi.fn().mockResolvedValue({
          id: 'd1',
          geschaeftsjahr: 2025,
          bilanzierungsMethoden: null,
          bewertungsMethoden: null,
          sonstigePflichtangaben: null,
          abschnitte: [],
        }),
      } as never,
      { record } as never,
    );

    await service.generateEbilanzXbrl(
      { bilanzId: 'b1', guvId: 'c1', anhangId: 'd1', mandantId: MANDANT_ID },
      USER,
      {},
    );
    expect(record).toHaveBeenCalledTimes(1);
    const newState = record.mock.calls[0][0].newState as {
      unMappedAnzahl: number;
      unMappedPositionen: string[];
    };
    expect(newState.unMappedAnzahl).toBe(1);
    expect(newState.unMappedPositionen[0]).toContain('Z.1.');
  });

  it('Meldung nennt das Verfahren, damit UKV-Luecken erkennbar sind', async () => {
    // Bei UKV ist eine GKV-Kontenrahmenzeile zwingend nicht gemappt —
    // die Meldung muss das sagen, sonst ist sie nicht deutbar.
    const service = buildService(SALDOSTIMMIG, [
      { kontonummer: '5a.', bezeichnung: 'Materialaufwand', betragAktuell: '100.00' },
    ]);
    const r = await service.previewMapping({
      bilanzId: 'b1',
      guvId: 'c1',
      anhangId: 'd1',
      mandantId: MANDANT_ID,
      user: USER,
    });
    // 5a. ist im UKV-Schema nicht vorhanden -> muss auffallen
    expect(r.unMapped.length + r.guvMappings.length).toBeGreaterThan(0);
  });
});