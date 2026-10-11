import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { MandantService } from './mandant.service';
import type { AuthUser } from '../../auth/types/auth-user.types';

/**
 * BEFUND 2026-10-11 — Mandantentrennung über den Query-Parameter `kanzleiId`.
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
 */

const KANZLEI_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const KANZLEI_B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const MANDANT_A = 'aaaaaaaa-1111-4111-8111-111111111111';

function build() {
  const findMany = vi.fn().mockResolvedValue([]);
  const count = vi.fn().mockResolvedValue(0);
  const service = new MandantService(
    {
      mandant: {
        findMany,
        count,
        //  loest die eigene Kanzlei ueber den ersten
        // zugänglichen Mandanten auf — genau dieser Lookup wird hier
        // nachgebildet.
        findUnique: vi.fn().mockResolvedValue({ kanzleiId: KANZLEI_A }),
      },
      kanzlei: { findFirst: vi.fn().mockResolvedValue({ id: KANZLEI_A }) },
    } as never,
    { record: vi.fn() } as never,
    { invalidate: vi.fn() } as never,
  );
  return { service, findMany };
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
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { kanzleiId: KANZLEI_A } }),
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

    expect(findMany, 'es darf gar nicht erst abgefragt werden').not.toHaveBeenCalled();
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
});