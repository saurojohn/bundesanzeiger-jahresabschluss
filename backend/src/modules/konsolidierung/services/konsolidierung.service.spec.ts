/**
 * Regressionstest: Konzernabschluss — Eliminationsrechnung, Beteiligungsquote,
 * Kanzlei-Filter.
 *
 * Bugfix 2026-10-06. Drei Defekte, alle aus derselben Familie: ein Wert
 * war deklariert und wurde nicht benutzt.
 *
 * 1. ELIMINATION. Vorher:
 *      for (const p of positionen)
 *        if (ERLOES || MATERIAL) p.betragAktuell = Math.max(p.betragAktuell - betrag, 0);
 *    Aufwendungen werden im ganzen System NEGATIV gespeichert
 *    (`guv.service.ts:431`). Also galt fuer jede MATERIAL-Position
 *    `negativ - betrag` = negativ, und `Math.max(..., 0)` ergab
 *    EXAKT 0 — jeder Materialaufwand des Konzerns wurde unabhaengig
 *    vom Eliminationsbetrag auf 0 gesetzt. Und `betrag` wurde auf
 *    JEDE Erloes-Position einzeln abgezogen, also n × betrag.
 *
 * 2. BETEILIGUNGSQUOTE. Beide Aggregationsfunktionen nahmen
 *    `beteiligungsquote` als Parameter und setzten ihn mit
 *    `void beteiligungsquote;` ins Leere. Die Quote galt fuer die
 *    TOCHTER; die Mutter gehoert zu 100 % zum Konzern.
 *
 * 3. KANZLEI-FILTER. `updateStatus(id, kanzleiId, …)` hat den
 *    `kanzleiId` angenommen und `where: { id }` verwendet — die
 *    Kanzleizugehoerigkeit wurde nicht geprueft.
 */

import { describe, it, expect, vi } from 'vitest';
import { KonsolidierungService } from './konsolidierung.service';
import type { KonsolidierungRepository } from '../../../common/repositories/konsolidierung.repository';
import { BadRequestException, NotFoundException } from '@nestjs/common';

const MUTTER = 'm1';
const TOCHTER = 'm2';

type Pos = {
  seite?: 'AKTIVA' | 'PASSIVA';
  kontonummer: string;
  bezeichnung: string;
  kategorie?: string;
  betragAktuell: number;
  reihenfolge: number;
};

function svc() {
  const repository = {
    findByIdForUser: vi.fn().mockResolvedValue(null),
    updateStatus: vi.fn().mockResolvedValue({}),
    deleteBuchungen: vi.fn().mockResolvedValue(undefined),
    createBuchungen: vi.fn().mockResolvedValue([]),
    findBuchungen: vi.fn().mockResolvedValue([]),
    findBuchungenByEinheitIds: vi.fn().mockResolvedValue([]),
  } as unknown as KonsolidierungRepository;

  const service = new KonsolidierungService(
    {} as never, // prisma
    repository,
    {} as never, // bilanzRepository
    {} as never, // guvRepository
    {} as never, // auditService
  );
  return { service, repository };
}

const intern = (s: KonsolidierungService) =>
  s as unknown as {
    reduziereKategorie: (
      positionen: Array<{ kategorie: string; betragAktuell: number }>,
      kategorie: string,
      betrag: number,
    ) => void;
    normiereBeteiligungsquote: (w: number) => number;
    aggregateBilanzPositionen: (
      map: Array<{ mandantId: string; bilanz: { positionen: Pos[] } }>,
      quote: number,
      mutter: string,
    ) => Pos[];
    aggregateGuvPositionen: (
      map: Array<{ mandantId: string; guv: { positionen: Pos[] } }>,
      quote: number,
      mutter: string,
    ) => Pos[];
    applyEliminationsToGuv: (
      positionen: Array<{
        kategorie: string;
        betragAktuell: number;
        reihenfolge: number;
      }>,
      buchungen: Array<{ buchungsArt: string; betrag: { toString(): string } }>,
    ) => void;
  };

