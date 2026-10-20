import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuditIntegrityService } from './audit-integrity.service';

/**
 * Die Integritaetspruefung muss **je Kanzlei** pruefen.
 *
 * BEFUND 2026-10-20 (Nachtrag 67): Der Schreibpfad
 * (`computeHashForEntry`) sucht den Vorgaenger **innerhalb derselben
 * Kanzlei**. Die Pruefung (`verifyIntegrity`) verkettete dagegen **global**:
 * der letzte Eintrag der Kanzlei A war der Vorgaenger des ersten Eintrags
 * der Kanzlei B.
 *
 * Beides zusammen ergibt einen **Fehlalarm**: „BROKEN" — also
 * Manipulationsverdacht — fuer eine vollstaendig intakte Kette, sobald
 * eine zweite Kanzlei Audit-Eintraege hat.
 *
 * **Gemessen** (429 Eintraege auf 7 Kanzleien): die globale Kette bricht bei
 * seq=344, die Kette je Kanzlei bricht **nirgends**.
 *
 * Der Test baut beide Kanzleien ueber den **Produktivpfad**
 * (`computeHashForEntry`) und prueft dann mit `verifyIntegrity()`. Der
 * Mock ist nur der Speicher — Hash und Verkettung kommen aus dem
 * Produktivcode.
 */

/** Ein Eintrag im Mock-Speicher. */
type MockEintrag = {
  id: string;
  kanzleiId: string | null;
  mandantId: string | null;
  userId: string | null;
  jahresabschlussId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  previousState: unknown;
  newState: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  geoLocation: string | null;
  entryHash: string | null;
  prevHash: string | null;
  createdAt: Date;
  sequenz: bigint | null;
};

function makePrismaMock(eintraege: MockEintrag[]) {
  const findUnique = vi.fn(({ where }: { where: { id: string } }) =>
    Promise.resolve(eintraege.find((e) => e.id === where.id) ?? null),
  );

  const findFirst = vi.fn(
    ({
      where,
    }: {
      where: {
        kanzleiId?: string | null;
        entityType?: string;
        entityId?: string;
        entryHash?: null;
        sequenz?: { lt: bigint } | null;
        OR?: unknown;
      };
      orderBy?: unknown;
    }) => {
      let kandidaten = eintraege.filter((e) => {
        if (where.kanzleiId !== undefined && e.kanzleiId !== where.kanzleiId) {
          return false;
        }
        if (where.entityType !== undefined && e.entityType !== where.entityType) {
          return false;
        }
        if (where.entityId !== undefined && e.entityId !== where.entityId) {
          return false;
        }
        if (where.entryHash === null && e.entryHash !== null) return false;
        if (where.sequenz?.lt !== undefined) {
          if (e.sequenz === null || e.sequenz >= where.sequenz.lt) return false;
        }
        return true;
      });

      // Der Schreibpfad sucht den Vorgaenger: gleiche Kanzlei, kleinere
      // `sequenz`, groesstes zuerst.
      if (where.sequenz?.lt !== undefined) {
        const mitSeq = kandidaten.filter((e) => e.sequenz !== null);
        mitSeq.sort((a, b) => Number((b.sequenz! - a.sequenz!)));
        return Promise.resolve((mitSeq[0] as never) ?? null);
      }

      // Der Schreibpfad fragt den naechsten offenen Eintrag.
      if (where.entryHash === null) {
        const offene = kandidaten.filter((e) => e.entryHash === null);
        offene.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        return Promise.resolve((offene[0] as never) ?? null);
      }

      kandidaten = [...kandidaten];
      kandidaten.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      return Promise.resolve((kandidaten[0] as never) ?? null);
    },
  );

  const update = vi.fn(
    ({
      where,
      data,
    }: {
      where: { id: string };
      data: { entryHash: string; prevHash: string };
    }) => {
      const eintrag = eintraege.find((e) => e.id === where.id)!;
      eintrag.entryHash = data.entryHash;
      eintrag.prevHash = data.prevHash;
      return Promise.resolve({ ...eintrag });
    },
  );

  // `verifyIntegrity()` liest alle Eintraege in der Reihenfolge des
  // Schreibpfads: `sequenz` zuerst.
  const findMany = vi.fn(
    ({
      where,
    }: {
      where?: { kanzleiId?: string };
    }) => {
      let treffer = eintraege.filter(
        (e) => !where?.kanzleiId || e.kanzleiId === where.kanzleiId,
      );
      treffer = [...treffer].sort((a, b) => {
        const as = a.sequenz === null ? 0 : Number(a.sequenz);
        const bs = b.sequenz === null ? 0 : Number(b.sequenz);
        if (as !== bs) return as - bs;
        return a.createdAt.getTime() - b.createdAt.getTime();
      });
      return Promise.resolve(treffer.map((e) => ({ ...e })));
    },
  );

  return {
    mock: { auditLog: { findUnique, findFirst, findMany, update } } as never,
    eintraege,
  };
}

