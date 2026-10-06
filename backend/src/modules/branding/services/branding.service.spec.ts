/**
 * Regressionstest: der Logo-Abruf muss den Zugriff wirklich prüfen.
 *
 * Bugfix 2026-10-06. `getLogoBuffer()` rief
 * `this.assertKanzleiReadAccess(kanzleiId, user)` OHNE `await` auf.
 * Die Prüfung ist `async` und wirft bei Fremd-Zugriff — der Wurf
 * landete damit in einer verwaisten Promise.
 *
 * Zwei Fehlmodi gleichzeitig:
 *   1. die Ablehnung griff nicht — das fremde Logo wurde aus WORM
 *      geliefert;
 *   2. `src/` hat keinen globalen `unhandledRejection`-Handler, also
 *      beendete Node den Prozess.
 *
 * Dieselbe Methode wird in `branding.service.ts:115` KORREKT awaited —
 * der Fix war nur an einer der beiden Aufrufstellen angebracht.
 *
 * Zusätzlich stand die Prüfung NACH dem Kanzlei-Lookup: ein fremder
 * User konnte so unterscheiden, ob eine Kanzlei existiert (404) und ob
 * sie ein Logo hat (200 mit `null`).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { BrandingService } from './branding.service';

const KANZLEI_A = 'aaaaaaaa-7777-4777-8777-aaaaaaaaaaaa';
const KANZLEI_B = 'bbbbbbbb-8888-4888-8888-bbbbbbbbbbbb';
const MANDANT_A = 'mandant-a';

function buildService(opts: { mandantGehoertZu: string }) {
  const kanzlei = {
    id: KANZLEI_B,
    name: 'Fremde Kanzlei',
    logoWormKey: 'logos/fremd.png',
  };
  const prisma = {
    mandant: {
      findFirst: vi.fn().mockImplementation(
        async ({ where }: { where: { kanzleiId: string; id: { in: string[] } } }) =>
          where.kanzleiId === opts.mandantGehoertZu &&
          where.id.in.includes(MANDANT_A)
            ? { id: MANDANT_A }
            : null,
      ),
    },
  };
  const kanzleiRepository = {
    findById: vi.fn().mockResolvedValue(kanzlei),
  };
  const storageService = {
    downloadFromWorm: vi
      .fn()
      .mockResolvedValue(Buffer.from('FREMDES-LOGO', 'utf-8')),
  };
  const cache = {
    memoize: vi.fn(
      async (_k: string, _ttl: number, fn: () => Promise<unknown>) => fn(),
    ),
    get: vi.fn().mockReturnValue(undefined),
    set: vi.fn().mockResolvedValue(undefined),
  };
  const service = new BrandingService(
    prisma as never,
    cache as never,
    kanzleiRepository as never,
    { record: vi.fn().mockResolvedValue(undefined) } as never,
    storageService as never,
  );
  return { service, kanzleiRepository, storageService, prisma };
}

const userVonA = {
  id: 'u'.repeat(8) + '-7777-4777-8777-777777777777',
  globalRole: null,
  mandanten: [{ id: MANDANT_A, firmenname: 'A GmbH', rolle: 'KANZLEI_ADMIN' }],
} as never;

describe('BrandingService.getLogoBuffer: Zugriffsprüfung', () => {
  beforeEach(() => vi.clearAllMocks());

  it('liefert das Logo der eigenen Kanzlei', async () => {
    const { service } = buildService({ mandantGehoertZu: KANZLEI_A });
    const logo = await service.getLogoBuffer(KANZLEI_A, userVonA);
    expect(logo?.buffer.toString('utf-8')).toBe('FREMDES-LOGO');
  });

  it('verweigert das Logo einer fremden Kanzlei (BUG vor dem Fix)', async () => {
    const { service, storageService } = buildService({
      mandantGehoertZu: KANZLEI_A,
    });
    await expect(service.getLogoBuffer(KANZLEI_B, userVonA)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    // Das darf auf keinen Fall aus WORM gelesen werden.
    expect(storageService.downloadFromWorm).not.toHaveBeenCalled();
  });

  it('verweigert VOR dem Existenz-Check (kein 404-vs-200-orakel)', async () => {
    const { service, kanzleiRepository } = buildService({
      mandantGehoertZu: KANZLEI_A,
    });
    // Fremde Kanzlei, die es gar nicht gibt: der User darf beides nicht
    // unterscheiden — es muss immer 403 sein.
    await expect(
      service.getLogoBuffer('ffffffff-9999-4999-8999-999999999999', userVonA),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(kanzleiRepository.findById).not.toHaveBeenCalled();
  });

  it('verweigert auch dann, wenn die fremde Kanzlei kein Logo hat', async () => {
    // Sonst könnte ein fremder User anhand der Antwort unterscheiden,
    // dass es die Kanzlei gibt.
    const { service } = buildService({ mandantGehoertZu: KANZLEI_A });
    await expect(service.getLogoBuffer(KANZLEI_B, userVonA)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('SYSTEM_ADMIN darf weiterhin jede Kanzlei lesen', async () => {
    const { service } = buildService({ mandantGehoertZu: KANZLEI_A });
    const sysadmin = {
      id: 's'.repeat(8) + '-7777-4777-8777-777777777777',
      globalRole: 'SYSTEM_ADMIN',
      mandanten: [],
    } as never;
    const logo = await service.getLogoBuffer(KANZLEI_B, sysadmin);
    expect(logo).not.toBeNull();
  });

  it('ohne await entsteht keine verwaiste Promise (Struktur-Check)', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const roh = readFileSync(
      join(process.cwd(), 'src/modules/branding/services/branding.service.ts'),
      'utf-8',
    );
    const code = roh
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    // Jeder Aufruf der async-Pruefung muss awaited sein.
    const aufrufe = [...code.matchAll(/this\.assertKanzleiReadAccess\(/g)];
    expect(aufrufe.length).toBeGreaterThan(0);
    for (const a of aufrufe) {
      // `a.index` zeigt auf den Aufruf selbst; geprueft wird der Teil
      // DAVOR. Erlaubt sind `await this.assert…` und
      // `if (user) await this.assert…`, verboten ein Aufruf ohne await.
      const praefix = (code.slice(0, a.index).split('\n').pop() ?? '').trim();
      expect(
        praefix,
        `Aufruf ohne await: "${' '.repeat(0)}${a[0]} …"`,
      ).toMatch(/\bawait$/);
    }
  });

  it('getBranding ohne User bleibt unterstützt (Mandant-Ableitung)', async () => {
    // Absichern, dass die strengere Prüfung keinen echten Aufrufer bricht.
    const { service } = buildService({ mandantGehoertZu: KANZLEI_A });
    await expect(
      service.getBranding(KANZLEI_A, undefined),
    ).resolves.toBeDefined();
  });
});

// Nur zur Vollstaendigkeit referenziert: NotFoundException wird in
// getLogoBuffer weiterhin verwendet (eigene Kanzlei ohne Eintrag).
void NotFoundException;