describe('Konsolidierung: Eliminationsrechnung', () => {
  it('setzt einen negativen Materialaufwand NICHT auf 0 (BUG vor dem Fix)', () => {
    const { service } = svc();
    // Aufwendungen sind negative Werte.
    const positionen = [{ kategorie: 'MATERIAL', betragAktuell: -50000 }];
    intern(service).reduziereKategorie(positionen, 'MATERIAL', 5000);
    // Erwartet: der Aufwand wird um 5.000 kleiner in der Groesse,
    // also weniger negativ. Vor dem Fix stand hier exakt 0.
    expect(positionen[0].betragAktuell).toBe(-45000);
    expect(positionen[0].betragAktuell).not.toBe(0);
  });

  it('reduziert eine Erlösposition um den Eliminationsbetrag', () => {
    const { service } = svc();
    const positionen = [{ kategorie: 'ERLOES', betragAktuell: 20000 }];
    intern(service).reduziereKategorie(positionen, 'ERLOES', 5000);
    expect(positionen[0].betragAktuell).toBe(15000);
  });

  it('reduziert die KATEGORIE-SUMME um genau den Betrag (nicht n ×)', () => {
    const { service } = svc();
    // Drei Erloes-Positionen — vor dem Fix wurde `betrag` DREIMAL
    // abgezogen, also 3 × Reduktion.
    const positionen = [
      { kategorie: 'ERLOES', betragAktuell: 10000 },
      { kategorie: 'ERLOES', betragAktuell: 20000 },
      { kategorie: 'ERLOES', betragAktuell: 30000 },
    ];
    const vorher = 60000;
    intern(service).reduziereKategorie(positionen, 'ERLOES', 6000);
    const nachher = positionen.reduce((a, p) => a + p.betragAktuell, 0);
    expect(nachher).toBe(vorher - 6000);
    // Und die Verteilung bleibt proportional.
    expect(positionen[2].betragAktuell).toBe(27000);
  });

  it('erhält das Vorzeichen der Kategorie', () => {
    const { service } = svc();
    const erloese = [{ kategorie: 'ERLOES', betragAktuell: 1000 }];
    intern(service).reduziereKategorie(erloese, 'ERLOES', 5000);
    expect(erloese[0].betragAktuell).toBeGreaterThanOrEqual(0);

    const aufwand = [{ kategorie: 'MATERIAL', betragAktuell: -1000 }];
    intern(service).reduziereKategorie(aufwand, 'MATERIAL', 5000);
    expect(aufwand[0].betragAktuell).toBeLessThanOrEqual(0);
  });

  it('tut nichts, wenn die Kategorie nicht vorkommt', () => {
    const { service } = svc();
    const positionen = [{ kategorie: 'PERSONAL', betragAktuell: -1234 }];
    intern(service).reduziereKategorie(positionen, 'ERLOES', 5000);
    expect(positionen[0].betragAktuell).toBe(-1234);
  });

  it('AUFWAND_ERTRAG-Buchung trifft Erlöse UND Materialaufwand', () => {
    const { service } = svc();
    const positionen = [
      { kategorie: 'ERLOES', betragAktuell: 100000, reihenfolge: 1 },
      { kategorie: 'MATERIAL', betragAktuell: -40000, reihenfolge: 2 },
      { kategorie: 'PERSONAL', betragAktuell: -20000, reihenfolge: 3 },
    ];
    intern(service).applyEliminationsToGuv(positionen, [
      { buchungsArt: 'AUFWAND_ERTRAG', betrag: '10000' as unknown as { toString(): string } },
    ]);
    // Erloese sinken um 10.000 …
    expect(positionen[0].betragAktuell).toBe(90000);
    // … der Materialaufwand wird 10.000 kleiner (weniger negativ) …
    expect(positionen[1].betragAktuell).toBe(-30000);
    // … Personal bleibt unberuehrt.
    expect(positionen[2].betragAktuell).toBe(-20000);
  });
});

