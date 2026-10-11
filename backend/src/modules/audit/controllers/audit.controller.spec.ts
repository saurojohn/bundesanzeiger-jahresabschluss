import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { AuditController } from './audit.controller';
import type { AuthUser } from '../../auth/types/auth-user.types';

/**
 * BEFUND 2026-10-11 — Die Integritätsprüfung lief ohne Tenant-Filter.
 *
 * `resolveKanzleiIds` liefert für einen Nicht-Admin ein **leeres** Array,
 * wenn eine fremde `kanzleiId` angefragt wurde. Aus `kanzleiIds[0]` wurde
 * dann `undefined`, und `verifyIntegrity` setzt den Filter nur, wenn
 * eine `kanzleiId` vorliegt:
 *
 *     if (args?.kanzleiId) where['kanzleiId'] = args.kanzleiId;
 *
 * Die Prüfung lief also über ALLE Audit-Einträge aller Mandanten.
 * Live gemessen: die Antwort meldete `kanzleiId: (keiner)` bei
 * `entriesChecked: 27` — bewertet über fremde Einträge, mit
 * `brokenAt.auditLogId` und `oldestUnhashedEntry` daraus.
 *
 * Behoben: eine leere Auflösung ist nicht "prüfe alles", sondern
 * "Zugriff verweigert".
 *
 * Der Kommentar am Controller behauptete zuvor „Non-SYSTEM_ADMIN: auf
 * eigene Kanzlei einschränken" — das war genau die Aussage, die nicht
 * stimmte. Sie trifft jetzt zu.
 */

const KANZLEI_EIGEN = 'aaaaaaaa-0000-4000-8000-00000000000a';
const KANZLEI_FREMD = 'bbbbbbbb-0000-4000-8000-00000000000b';
const MANDANT_A = 'aaaaaaaa-1111-4111-8111-111111111111';

function build() {
  const verifyIntegrity = vi.fn().mockResolvedValue({
    status: 'OK',
    entriesChecked: 1,
  });

  const prisma = {
    mandant: {
      // Der Mock MUSS den `where`-Filter auswerten. Ein Mock, der immer
      // eine Kanzlei liefert, würde einen Nutzer ohne Mandanten als
      // zugänglich erscheinen lassen — der Test wäre dann grün und
      // falsch.
      findMany: vi.fn().mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.includes(MANDANT_A) ? [{ kanzleiId: KANZLEI_EIGEN }] : [],
      ),
    },
    kanzlei: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null) },
  };

  // Reihenfolge laut Konstruktor: auditService, integrityService, prisma.
  const controller = new AuditController(
    {} as never,
    { verifyIntegrity } as never,
    prisma as never,
  );

  return { controller, verifyIntegrity };
}

const kanzleiAdmin = {
  id: 'u1',
  globalRole: null,
  mandanten: [{ id: MANDANT_A, rolle: 'KANZLEI_ADMIN' }],
} as unknown as AuthUser;

describe('BEFUND 2026-10-11: Integritätsprüfung bleibt im eigenen Tenant', () => {
  it('die eigene Kanzlei wird geprüft', async () => {
    const { controller, verifyIntegrity } = build();
    await controller.verifyIntegrity(kanzleiAdmin, undefined, undefined, undefined);
    expect(verifyIntegrity).toHaveBeenCalledWith(
      expect.objectContaining({ kanzleiId: KANZLEI_EIGEN }),
    );
  });

  it('eine FREMDDE kanzlei wird verweigert, nicht ungefiltert geprüft', async () => {
    const { controller, verifyIntegrity } = build();

    await expect(
      controller.verifyIntegrity(kanzleiAdmin, KANZLEI_FREMD, undefined, undefined),
    ).rejects.toBeInstanceOf(NotFoundException);

    // Der eigentliche Nachweis: es wird gar nicht geprueft. `kanzleiId`
    // waere undefined gewesen — das ist der Fehler.
    expect(verifyIntegrity).not.toHaveBeenCalled();
  });

  it('SYSTEM_ADMIN darf fremde Kanzleien pruefen', async () => {
    const { controller, verifyIntegrity } = build();
    const sysAdmin = { id: 'u0', globalRole: 'SYSTEM_ADMIN', mandanten: [] } as unknown as AuthUser;

    await controller.verifyIntegrity(sysAdmin, KANZLEI_FREMD, undefined, undefined);

    expect(verifyIntegrity).toHaveBeenCalledWith(
      expect.objectContaining({ kanzleiId: KANZLEI_FREMD }),
    );
  });

  it('ein Nutzer ganz ohne Mandant bekommt nichts zu pruefen', async () => {
    const { controller, verifyIntegrity } = build();
    const ohne = {
      id: 'u2',
      globalRole: null,
      mandanten: [],
    } as unknown as AuthUser;

    await expect(
      controller.verifyIntegrity(ohne, undefined, undefined, undefined),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(verifyIntegrity).not.toHaveBeenCalled();
  });
});