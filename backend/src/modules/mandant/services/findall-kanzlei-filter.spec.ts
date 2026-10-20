import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { MandantService } from './mandant.service';
import type { AuthUser } from '../../auth/types/auth-user.types';

/**
 * Die Mandantenliste: Rollen an die Kanzlei gebunden.
 *
 * ## BEFUND 2026-10-11 — Mandantentrennung über den Query-Parameter `kanzleiId`
 *
 * `findAll` baute den Filter so:
 *
 *     istKanzleiAdmin
 *       ? pagination?.kanzleiId || kanzleiId
 *         ? { kanzleiId: pagination?.kanzleiId ?? kanzleiId! }
 *         : {}
 *       : { id: { in: … } }
 *
 * `pagination.kanzleiId` kommt aus dem Query-String und **überschrieb** den
 * aufgelösten Wert. Live gemessen:
 *
 *     GET /api/mandant                    -> 3 Mandanten (eigene Kanzlei)
 *     GET /api/mandant?kanzleiId=<fremd>  -> "Fremd-Mandant GmbH"
 *
 * Ein KANZLEI_ADMIN konnte damit die Mandantenliste einer fremden Kanzlei
 * abrufen — Firmenname, USt-Id, Adresse. Mandantentrennungs-Bruch.
 *
 * Der leere `{}`-Zweig war nicht erreichbar, weil `resolveKanzleiId` wirft
 * statt leer zu liefern. Er war aber eine latente Falle: liefe die Methode
 * je einmal `null`, waere er sofort der Cross-Tenant-Zugriff. Der Zweig
 * ist entfernt, nicht nur unerreichbar gemacht.
 *
 * ## BEFUND 2026-10-20 (Nachtrag 68) — dieselbe Lücke an fünfter Stelle
 *
 * Nach dem Fix benutzte die Liste zwei Angaben, die **auseinanderlaufen
 * koennen**:
 *
 *     istKanzleiAdmin  = "Admin IRGENDWO"  (irgendein Mandant hat die Rolle)
 *     eigeneKanzleiId  = Kanzlei des ERSTEN Mandanten (Sortierung: Firma)
 *
 * Ist der erste Mandant in der Kanzlei, in der der User **kein** Admin
 * ist, sah er **alle** Mandanten dieser Kanzlei. Gemessen:
 *
 *     Session-Mandanten: Aaa GmbH/STEUERBERATER, Beispiel GmbH/KANZLEI_ADMIN, …
 *     Mandantenliste (vorher): ["Aaa GmbH", "Bravo GmbH"]
 *
 * „Bravo GmbH" ist ein Mandant der Kanzlei B, in dem der User **keine
 * Rolle** hat — und die Mandanten der Kanzlei A, in der er Admin **ist**,
 * fehlten in der Liste.
 *
 * **Die Regel jetzt:** Der User sieht alle Mandanten der Kanzleien, in denen
 * er KANZLEI_ADMIN ist, **plus** seine eigenen Mandanten (mit jeder Rolle)
 * in jeder Kanzlei.
 */

const KANZLEI_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const KANZLEI_B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const MANDANT_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const MANDANT_B = 'bbbbbbbb-1111-4111-8111-111111111111';

function build() {
  const count = vi.fn().mockResolvedValue(0);

  /**
   * Die Mandanten des Users mit ihrer Kanzlei — fuer die Rollenbindung.
   *
   * Standardmaessig: ein Mandant in KANZLEI_A. Der Test kann sie ueberschreiben.
   */
  let bindungMandanten: Array<{ id: string; kanzleiId: string }> = [
    { id: MANDANT_A, kanzleiId: KANZLEI_A },
  ];

  /**
   * Der Mock bedient **zwei** Abfragen ueber dieselbe Methode:
   * die Rollenbindung (`select: { id, kanzleiId }`) und die Liste
   * (`orderBy`). Ueber das `select` sind sie unterscheidbar.
   */
  const mandantFindMany = vi.fn((args?: { select?: { kanzleiId?: boolean } }) => {
    if (args?.select?.kanzleiId) {
      return Promise.resolve(bindungMandanten);
    }
    return Promise.resolve([]);
  });

  const service = new MandantService(
    {
      mandant: {
        findMany: mandantFindMany,
        count,
        //  loest die eigene Kanzlei ueber den ersten
        //  zugänglichen Mandanten auf — genau dieser Lookup wird hier
        //  nachgebildet.
        findUnique: vi.fn().mockResolvedValue({ kanzleiId: KANZLEI_A }),
      },
      kanzlei: { findFirst: vi.fn().mockResolvedValue({ id: KANZLEI_A }) },
    } as never,
    { record: vi.fn() } as never,
    { invalidate: vi.fn() } as never,
  );

  return {
    service,
    findMany: mandantFindMany,
    setzeBindungMandanten: (m: Array<{ id: string; kanzleiId: string }>) => {
      bindungMandanten = m;
    },
  };
}

const kanzleiAdmin = {
  id: 'u1',
  globalRole: null,
  mandanten: [{ id: MANDANT_A, rolle: 'KANZLEI_ADMIN' }],
} as unknown as AuthUser;