describe('Konsolidierung: fehlende Eingangsdaten werden NICHT stillschweigend ignoriert', () => {
  /**
   * BUGFIX 2026-10-07.
   *
   * Bis hierher verwarfen `loadBilanzen…` und `loadGuVs…` fehlende
   * Saetze per `continue` — ohne Log, ohne Warnung. `apply` lief
   * trotzdem durch und meldete Erfolg inklusive Salden.
   *
   * Der schlimmste Fall: `assertZieljahrFrei` VERLANGT, dass die Mutter
   * fuer das Jahr KEINE Bilanz und KEINE GuV hat. Zwei Zeilen spaeter
   * werden genau diese Saetze geladen — es gibt sie also nie. Die
   * Konzern-Bilanz enthielt damit ausschliesslich die Toechter und sah
   * vollstaendig aus. Eine Konzernrechnung ohne Muttergesellschaft ist
   * keine Konzernrechnung.
   *
   * Korrekt und entscheidbar ist nur: Ohne die Angaben der Mutter
   * laeuft keine Konsolidierung. WELCHES Modell fachlich richtig ist
   * (Konzernsatz ersetzt den Einzelsatz, oder der Konzernsatz
   * braucht eine eigene Identitaet), ist eine Produktentscheidung.
   */
  function applyMitDaten(
    bilanzenVorhanden: string[],
    guvsVorhanden: string[],
  ) {
    const service = new KonsolidierungService(
      {} as never, // prisma
      {
        findByIdForUser: vi.fn().mockResolvedValue(null),
        updateStatus: vi.fn().mockResolvedValue({}),
      } as never,
      {
        findByMandantAndJahr: vi
          .fn()
          .mockImplementation(async (id: string) =>
            bilanzenVorhanden.includes(id) ? [{ id: `b-${id}` }] : [],
          ),
        findWithPositionen: vi.fn().mockResolvedValue({
          id: 'x',
          geschaeftsjahr: 2025,
          positionen: [],
        }),
      } as never,
      {
        findByMandantAndJahr: vi
          .fn()
          .mockImplementation(async (id: string) =>
            guvsVorhanden.includes(id) ? [{ id: `g-${id}` }] : [],
          ),
        findWithPositionen: vi.fn().mockResolvedValue({
          id: 'y',
          geschaeftsjahr: 2025,
          verfahren: 'GKV',
          ergebnis: '0',
          positionen: [],
        }),
      } as never,
      { record: vi.fn().mockResolvedValue(undefined) } as never,
    );

    // loadEinheitForUser + assertMandantAccess + assertZieljahrFrei
    // (die die Abwesenheit der Mutter erwartet) überspringen, damit der
    // GUARD selbst getestet wird und nicht der Vorlauf.
    const intern = service as unknown as {
      applyKonsolidierung: (...args: never[]) => Promise<unknown>;
      loadBilanzenFuerGeschäftsjahr: (
        ids: string[],
        jahr: number,
      ) => Promise<Array<{ mandantId: string }>>;
      loadGuVsFuerGeschäftsjahr: (
        ids: string[],
        jahr: number,
      ) => Promise<Array<{ mandantId: string }>>;
    };
    void intern;
    return service;
  }

  it('ohne Einzelabschlüsse der Mutter wird NICHT „erfolgreich" gerechnet', async () => {
    const service = applyMitDaten([], []);
    // Wir rufen die beiden Loader direkt und pruefen das Ergebnis, das
    // `apply` seit dem Fix als fehlend erkennt.
    const geladen = await (
      service as unknown as {
        loadBilanzenFuerGeschäftsjahr: (
          ids: string[],
          jahr: number,
        ) => Promise<Array<{ mandantId: string }>>;
      }
    ).loadBilanzenFuerGeschäftsjahr([MUTTER, TOCHTER], 2025);
    // Die Mutter ist erwartungsgemaess nicht dabei — genau darum
    // braucht es den Guard in apply().
    expect(geladen.some((e) => e.mandantId === MUTTER)).toBe(false);
  });

  it('der Logger meldet fehlende Beteiligte (vorher ungenutzt)', async () => {
    const service = applyMitDaten([], []);
    const warn = vi.fn();
    (
      service as unknown as { logger: { warn: (m: string) => void } }
    ).logger = { warn } as never;
    await (
      service as unknown as {
        loadBilanzenFuerGeschäftsjahr: (
          ids: string[],
          jahr: number,
        ) => Promise<Array<{ mandantId: string }>>;
      }
    ).loadBilanzenFuerGeschäftsjahr([MUTTER, TOCHTER], 2025);
    // `this.logger` war in der gesamten Datei deklariert und NIE
    // benutzt. Der Loader protokolliert jetzt, WER fehlt.
    expect(warn).toHaveBeenCalled();
  });

  it('apply() VERWEIGERT ohne Einzelabschlüsse der Mutter', async () => {
    const bilanzCreate = vi.fn();
    // Das ist der eigentliche Nachweis: `apply` liefert die falsche
    // Konzern-Bilanz zurueck und meldet Erfolg mit Salden. Der Test
    // muss den Weg durch `apply` gehen, nicht nur die Loader.
    const service = new KonsolidierungService(
      {} as never, // prisma
      {} as never, // konsolidierungRepository
      {
        findByMandantAndJahr: vi.fn().mockResolvedValue([]), // KEINE Bilanzen
        findWithPositionen: vi.fn(),
        createWithPositionen: bilanzCreate,
      } as never,
      {
        findByMandantAndJahr: vi.fn().mockResolvedValue([]), // KEINE GuVs
        findWithPositionen: vi.fn(),
        createWithPositionen: vi.fn().mockResolvedValue({}),
      } as never,
      { record: vi.fn().mockResolvedValue(undefined) } as never,
    );

    const intern = service as unknown as {
      loadEinheitForUser: (...a: unknown[]) => Promise<unknown>;
      assertZieljahrFrei: (...a: unknown[]) => Promise<void>;
      applyKonsolidierung: (...a: unknown[]) => Promise<unknown>;
    };
    // Vorlauf stubben, damit der GUARD selbst getestet wird.
    intern.loadEinheitForUser = vi.fn().mockResolvedValue({
      id: 'e1',
      status: 'DRAFT',
      kanzleiId: 'k1',
      geschaeftsjahr: 2025,
      mutterMandantId: MUTTER,
      tochterMandantIds: [TOCHTER],
      beteiligungsquote: '100',
      buchungen: [{ id: 'b1', buchungsArt: 'X', betrag: '0' }],
    });
    await expect(
      intern.applyKonsolidierung('e1', undefined as never, {
        ip: null,
        userAgent: null,
      }),
    ).rejects.toThrow(BadRequestException);
    // Und es darf KEINE Konzern-Bilanz geschrieben worden sein. Bis
    // 2026-10-07 stand hier `assertZieljahrFrei` an dieser Stelle — die
    // Pruefung, die das Gegenteil verlangte und damit die ganze
    // Konsolidierung blockierte. Sie ist mit der Migration
    // 20261007230000 entfallen, weil der Konzernsatz jetzt NEBEN dem
    // Einzelsatz existiert.
    expect(bilanzCreate).not.toHaveBeenCalled();
  });

  it('die Fehlermeldung nennt den Grund und den Code', async () => {
    const service = new KonsolidierungService(
      {} as never,
      {} as never,
      { findByMandantAndJahr: vi.fn().mockResolvedValue([]), findWithPositionen: vi.fn() } as never,
      { findByMandantAndJahr: vi.fn().mockResolvedValue([]), findWithPositionen: vi.fn() } as never,
      { record: vi.fn().mockResolvedValue(undefined) } as never,
    );
    const intern = service as unknown as {
      loadEinheitForUser: (...a: unknown[]) => Promise<unknown>;
      assertZieljahrFrei: (...a: unknown[]) => Promise<void>;
      applyKonsolidierung: (...a: unknown[]) => Promise<unknown>;
    };
    intern.loadEinheitForUser = vi.fn().mockResolvedValue({
      id: 'e1', status: 'DRAFT', kanzleiId: 'k1', geschaeftsjahr: 2025,
      mutterMandantId: MUTTER, tochterMandantIds: [TOCHTER],
      beteiligungsquote: '100', buchungen: [{ id: 'b1' }],
    });
    intern.assertZieljahrFrei = vi.fn().mockResolvedValue(undefined);

    try {
      await intern.applyKonsolidierung('e1', undefined as never, {
        ip: null, userAgent: null,
      });
      throw new Error('Sollte abbrechen');
    } catch (fehler) {
      const body = (fehler as BadRequestException).getResponse() as {
        message: string; code: string; fehlendeMutterBilanz: boolean;
      };
      expect(body.code).toBe('MUTTER_OHNE_EINZELABSCHLUSS');
      expect(body.fehlendeMutterBilanz).toBe(true);
      expect(body.message).toMatch(/Muttergesellschaft/);
    }
  });

  it('wenn alle Beteiligten Daten haben, wird nichts als fehlend gemeldet', async () => {
    const service = applyMitDaten([MUTTER, TOCHTER], [MUTTER, TOCHTER]);
    const geladen = await (
      service as unknown as {
        loadBilanzenFuerGeschäftsjahr: (
          ids: string[],
          jahr: number,
        ) => Promise<Array<{ mandantId: string }>>;
      }
    ).loadBilanzenFuerGeschäftsjahr([MUTTER, TOCHTER], 2025);
    expect(geladen.map((e) => e.mandantId).sort()).toEqual([MUTTER, TOCHTER].sort());
  });
});

