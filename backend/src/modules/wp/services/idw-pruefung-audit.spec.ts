import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { IdwPruefungService } from './idw-pruefung.service';

/**
 * BEFUND 2026-10-24 (Nachtrag 94): Die IDW-Regelpruefung **schreibt**
 * die Pruefungsergebnisse (`upsertPruefungsResult`), protokolliert den
 * Lauf aber als `action: 'READ'` — und ohne `previousState`.
 *
 * GEMESSEN an der laufenden API:
 *
 *     BilanzPruefungsResult-Zeilen VOR dem Lauf : 5
 *     Lauf: HTTP 201
 *     BilanzPruefungsResult-Zeilen NACH dem Lauf: 5
 *     Audit: action = READ, previousState = null
 *
 * Im Audit-Trail stand damit eine Mutation, die als Lesezugriff auftrat
 * (§ 147 AO: "wer hat was wann geaendert") — und der Zustand vor der
 * Pruefung war nirgends dokumentiert.
 */
const MANDANT = '11111111-1111-4111-8111-111111111111';
const BILANZ = '22222222-2222-4222-8222-222222222222';

function svc(vorherigeErgebnisse: unknown[]) {
  const wpRepository = {
    findBilanzMandantId: vi.fn().mockResolvedValue(MANDANT),
    findGuVMandantId: vi.fn().mockResolvedValue(null),
    findBilanz: vi.fn().mockResolvedValue({
      id: BILANZ,
      mandantId: MANDANT,
      geschaeftsjahr: 2025,
      positionen: [
        { seite: 'AKTIVA', kontonummer: 'B.IV.', betragAktuell: 1000 },
        { seite: 'PASSIVA', kontonummer: 'A.I.', betragAktuell: 1000 },
      ],
    }),
    findMandantArchiviert: vi.fn().mockResolvedValue({ archiviertAt: null }),
    findPruefungsResultsByBilanz: vi.fn().mockResolvedValue(vorherigeErgebnisse),
    upsertPruefungsResult: vi.fn().mockImplementation(
      (input: { regelCode: string }) =>
        Promise.resolve({
          id: `r-${input.regelCode}`,
          bilanzId: BILANZ,
          guvId: null,
          regelCode: input.regelCode,
          status: 'PASSED',
          berechneterWert: new Prisma.Decimal(1),
          schwellwert: new Prisma.Decimal(0),
          meldung: 'geprueft',
          geprueftAm: new Date('2026-10-24T00:00:00Z'),
        }),
    ),
  };
  const auditService = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new IdwPruefungService(
    wpRepository as never,
    auditService as never,
  );
  const user = {
    id: 'u1',
    email: 'wp@kanzlei.de',
    globalRole: 'STEUERBERATER',
    mandanten: [{ id: MANDANT, firmenname: 'Demo GmbH', rolle: 'STEUERBERATER' }],
  } as never;
  return { service, wpRepository, auditService, user };
}

describe('WP: der Audit-Eintrag der IDW-Pruefung (Nachtrag 94)', () => {
  it('protokolliert die Mutation als UPDATE, nicht als READ (BUG vor dem Fix)', async () => {
    const { service, auditService, user } = svc([
      {
        id: 'alt-1',
        regelCode: 'IDW_LIQUIDITAET_1',
        status: 'WARNUNG',
        berechneterWert: new Prisma.Decimal(5),
        schwellwert: new Prisma.Decimal(0),
        meldung: 'alter Stand',
      },
    ]);
    await service.runPruefung(
      { bilanzId: BILANZ },
      user,
      { ip: null, userAgent: null },
    );
    const eintrag = auditService.record.mock.calls[0][0];
    expect(eintrag.action, 'ein Schreibvorgang ist kein READ').toBe('UPDATE');
  });

  it('protokolliert den ersten Lauf als CREATE', async () => {
    const { service, auditService, user } = svc([]);
    await service.runPruefung(
      { bilanzId: BILANZ },
      user,
      { ip: null, userAgent: null },
    );
    const eintrag = auditService.record.mock.calls[0][0];
    expect(eintrag.action).toBe('CREATE');
    expect(eintrag.previousState).toBeNull();
  });

  it('dokumentiert den Zustand VOR der Pruefung (previousState)', async () => {
    const { service, auditService, user } = svc([
      {
        id: 'alt-1',
        regelCode: 'IDW_LIQUIDITAET_1',
        status: 'WARNUNG',
        berechneterWert: new Prisma.Decimal(5),
        schwellwert: new Prisma.Decimal(0),
        meldung: 'alter Stand',
      },
    ]);
    await service.runPruefung(
      { bilanzId: BILANZ },
      user,
      { ip: null, userAgent: null },
    );
    const eintrag = auditService.record.mock.calls[0][0];
    expect(eintrag.previousState, 'der Zustand vor der Pruefung fehlt').not.toBeNull();
    const vorher = eintrag.previousState as {
      anzahlRegeln: number;
      ergebnisse: Array<{ regelCode: string; status: string; berechneterWert: number }>;
    };
    expect(vorher.anzahlRegeln).toBe(1);
    expect(vorher.ergebnisse[0].regelCode).toBe('IDW_LIQUIDITAET_1');
    expect(vorher.ergebnisse[0].status).toBe('WARNUNG');
    expect(vorher.ergebnisse[0].berechneterWert).toBe(5);
  });

  it('nennt im newState die einzelnen Ergebnisse (Wert je Regel)', async () => {
    const { service, auditService, user } = svc([]);
    await service.runPruefung(
      { bilanzId: BILANZ },
      user,
      { ip: null, userAgent: null },
    );
    const eintrag = auditService.record.mock.calls[0][0];
    const neu = eintrag.newState as {
      anzahlRegeln: number;
      ergebnisse: Array<{ regelCode: string; berechneterWert: number }>;
    };
    expect(neu.anzahlRegeln).toBeGreaterThan(0);
    expect(neu.ergebnisse.length).toBe(neu.anzahlRegeln);
    expect(typeof neu.ergebnisse[0].berechneterWert).toBe('number');
  });
});