function eintrag(
  id: string,
  kanzleiId: string | null,
  sequenz: number,
  sekunde: number,
): MockEintrag {
  return {
    id,
    kanzleiId,
    mandantId: null,
    userId: null,
    jahresabschlussId: null,
    action: 'CREATE',
    entityType: 'Test',
    entityId: id,
    previousState: null,
    newState: { id },
    ipAddress: null,
    userAgent: 'test',
    geoLocation: null,
    entryHash: null,
    prevHash: null,
    createdAt: new Date(`2026-10-20T10:00:${String(sekunde).padStart(2, '0')}Z`),
    sequenz: BigInt(sequenz),
  };
}

describe('AuditIntegrityService — Integritaetspruefung je Kanzlei', () => {
  let service: AuditIntegrityService;
  let eintraege: MockEintrag[];

  beforeEach(() => {
    const KANZLEI_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const KANZLEI_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

    // Zwei Kanzleien, jeweils zwei Eintraege. Die `sequenz` laeuft global
    // weiter — so, wie in der Datenbank.
    eintraege = [
      eintrag('a1', KANZLEI_A, 1, 1),
      eintrag('b1', KANZLEI_B, 2, 2),
      eintrag('a2', KANZLEI_A, 3, 3),
      eintrag('b2', KANZLEI_B, 4, 4),
    ];

    const { mock } = makePrismaMock(eintraege);
    service = new AuditIntegrityService(mock);
  });

  it('meldet bei zwei Kanzleien KEINEN Bruch', async () => {
    // Die Eintraege ueber den **Produktivpfad** hashen — so, wie es im
    // Betrieb passiert.
    for (const e of eintraege) {
      await service.computeHashForEntry(e.id);
    }

    const ergebnis = await service.verifyIntegrity();

    expect(
      ergebnis.status,
      `die Kette ist je Kanzlei intakt — ${JSON.stringify(ergebnis)}`,
    ).toBe('OK');
    expect(ergebnis.entriesChecked).toBe(4);
  });

  it('meldet weiterhin einen echten Bruch (Manipulation)', async () => {
    // **Die Gegenprobe.** Der Fix darf nicht jede Meldung verschlucken:
    // ein tatsaechlich veraenderter Hash muss weiterhin „BROKEN" ergeben.
    for (const e of eintraege) {
      await service.computeHashForEntry(e.id);
    }
    // Den Hash des zweiten Eintrags der Kanzlei A manipulieren.
    eintraege[2]!.entryHash = 'f'.repeat(64);

    const ergebnis = await service.verifyIntegrity();
    expect(ergebnis.status).toBe('BROKEN');
    expect(ergebnis.brokenAt?.auditLogId).toBe('a2');
  });

  it('meldet fuer eine einzelne Kanzlei OK', async () => {
    for (const e of eintraege) {
      await service.computeHashForEntry(e.id);
    }
    const ergebnis = await service.verifyIntegrity({
      kanzleiId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
    expect(ergebnis.status).toBe('OK');
    expect(ergebnis.entriesChecked).toBe(2);
  });
});