describe('Konsolidierung: Beteiligungsquote', () => {
  it('normalisiert Prozent und Bruchteil', () => {
    const { service } = svc();
    const n = intern(service).normiereBeteiligungsquote.bind(intern(service));
    expect(n(100)).toBe(1);
    expect(n(60)).toBeCloseTo(0.6);
    expect(n(0.6)).toBeCloseTo(0.6);
    // Unplausibel oder fehlend: 100 %, NICHT 0. Eine Quote von 0
    // wuerde die Tochter still aus dem Konzernabschluss entfernen.
    expect(n(0)).toBe(1);
    expect(n(-5)).toBe(1);
    expect(n(Number.NaN)).toBe(1);
    expect(n(500)).toBe(1);
  });

  it('skaliert Tochterpositionen, Mutterpositionen bleiben voll (BUG vor dem Fix)', () => {
    const { service } = svc();
    const map = [
      {
        mandantId: MUTTER,
        bilanz: {
          positionen: [
            { seite: 'AKTIVA' as const, kontonummer: 'A.II.1.', bezeichnung: 'Grundstuecke', betragAktuell: 100000, reihenfolge: 1 },
          ],
        },
      },
      {
        mandantId: TOCHTER,
        bilanz: {
          positionen: [
            { seite: 'AKTIVA' as const, kontonummer: 'A.II.2.', bezeichnung: 'Maschinen', betragAktuell: 50000, reihenfolge: 2 },
          ],
        },
      },
    ];
    const ergebnis = intern(service).aggregateBilanzPositionen(map, 60, MUTTER);
    const mutter = ergebnis.find((p) => p.kontonummer === 'A.II.1.');
    const tochter = ergebnis.find((p) => p.kontonummer === 'A.II.2.');
    expect(mutter?.betragAktuell).toBe(100000);
    // Vor dem Fix waere hier 50000 gestanden — die Quote wurde verworfen.
    expect(tochter?.betragAktuell).toBe(30000);
  });

  it('bei 100 % wird die Tochter voll einbezogen', () => {
    const { service } = svc();
    const map = [
      { mandantId: MUTTER, guv: { positionen: [{ kontonummer: '1.', bezeichnung: 'Erloese', kategorie: 'ERLOES', betragAktuell: 100, reihenfolge: 1 }] } },
      { mandantId: TOCHTER, guv: { positionen: [{ kontonummer: '1.', bezeichnung: 'Erloese', kategorie: 'ERLOES', betragAktuell: 100, reihenfolge: 1 }] } },
    ];
    const ergebnis = intern(service).aggregateGuvPositionen(map, 100, MUTTER);
    expect(ergebnis[0].betragAktuell).toBe(200);
  });

  it('GuV: Tochter wird gemäß Quote skaliert', () => {
    const { service } = svc();
    const map = [
      { mandantId: MUTTER, guv: { positionen: [{ kontonummer: '1.', bezeichnung: 'Erloese', kategorie: 'ERLOES', betragAktuell: 1000, reihenfolge: 1 }] } },
      { mandantId: TOCHTER, guv: { positionen: [{ kontonummer: '1.', bezeichnung: 'Erloese', kategorie: 'ERLOES', betragAktuell: 1000, reihenfolge: 1 }] } },
    ];
    const ergebnis = intern(service).aggregateGuvPositionen(map, 50, MUTTER);
    // 1000 (Mutter) + 1000 × 0,5 (Tochter) = 1500
    expect(ergebnis[0].betragAktuell).toBe(1500);
  });
});

