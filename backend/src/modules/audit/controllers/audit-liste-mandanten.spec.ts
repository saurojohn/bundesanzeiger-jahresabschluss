import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { AuditController } from './audit.controller';
import type { AuthUser } from '../../auth/types/auth-user.types';

/**
 * BEFUND 2026-10-12 — Die Audit-Liste zeigte still nur den ERSTEN
 * Mandanten eines Users.
 *
 *     const allowedMandantIds = user.mandanten.map((m) => m.id);
 *     if (!mandantId || !allowedMandantIds.includes(mandantId)) {
 *       effectiveMandantId = allowedMandantIds[0];     // ← nur der erste
 *     }
 *
 * Live gemessen: `kanzlei-admin` hat drei Mandanten, die Antwort enthielt
 * Einträge zu genau **einem** — HTTP 200, kein Hinweis.
 *
 * Für das Audit-Trail ist eine unbeabsichtigte Auslassung fast so schlimm
 * wie ein fremder Eintrag: der Anwender glaubt, alles zu sehen. Das ist
 * dieselbe Fehlerform wie beim Integritäts-Endpunkt — „grün, aber es
 * fehlt etwas" bzw. „grün, aber es ist etwas fremdes".
 *
 * Zweite Ausprägung derselben Ursache: ein User ganz ohne Mandant
 * bekam `undefined`, und `buildWhere` liest einen fehlenden Filter als
 * "kein Filter". Dass heute ein Guard davor 403 wirft, ist Zufall des
 * Aufrufs. Kontext als Schutz ist keine Absicherung.
 */

const M1 = 'aaaaaaaa-1111-4111-8111-111111111111';
const M2 = 'aaaaaaaa-2222-4222-8222-222222222222';
const M3 = 'aaaaaaaa-3333-4333-8333-333333333333';

function build() {
  const findAll = vi
    .fn()
    .mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50, hasMore: false });
  const controller = new AuditController(
    { findAll } as never,
    {} as never,
    { kanzlei: { findMany: vi.fn().mockResolvedValue([]) } } as never,
  );
  return { controller, findAll };
}

const userMit = (mandanten: string[]) =>
  ({
    id: 'u1',
    globalRole: null,
    mandanten: mandanten.map((id) => ({ id, rolle: 'STEUERBERATER' })),
  }) as unknown as AuthUser;

describe('BEFUND 2026-10-12: Audit-Liste zeigt alle eigenen Mandanten', () => {
  it('drei Mandanten werden ALLE gefiltert, nicht nur der erste', async () => {
    const { controller, findAll: spy } = build();

    await controller.list(userMit([M1, M2, M3]), undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined);

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ mandantIds: [M1, M2, M3] }),
    );
    expect(spy).not.toHaveBeenCalledWith(
      expect.objectContaining({ mandantId: M1 }),
    );
  });

  it('eine explizit angefragte eigene mandantId wird weiterhin respektiert', async () => {
    const { controller, findAll: spy } = build();

    await controller.list(userMit([M1, M2]), M2, undefined, undefined, undefined, undefined, undefined, undefined, undefined);

    // Angefragt UND erlaubt -> gezielt. Entscheidend ist, dass ein Filter
    // gesetzt ist und genau diesen Mandanten nennt — nicht, über welches
    // Feld das geschieht. Ein Test, der ein bestimmtes Feld festnagelt,
    // würde eine Umstellung als Fehler melden und einen echten Fehler
    // („gar kein Filter") verschleiern können.
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ mandantIds: [M2] }),
    );
  });

  it('eine FREMDDE mandantId wird nicht still auf den ersten Mandanten umgebogen', async () => {
    const { controller, findAll: spy } = build();

    const fremd = 'bbbbbbbb-4444-4444-8444-444444444444';
    await controller.list(userMit([M1, M2]), fremd, undefined, undefined, undefined, undefined, undefined, undefined, undefined);

    // Nicht M1 (stiller Rückfall auf den ersten), sondern die
    // vollständige eigene Menge.
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ mandantIds: [M1, M2], mandantId: undefined }),
    );
  });

  it('ein User OHNE Mandant wird verweigert, nicht ungefiltert gelesen', async () => {
    const { controller, findAll: spy } = build();

    await expect(
      controller.list(userMit([]), undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(spy, 'es darf gar nicht erst abgefragt werden').not.toHaveBeenCalled();
  });

  it('SYSTEM_ADMIN darf weiterhin gezielt und ungefiltert lesen', async () => {
    const { controller, findAll: spy } = build();
    const sysAdmin = { id: 'u0', globalRole: 'SYSTEM_ADMIN', mandanten: [] } as unknown as AuthUser;

    await controller.list(sysAdmin, M1, undefined, undefined, undefined, undefined, undefined, undefined, undefined);

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ mandantId: M1 }));
  });
});