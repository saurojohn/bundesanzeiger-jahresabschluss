import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuditIntegrityService } from './audit-integrity.service';

/**
 * Regressionstest für die Race-Condition in der Audit-Hash-Chain
 * (Befund 2026-10-03).
 *
 * `record()` rief `computeHashForEntry()` fire-and-forget auf. Drei
 * Audit-Einträge innerhalb von 35 ms lesen dann GLEICHZEITIG denselben
 * Vorgänger über `createdAt < current`. Zwei leiten daraus denselben
 * `prevHash` ab, schreiben beide und die Kette verzweigt.
 *
 * Im Betrieb belegt: `GET /api/audit/integrity` meldete `BROKEN` nach
 * zwei Einträgen, und in der DB standen zwei Einträge mit
 * `prevHash = 000…0` (Genesis), obwohl sie nicht die ersten waren.
 *
 * Der Test bildet drei Einträge mit 12 ms Abstand nach und prüft, dass
 * die Kette serialisiert wird.
 */

/** Minimales Prisma-Mock: liefert die Einträge in erzeugter Reihenfolge. */
function makePrismaMock(zeiten: Date[]) {
  const eintraege = zeiten.map((createdAt, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    kanzleiId: null,
    mandantId: null,
    userId: null,
    jahresabschlussId: null,
    action: 'UPDATE',
    entityType: 'Mandant',
    entityId: `e${i}`,
    previousState: null,
    newState: { i },
    ipAddress: null,
    userAgent: 'test',
    geoLocation: null,
    createdAt,
    entryHash: null as string | null,
    prevHash: null as string | null,
  }));

  // `findUnique` liefert den Eintrag mit passender ID.
  const findUnique = vi.fn(({ where }: { where: { id: string } }) => {
    const e = eintraege.find((x) => x.id === where.id);
    return Promise.resolve(e ? { ...e } : null);
  });

  // `findFirst` liefert den Vorgänger mit dem größten createdAt < given.
  // WICHTIG: der echte `update` schreibt den Hash in die DB — hier wird er
  // nur im Mock-Objekt gesetzt, damit der nächste Aufrufer ihn sieht.
  // Bugfix 2026-10-05: Der Schreibpfad sucht den Vorgänger jetzt über
  // ((createdAt, id)) als Totalordnung und zusätzlich gefiltert nach
  // kanzleiId. Der Mock bildet beides ab — sonst prüft der Test einen Code,
  // den es nicht mehr gibt.
  const findFirst = vi.fn(
    ({
      where,
    }: {
      where: {
        kanzleiId?: string | null;
        OR: Array<
          | { createdAt: { lt: Date } }
          | { createdAt: Date; id: { lt: string } }
        >;
      };
    }) => {
      const kanzleiFilter = where.kanzleiId;
      const kandidaten = eintraege.filter((e) =>
        kanzleiFilter == null ? true : e.kanzleiId === kanzleiFilter,
      );
      const istDavor = (x: (typeof eintraege)[number]): boolean =>
        where.OR.some((z) =>
          'createdAt' in z && z.createdAt instanceof Date && 'id' in z
            ? x.createdAt.getTime() === z.createdAt.getTime() && x.id < z.id.lt
            : x.createdAt < (z as { createdAt: { lt: Date } }).createdAt.lt,
        );
      const vorherige = kandidaten
        .filter(istDavor)
        .sort(
          (a, b) =>
            b.createdAt.getTime() - a.createdAt.getTime() ||
            b.id.localeCompare(a.id),
        );
      return Promise.resolve(
        vorherige.length ? { id: vorherige[0].id, entryHash: vorherige[0].entryHash } : null,
      );
    },
  );

  const update = vi.fn(({ where, data }: { where: { id: string }; data: { entryHash: string; prevHash: string } }) => {
    const e = eintraege.find((x) => x.id === where.id)!;
    e.entryHash = data.entryHash;
    e.prevHash = data.prevHash;
    return Promise.resolve({ ...e });
  });

  // findMany fuer `verifyIntegrity()` — sortiert nach derselben Totalordnung
  // ((createdAt, id)) wie der Schreibpfad.
  const findMany = vi.fn(
    ({
      where,
      orderBy,
    }: {
      where: Record<string, unknown>;
      orderBy?: Array<{ createdAt?: 'asc' | 'desc'; id?: 'asc' | 'desc' }>;
    }) => {
      let treffer = eintraege.filter(
        (e) => !where.kanzleiId || e.kanzleiId === where.kanzleiId,
      );
      const ob = orderBy?.[0] ?? { createdAt: 'asc' as const };
      treffer = [...treffer].sort((a, b) => {
        const c = a.createdAt.getTime() - b.createdAt.getTime();
        const primary = ob.createdAt === 'desc' ? -c : c;
        if (primary !== 0) return primary;
        return ob.id === 'desc' ? b.id.localeCompare(a.id) : a.id.localeCompare(b.id);
      });
      return Promise.resolve(treffer.map((e) => ({ ...e })));
    },
  );

  return {
    mock: { auditLog: { findUnique, findFirst, findMany, update } } as never,
    eintraege,
  };
}

describe('AuditIntegrityService — Race-Condition', () => {
  let service: AuditIntegrityService;
  let eintraege: Array<{ id: string; entryHash: string | null; prevHash: string | null }>;

  beforeEach(() => {
    // Drei Einträge im Abstand von 12 ms — wie im realen Betrieb.
    const basis = new Date('2026-10-03T10:00:00.000Z');
    const zeiten = [0, 12, 24].map((ms) => new Date(basis.getTime() + ms));
    const { mock, eintraege: e } = makePrismaMock(zeiten);
    service = new AuditIntegrityService(mock);
    eintraege = e as never;
  });

  it('verkettet die prevHash über drei schnelle Einträge', async () => {
    // Ohne Serialisierung laufen alle drei Berechnungen gleichzeitig; die
    // beiden späteren sehen den Vorgänger ohne Hash und fallen auf Genesis
    // zurück. Mit Serialisierung hängt jeder an den tatsächlichen Vorgänger.
    for (let i = 0; i < 3; i += 1) {
      service.enqueue(eintraege[i]!.id);
    }
    await service.drain();

    const genesis = '0'.repeat(64);
    expect(eintraege[0]!.prevHash).toBe(genesis);
    expect(eintraege[1]!.prevHash).toBe(eintraege[0]!.entryHash);
    expect(eintraege[2]!.prevHash).toBe(eintraege[1]!.entryHash);

    // Und alle drei haben einen Hash.
    for (const e of eintraege) {
      expect(e.entryHash, `${e.id} ohne entryHash`).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it('bricht die Kette nicht ab, wenn eine Berechnung fehlschlägt', async () => {
    const vorher = service['prisma' as never] as unknown as {
      auditLog: { findFirst: { mockImplementationOnce?: unknown } };
    };
    // Ein Aufruf schlägt fehl — die weiteren müssen trotzdem laufen.
    service.enqueue(eintraege[0]!.id);
    (service as unknown as { chain: Promise<unknown> }).chain = Promise.reject(
      new Error('absichtlich'),
    );
    service.enqueue(eintraege[1]!.id);
    await expect(service.drain()).resolves.toBeUndefined();
    void vorher;
  });
});