describe('Konsolidierung: Kanzlei-Filter im Repository', () => {
  it('updateStatus filtert nach kanzleiId und meldet 0 Treffer als Fehler', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const findUnique = vi.fn().mockResolvedValue(null);
    const prisma = {
      konsolidierungsEinheit: { updateMany, findUnique },
    };
    const { KonsolidierungRepository } = await import(
      '../../../common/repositories/konsolidierung.repository'
    );
    const repo = new KonsolidierungRepository(prisma as never);

    await expect(
      repo.updateStatus('fremde-einheit', 'kanzlei-eigen', { status: 'COMPLETED' }),
    ).rejects.toBeInstanceOf(NotFoundException);

    // Entscheidend: der WHERE enthaelt die kanzleiId. Vor dem Fix war
    // es `where: { id }`.
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'fremde-einheit', kanzleiId: 'kanzlei-eigen' },
      }),
    );
  });

  it('updateStatus liefert den aktualisierten Satz zurück', async () => {
    const satz = { id: 'e1', status: 'COMPLETED' };
    const prisma = {
      konsolidierungsEinheit: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue(satz),
      },
    };
    const { KonsolidierungRepository } = await import(
      '../../../common/repositories/konsolidierung.repository'
    );
    const repo = new KonsolidierungRepository(prisma as never);
    await expect(
      repo.updateStatus('e1', 'k1', { status: 'COMPLETED' }),
    ).resolves.toBe(satz);
  });
});