describe('BEFUND 2026-10-11: kanzleiId aus dem Query bindet an die eigene Kanzlei', () => {
  it('ohne Parameter wird die eigene Kanzlei gefiltert', async () => {
    const { service, findMany } = build();
    await service.findAll(kanzleiAdmin, { pageSize: 50 });
    // BEFUND 2026-10-20 (Nachtrag 68): Die Sichtbarkeit ist jetzt
    // „alle Mandanten der Admin-Kanzleien ODER ein eigener Mandant". Fuer
    // den Normalfall (ein Admin, alle eigenen Mandanten in dieser Kanzlei)
    // ist das dieselbe Menge wie vorher — nur in einer Form, die den
    // Mehr-Kanzlei-Fall richtig abbildet.
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { kanzleiId: { in: [KANZLEI_A] } },
            { id: { in: [MANDANT_A] } },
          ],
        },
      }),
    );
  });

  it('die EIGENE kanzlei darf angegeben werden', async () => {
    const { service, findMany } = build();
    await service.findAll(kanzleiAdmin, { pageSize: 50, kanzleiId: KANZLEI_A });
    expect(findMany).toHaveBeenCalled();
  });

  it('eine FREMDE kanzlei wird abgelehnt, nicht still ignoriert', async () => {
    // Fail-closed UND ehrlich: ein stilles Ignorieren ließe den Aufrufer
    // glauben, er habe die fremde Kanzlei gesehen.
    const { service, findMany } = build();

    await expect(
      service.findAll(kanzleiAdmin, { pageSize: 50, kanzleiId: KANZLEI_B }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(
      findMany.mock.calls.filter((c) => !c[0]?.select?.kanzleiId),
      'es darf die Mandantenliste gar nicht erst abfragen',
    ).toHaveLength(0);
  });

  it('SYSTEM_ADMIN darf weiterhin kanzleiübergreifend filtern', async () => {
    // Pilot-Annahme: ein Betreiber verwaltet mehrere Kanzleien. Das bleibt.
    const { service, findMany } = build();
    const sysAdmin = { id: 'u0', globalRole: 'SYSTEM_ADMIN', mandanten: [] } as unknown as AuthUser;

    await service.findAll(sysAdmin, { pageSize: 50, kanzleiId: KANZLEI_B });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { kanzleiId: KANZLEI_B } }),
    );
  });

  it('ein Nicht-Admin sieht nur seine eigenen Mandanten', async () => {
    const { service, findMany } = build();
    const berater = {
      id: 'u2',
      globalRole: null,
      mandanten: [{ id: MANDANT_A, rolle: 'STEUERBERATER' }],
    } as unknown as AuthUser;

    await service.findAll(berater, { pageSize: 50 });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: [MANDANT_A] } } }),
    );
  });

  it('BEFUND 2026-10-20: ein Admin in zwei Kanzleien sieht BEIDE — und nicht die fremden', async () => {
    // Der Fund, der den Bug ausloeste: „Admin IRGENDWO" plus „Kanzlei des
    // ersten Mandanten". Ein Admin der Kanzlei A, der zusaetzlich einen
    // Mandant in der Kanzlei B hat (dort STEUERBERATER), sah **alle**
    // Mandanten der Kanzlei B — auch die, in denen er keine Rolle hat.
    //
    // Erwartet: alle Mandanten der Kanzlei A (dort ist er Admin) plus
    // seine eigenen Mandanten in der Kanzlei B.
    const { service, findMany, setzeBindungMandanten } = build();
    setzeBindungMandanten([
      { id: MANDANT_A, kanzleiId: KANZLEI_A },
      { id: MANDANT_B, kanzleiId: KANZLEI_B },
    ]);
    const adminInZweiKanzleien = {
      id: 'u1',
      globalRole: null,
      mandanten: [
        { id: MANDANT_A, rolle: 'KANZLEI_ADMIN' },
        { id: MANDANT_B, rolle: 'STEUERBERATER' },
      ],
    } as unknown as AuthUser;

    await service.findAll(adminInZweiKanzleien, { pageSize: 50 });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { kanzleiId: { in: [KANZLEI_A] } },
            { id: { in: [MANDANT_A, MANDANT_B] } },
          ],
        },
      }),
    );
  });

  it('BEFUND 2026-10-20: die Kanzlei B ist fuer diesen Admin filterbar — seine eigenen Mandanten', async () => {
    // Die Kanzlei, in der der User KEIN Admin ist, aber einen eigenen
    // Mandanten hat: sie ist filterbar, aber nur mit seinen Mandanten.
    const { service, findMany, setzeBindungMandanten } = build();
    setzeBindungMandanten([
      { id: MANDANT_A, kanzleiId: KANZLEI_A },
      { id: MANDANT_B, kanzleiId: KANZLEI_B },
    ]);
    const adminInZweiKanzleien = {
      id: 'u1',
      globalRole: null,
      mandanten: [
        { id: MANDANT_A, rolle: 'KANZLEI_ADMIN' },
        { id: MANDANT_B, rolle: 'STEUERBERATER' },
      ],
    } as unknown as AuthUser;

    await service.findAll(adminInZweiKanzleien, { pageSize: 50, kanzleiId: KANZLEI_B });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              OR: [
                { kanzleiId: { in: [KANZLEI_A] } },
                { id: { in: [MANDANT_A, MANDANT_B] } },
              ],
            },
            { kanzleiId: KANZLEI_B },
          ],
        },
      }),
    );
  });
});
