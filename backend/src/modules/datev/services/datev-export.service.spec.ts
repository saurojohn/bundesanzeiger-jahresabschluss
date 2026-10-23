import { describe, it, expect, vi } from 'vitest';
import { DatevExportService } from './datev-export.service';
import type { AuthUser } from '../../auth/types/auth-user.types';

/**
 * BEFUND 2026-10-23 (Nachtrag 87): Der Export schrieb **zwei Zeilen je
 * GuV-Position** — Soll-Zeile und Haben-Zeile mit **identischen** Konten.
 *
 * Im Sachkonten-Buchungsstapel ist **eine Zeile = eine Buchung** (Umsatz,
 * Soll/Haben, Konto, Gegenkonto). Die zweite Zeile war keine "Gegenseite",
 * sondern eine zweite Buchung: jedes Konto saldierte auf 0 und der Import
 * der Anwendung ueberspringt genau solche Konten ("kein Buchungseffekt") —
 * die Datei war damit ohne Buchungswirkung.
 *
 * Der Round-Trip ueber die laufende Anwendung steht in
 * `e2e/datev-roundtrip.e2e.spec.ts`; dieser Test sichert die Zeilenstruktur
 * direkt am Service ab.
 */
const MANDANT_ID = 'aaaaaaaa-4444-4444-8444-aaaaaaaaaaaa';
const GUV_ID = 'bbbbbbbb-4444-4444-8444-bbbbbbbbbbbb';

const USER = {
  id: 'e1e1e1e1-4444-4444-8444-e1e1e1e1e1e1',
  globalRole: null,
  mandanten: [{ id: MANDANT_ID, firmenname: 'Test GmbH', rolle: 'STEUERBERATER' }],
} as unknown as AuthUser;

function buildService(positionen: unknown[]) {
  const guvRepository = {
    findWithPositionen: vi.fn().mockResolvedValue({
      id: GUV_ID,
      mandantId: MANDANT_ID,
      geschaeftsjahr: 2025,
      verfahren: 'GKV',
      ergebnis: '600.00',
      positionen,
    }),
  };
  const prisma = {
    mandant: {
      findUnique: vi.fn().mockResolvedValue({
        id: MANDANT_ID, firmenname: 'Test GmbH', rechtsform: 'GmbH',
      }),
    },
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new DatevExportService(
    prisma as never,
    guvRepository as never,
    audit as never,
  );
  return { service, audit };
}

const ERLOES = {
  kontonummer: '1.', bezeichnung: 'Umsatzerloese', kategorie: 'ERLOES',
  betragAktuell: '1000.00', reihenfolge: 1,
};
const AUFWAND = {
  kontonummer: '5a.', bezeichnung: 'Materialaufwand', kategorie: 'MATERIAL',
  betragAktuell: '400.00', reihenfolge: 2,
};

/** Die Buchungszeilen (ab Zeile 4) als Arrays. */
function buchungsZeilen(csvBase64: string): string[][] {
  const csv = Buffer.from(csvBase64, 'base64').toString('utf-8');
  const zeilen = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  return zeilen.slice(3).map((z) => z.split(';').map((f) => f.replace(/"/g, '')));
}

describe('DATEV-Export: eine Buchung je Position (Nachtrag 87)', () => {
  it('schreibt genau eine Zeile je GuV-Position', async () => {
    const { service } = buildService([ERLOES, AUFWAND]);
    const r = await service.generateBuchungsstapel(
      {
        guvId: GUV_ID,
        mandantId: MANDANT_ID,
        beraternummer: '12345',
        mandantennummer: '67890',
        skrPlan: 'SKR04',
      } as never,
      USER,
      {},
    );

    const zeilen = buchungsZeilen(r.csvBase64);
    expect(
      zeilen.length,
      `je Position genau eine Zeile (gefunden: ${zeilen.length})`,
    ).toBe(2);
  });

  it('bucht den Erloes: Soll Bank, Haben Ertrag — in EINER Zeile', async () => {
    const { service } = buildService([ERLOES]);
    const r = await service.generateBuchungsstapel(
      {
        guvId: GUV_ID, mandantId: MANDANT_ID,
        beraternummer: '12345', mandantennummer: '67890', skrPlan: 'SKR04',
      } as never,
      USER,
      {},
    );

    const [zeile] = buchungsZeilen(r.csvBase64);
    expect(zeile![0]).toBe('1000,00');
    expect(zeile![1]).toBe('S');
    expect(zeile![6], 'Konto (Soll-Seite)').toBe('1800');
    expect(zeile![7], 'Gegenkonto (Haben-Seite)').toBe('4400');
  });

  it('bucht den Aufwand: Soll Aufwandskonto, Haben Bank — in EINER Zeile', async () => {
    const { service } = buildService([AUFWAND]);
    const r = await service.generateBuchungsstapel(
      {
        guvId: GUV_ID, mandantId: MANDANT_ID,
        beraternummer: '12345', mandantennummer: '67890', skrPlan: 'SKR04',
      } as never,
      USER,
      {},
    );

    const [zeile] = buchungsZeilen(r.csvBase64);
    expect(zeile![0]).toBe('400,00');
    expect(zeile![6]).toBe('5000');
    expect(zeile![7]).toBe('1800');
  });

  it('Gegenprobe: eine Nullposition erzeugt keine Zeile', async () => {
    const { service } = buildService([
      { ...ERLOES, betragAktuell: '0.00' },
      AUFWAND,
    ]);
    const r = await service.generateBuchungsstapel(
      {
        guvId: GUV_ID, mandantId: MANDANT_ID,
        beraternummer: '12345', mandantennummer: '67890', skrPlan: 'SKR04',
      } as never,
      USER,
      {},
    );
    expect(buchungsZeilen(r.csvBase64).length).toBe(1);
  });

  it('die Metadaten zaehlen die Buchungszeilen (nicht die Paare)', async () => {
    const { service } = buildService([ERLOES, AUFWAND]);
    const r = await service.generateBuchungsstapel(
      {
        guvId: GUV_ID, mandantId: MANDANT_ID,
        beraternummer: '12345', mandantennummer: '67890', skrPlan: 'SKR04',
      } as never,
      USER,
      {},
    );
    expect(r.metadata.buchungsZeilenCount).toBe(2);
  });
});