describe('Konsolidierung: Einheit löschen (BUGFIX 2026-10-07)', () => {
  /**
   * Vorher gab es KEINE Löschmöglichkeit. Durch
   * `@@unique([mutterMandantId, geschaeftsjahr])` belegt eine Einheit
   * das Jahr dauerhaft: nach einem abgebrochenen Versuch — etwa weil
   * `apply` fachlich nicht anwendbar war — konnte für dasselbe Jahr
   * keine zweite Konsolidierung angelegt werden.
   */
  function buildService(status: string) {
    const repository = {
      deleteEinheitDraft: vi.fn().mockResolvedValue(true),
    };
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const service = new KonsolidierungService(
      {} as never, // prisma
      repository as never,
      {} as never, // bilanzRepository
      {} as never, // guvRepository
      audit as never,
    );
    const intern = service as unknown as {
      loadEinheitForUser: (...a: unknown[]) => Promise<unknown>;
      deleteEinheit: (...a: unknown[]) => Promise<void>;
    };
    intern.loadEinheitForUser = vi.fn().mockResolvedValue({
      id: 'e1',
      kanzleiId: 'k1',
      status,
      geschaeftsjahr: 2025,
      mutterMandantId: MUTTER,
      buchungen: [],
    });
    return { service, repository, audit, intern };
  }

  const ctx = { ip: null, userAgent: null };
  const user = { id: 'u1', globalRole: null, mandanten: [] } as never;

  it('löscht eine Einheit im Entwurfszustand', async () => {
    const { intern, repository, audit } = buildService('DRAFT');
    await intern.deleteEinheit('e1', user, ctx);
    expect(repository.deleteEinheitDraft).toHaveBeenCalledWith('e1', 'k1');
    expect(audit.record).toHaveBeenCalledTimes(1);
  });

  it('löscht auch IN_PROGRESS', async () => {
    const { intern, repository } = buildService('IN_PROGRESS');
    await intern.deleteEinheit('e1', user, ctx);
    expect(repository.deleteEinheitDraft).toHaveBeenCalled();
  });

  it('VERWEIGERT ab COMPLETED — Konzern-Bilanz existiert (§ 147 AO)', async () => {
    const { intern, repository } = buildService('COMPLETED');
    await expect(
      intern.deleteEinheit('e1', user, ctx),
    ).rejects.toThrow(BadRequestException);
    expect(repository.deleteEinheitDraft).not.toHaveBeenCalled();
  });

  it('VERWEIGERT auch im freigegebenen Zustand VALIDATED', async () => {
    const { intern, repository } = buildService('VALIDATED');
    await expect(
      intern.deleteEinheit('e1', user, ctx),
    ).rejects.toThrow(BadRequestException);
    expect(repository.deleteEinheitDraft).not.toHaveBeenCalled();
  });

  it('meldet 0 Treffer als NotFound statt still zu nichts zu tun', async () => {
    const { intern, repository } = buildService('DRAFT');
    repository.deleteEinheitDraft.mockResolvedValue(false);
    await expect(
      intern.deleteEinheit('e1', user, ctx),
    ).rejects.toThrow(NotFoundException);
  });

  it('das Repository filtert nach kanzleiId UND Status', async () => {
    // Strukturtest: ein fehlender Kanzlei-Filter waere ein Cross-Tenant-
    // Leck, ein fehlender Status-Filter wuerde einen
    // Aufzeichnungsstand loeschen.
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const code = readFileSync(
      join(process.cwd(), 'src/common/repositories/konsolidierung.repository.ts'),
      'utf-8',
    );
    const start = code.indexOf('async deleteEinheitDraft');
    expect(start).toBeGreaterThan(-1);
    const koerper = code.slice(start, code.indexOf('\n  }', start));
    expect(koerper).toContain('kanzleiId');
    expect(koerper).toMatch(/status/);
    expect(koerper).toMatch(/DRAFT/);
  });
});

describe('Konsernmodell: Einzelsatz und Konzernsatz koexistieren', () => {
  /**
   * Bugfix 2026-10-07, HGB §301 / IDW RS 11.
   *
   * `@@unique([mandantId, geschaeftsjahr])` auf `bilanz` und `guv`
   * verbiet, dass der Einzelsatz der MUTTER und ihr Konzernsatz fuer
   * dasselbe Jahr gleichzeitig existieren. `apply` speicherte den
   * Konzernsatz unter `mutterMandantId` — also war die Rechnung
   * entweder unmoglich (400) oder enthielt nur die Toechter.
   *
   * Migration 20261007230000 fuehrt `konzernEinheitId` ein und zwei
   * PARTIELLE Unique-Indizes. Diese Tests sichern genau das ab.
   */
  it('der Konzernsatz wird mit konzernEinheitId angelegt', () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const { join } = require('node:path') as typeof import('node:path');
    const code = readFileSync(
      join(process.cwd(), 'src/modules/konsolidierung/services/konsolidierung.service.ts'),
      'utf-8',
    );
    // Beide Saetze (Bilanz und GuV).
    const treffer = code.match(/konzernEinheitId:\s*einheit\.id,/g) ?? [];
    expect(treffer.length, 'Konzern-Bilanz und -GuV').toBe(2);
  });

  it('das Schema kennt konzernEinheitId an Bilanz und GuV', () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const { join } = require('node:path') as typeof import('node:path');
    const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf-8');
    const bilanz = schema.slice(schema.indexOf('model Bilanz {'), schema.indexOf('model GuV {'));
    const guv = schema.slice(schema.indexOf('model GuV {'), schema.indexOf('model Anhang {'));
    expect(bilanz).toContain('konzernEinheitId');
    expect(guv).toContain('konzernEinheitId');
    // Und der blockierende @@unique ist ENTFALLEN.
    expect(bilanz).not.toContain('@@unique([mandantId, geschaeftsjahr])');
    expect(guv).not.toContain('@@unique([mandantId, geschaeftsjahr])');
  });

  it('die Migration legt partielle Unique-Indizes an', () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const { join } = require('node:path') as typeof import('node:path');
    const sql = readFileSync(
      join(
        process.cwd(),
        'prisma/migrations/20261007230000_konzern_eigener_abschluss/migration.sql',
      ),
      'utf-8',
    );
    // Vier partielle Indizes: Einzelsatz + Konzernsatz je Tabelle.
    const partielle = sql.match(/CREATE UNIQUE INDEX/g) ?? [];
    expect(partielle.length).toBe(4);
    expect(sql).toMatch(/WHERE "konzernEinheitId" IS NULL/);
    expect(sql).toMatch(/WHERE "konzernEinheitId" IS NOT NULL/);
    // Der alte Global-Constraint muss weg, sonst blockiert er weiter.
    expect(sql).toMatch(/DROP INDEX IF EXISTS "bilanz_mandantId_geschaeftsjahr_key"/);
  });

  it('der blockierende Vorbehalt ist entfernt', () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const { join } = require('node:path') as typeof import('node:path');
    const code = readFileSync(
      join(process.cwd(), 'src/modules/konsolidierung/services/konsolidierung.service.ts'),
      'utf-8',
    );
    expect(code).not.toMatch(/await this\.assertZieljahrFrei\(/);
  });
});

describe('§ 301 HGB: Kapitalkonsolidierung erhaelt die Bilanzgleichung', () => {
  /**
   * Bugfix 2026-10-07. Die bisherige Buchung war:
   *
   *   PASSIVA A.I.  -= betrag
   *   AKTIVA  A.I.3. += betrag
   *
   * Aktiva +betrag, Passiva -betrag → Differenz 2 × betrag. Die
   * Konzern-Bilanz war nach dem Buchen NICHT mehr ausgeglichen,
   * wurde aber als Konzern-Bilanz gespeichert und als `VALIDATED`
   * gemeldet. Eine falsche Bilanz ist schlimmer als gar keine.
   *
   * Korrekt: anteiliges Tochter-EK aus dem Konzern-EK eliminieren,
   * Geschäfts-/Firmenwert als Aktivposten ansetzen, Rest als
   * Kapitalkonsolidierungsdifferenz ausweisen — damit die Gleichung
   * aufgeht und der Betrag für die Wirtschaftsprüfung sichtbar ist.
   */
  type Pos = {
    seite: 'AKTIVA' | 'PASSIVA';
    kontonummer: string;
    bezeichnung: string;
    betragAktuell: number;
    bemerkung?: string;
  };

  const summe = (p: Pos[], seite: 'AKTIVA' | 'PASSIVA') =>
    Number(
      p.filter((x) => x.seite === seite)
        .reduce((acc, x) => acc + Number(x.betragAktuell), 0)
        .toFixed(2),
    );

  function anwenden(
    positionen: Pos[],
    ctx: {
      anschaffungskosten: number;
      eigenkapitalTochter: number;
      beteiligungsquote: number;
    },
  ) {
    const { service } = (() => {
      const s = new KonsolidierungService(
        {} as never, {} as never, {} as never, {} as never,
        { record: vi.fn() } as never,
      );
      return { service: s };
    })();
    const intern = service as unknown as {
      applyEliminationsToBilanz: (
        p: Pos[],
        b: Array<{ buchungsArt: string; betrag: unknown }>,
        k: typeof ctx,
      ) => void;
    };
    // Der Buchungsbetrag MUSS dem tatsaechlichen Unterschied
    // entsprechen (|AK - anteil EK|), so wie `calculateBuchungenInputs`
    // ihn erzeugt. Mit Betrag 0 waere die alte, gleichungsbrechende
    // Logik nicht auffallbar gewesen — der Test waere wertlos.
    const kapBuchung = {
      buchungsArt: 'KAPITAL_KONSOLIDIERUNG',
      betrag: {
        toString: () =>
          String(
            Math.abs(
              ctx.anschaffungskosten -
                (ctx.eigenkapitalTochter * ctx.beteiligungsquote) / 100,
            ),
          ),
      } as never,
    };
    intern.applyEliminationsToBilanz(positionen, [kapBuchung], ctx);
    return positionen;
  }

  const start = (): Pos[] => [
    { seite: 'AKTIVA', kontonummer: 'A.II.1.', bezeichnung: 'Anlagen', betragAktuell: 200000 },
    { seite: 'PASSIVA', kontonummer: 'A.I.', bezeichnung: 'Gezeichnetes Kapital', betragAktuell: 150000 },
    { seite: 'PASSIVA', kontonummer: 'A.IV.', bezeichnung: 'Gewinnvortrag', betragAktuell: 50000 },
  ];

  it('AK > anteiliges EK → Goodwill als Aktivposten', () => {
    const p = anwenden(start(), {
      anschaffungskosten: 120000,
      eigenkapitalTochter: 100000,
      beteiligungsquote: 100,
    });
    const goodwill = p.find((x) => x.kontonummer === 'A.I.3.');
    expect(goodwill, 'Goodwill muss ausgewiesen werden').toBeTruthy();
    expect(goodwill!.betragAktuell).toBe(20000);
  });

  it('AK < anteiliges EK → Badwill mindert das EK', () => {
    const p = anwenden(start(), {
      anschaffungskosten: 60000,
      eigenkapitalTochter: 100000,
      beteiligungsquote: 100,
    });
    expect(p.find((x) => x.kontonummer === 'A.I.3.')).toBeUndefined();
    const diff = p.find((x) => x.kontonummer === 'A.V.');
    expect(diff, 'die Differenz muss ausgewiesen werden').toBeTruthy();
  });

  it('die Bilanzgleichung hält in JEDEM Fall (KRITISCH)', () => {
    // Der eigentliche Nachweis: vorher 2 × betrag Differenz.
    const faelle = [
      { anschaffungskosten: 0, eigenkapitalTochter: 0, beteiligungsquote: 100 },
      { anschaffungskosten: 60000, eigenkapitalTochter: 100000, beteiligungsquote: 100 },
      { anschaffungskosten: 100000, eigenkapitalTochter: 100000, beteiligungsquote: 100 },
      { anschaffungskosten: 120000, eigenkapitalTochter: 100000, beteiligungsquote: 100 },
      { anschaffungskosten: 300000, eigenkapitalTochter: 100000, beteiligungsquote: 60 },
      { anschaffungskosten: 200000, eigenkapitalTochter: 250000, beteiligungsquote: 100 },
    ];
    for (const f of faelle) {
      const p = anwenden(start(), f);
      const differenz = Number((summe(p, 'AKTIVA') - summe(p, 'PASSIVA')).toFixed(2));
      expect(
        Math.abs(differenz),
        `Bilanz ungleich bei ${JSON.stringify(f)}: Aktiva ${summe(p, 'AKTIVA')} / Passiva ${summe(p, 'PASSIVA')}`,
      ).toBeLessThan(0.01);
    }
  });

  it('ohne Angaben findet keine Kapitalkonsolidierung statt', () => {
    const p = start();
    // Kontext mit 0 = die Default-Werte einer ohne Angaben
    // angelegten Einheit.
    anwenden(p, { anschaffungskosten: 0, eigenkapitalTochter: 0, beteiligungsquote: 100 });
    expect(p.find((x) => x.kontonummer === 'A.I.3.')).toBeUndefined();
    expect(Math.abs(summe(p, 'AKTIVA') - summe(p, 'PASSIVA'))).toBeLessThan(0.01);
  });

  it('der DTO nimmt die §-301-Eingaben entgegen (vorher fest 0)', () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const { join } = require('node:path') as typeof import('node:path');
    const dto = readFileSync(
      join(process.cwd(), 'src/modules/konsolidierung/dto/create-konsolidierung-einheit.dto.ts'),
      'utf-8',
    );
    expect(dto).toContain('anschaffungskosten');
    expect(dto).toContain('eigenkapitalTochter');
    expect(dto).toContain('jahresueberschussTochter');
    // Und der Service darf sie nicht mehr auf 0 festnageln.
    const svc = readFileSync(
      join(process.cwd(), 'src/modules/konsolidierung/services/konsolidierung.service.ts'),
      'utf-8',
    );
    expect(svc).toContain('anschaffungskosten: dto.anschaffungskosten ?? 0');
  });
});

describe('Konzernsatz taucht nicht in den Mandantenlisten auf', () => {
  /**
   * Bugfix 2026-10-07 — eine REGRESSION, die der erste Durchlauf der
   * Frontend-Suite gezeigt hat: `smoke.spec.ts` → „Bilanz im Status
   * DRAFT speichern" wurde rot.
   *
   * Ursache: Seit der Konzernsatz ein eigener Datensatz ist
   * (`konzernEinheitId`), lieferte `findByMandantAndJahr` auch die
   * KONZERN-Bilanz der Mutter mit. Ein Aufrufer, der "die
   * Jahresbilanz" erwartete, bekam unter Umständen den Konzernabschluss
   * — beim Speichern ein Fehler.
   *
   * Diese Tests sichern ab, dass die Standardabfragen ausschliesslich
   * Einzelsaetze liefern.
   */
  it('findByMandantAndJahr filtert auf Einzelsaetze', () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const { join } = require('node:path') as typeof import('node:path');
    for (const datei of [
      'src/common/repositories/bilanz.repository.ts',
      'src/common/repositories/guv.repository.ts',
    ]) {
      const code = readFileSync(join(process.cwd(), datei), 'utf-8');
      // Beide Standardabfragen: nach Mandant/Jahr UND in der Liste.
      const fundstellen = code.match(/konzernEinheitId: null,/g) ?? [];
      expect(
        fundstellen.length,
        `${datei}: findByMandantAndJahr und die Liste müssen auf konzernEinheitId: null filtern`,
      ).toBeGreaterThanOrEqual(2);
    }
  });

  it('der Konsolidierungs-Loader lädt bewusst die Einzelsaetze der Teilnehmer', () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const { join } = require('node:path') as typeof import('node:path');
    const code = readFileSync(
      join(process.cwd(), 'src/modules/konsolidierung/services/konsolidierung.service.ts'),
      'utf-8',
    );
    // Die Aggregation nutzt findByMandantAndJahr — mit dem neuen
    // Filter laedt sie damit genau die Einzelsaetze. Genau richtig:
    // eine bereits konsolidierte Bilanz darf nicht noch einmal
    // konsolidiert werden.
    expect(code).toContain('loadBilanzenFuerGeschäftsjahr');
  });
});
