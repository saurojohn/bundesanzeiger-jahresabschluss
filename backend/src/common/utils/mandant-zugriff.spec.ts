import { describe, it, expect } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { assertMandantAccess } from './mandant-zugriff';
import type { AuthUser } from '../../modules/auth/types/auth-user.types';

/**
 * Der Mandantenzugriff — eine Kopie statt zwoelf.
 *
 * BEFUND 2026-10-20 (Nachtrag 58, TODO-8.7): Die Pruefung stand
 * zwoelfmal im Quelltext. Jede Kopie war eine Gelegenheit, eine davon zu
 * aendern und die anderen zu vergessen — genau das ist mit
 * `mandant.service.ts` passiert (dort stand `BadRequestException` (400)
 * statt `ForbiddenException` (403)).
 *
 * Der Test haelt die **Wirkung** fest, nicht die Form: 403, und die
 * Meldung, die der MandantGuard auch verwendet — sonst wuerde ein Client
 * an der Servicestelle eine andere Meldung sehen als am Guard.
 */

const M1 = '11111111-1111-4111-8111-111111111111';
const M2 = '22222222-2222-4222-8222-222222222222';

function user(teil: Partial<AuthUser>): AuthUser {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    email: 'test@example.de',
    vorname: 'Test',
    nachname: 'Test',
    globalRole: 'USER',
    mandanten: [],
    ...teil,
  };
}

describe('assertMandantAccess — Tiefenschutz', () => {
  it('laesst SYSTEM_ADMIN ueberall hin', () => {
    expect(() =>
      assertMandantAccess(M2, user({ globalRole: 'SYSTEM_ADMIN' })),
    ).not.toThrow();
  });

  it('laesst den eigenen Mandanten hin', () => {
    expect(() =>
      assertMandantAccess(
        M1,
        user({ mandanten: [{ id: M1, firmenname: 'A', rolle: 'GF' }] }),
      ),
    ).not.toThrow();
  });

  it('weist einen fremden Mandanten mit 403 ab', () => {
    let geworfen: unknown = null;
    try {
      assertMandantAccess(
        M2,
        user({ mandanten: [{ id: M1, firmenname: 'A', rolle: 'GF' }] }),
      );
    } catch (err) {
      geworfen = err;
    }
    expect(geworfen, 'ein fremder Mandant muss abgewiesen werden').toBeInstanceOf(
      ForbiddenException,
    );
    expect((geworfen as ForbiddenException).getStatus()).toBe(403);
    expect((geworfen as Error).message).toBe('Kein Zugriff auf diesen Mandanten');
  });

  it('beruecksichtigt ALLE Rollen desselben Mandanten', () => {
    // `@@unique([userId, mandantId, rolle])` — ein User kann auf demselben
    // Mandanten mehrere Rollen haben. Wer nur die erste nimmt, verweigert
    // einem WP den Zugriff, der ihm zusteht (Nachtrag 40).
    expect(() =>
      assertMandantAccess(
        M1,
        user({
          mandanten: [
            { id: M1, firmenname: 'A', rolle: 'STEUERBERATER' },
            { id: M1, firmenname: 'A', rolle: 'WIRTSCHAFTSPRUEFER' },
          ],
        }),
      ),
    ).not.toThrow();
  });

  it('weist einen Mandanten ab, zu dem der User gar keine Rolle hat', () => {
    expect(() =>
      assertMandantAccess(
        M2,
        user({ mandanten: [{ id: M1, firmenname: 'A', rolle: 'GF' }] }),
      ),
    ).toThrow(ForbiddenException);
  });
});
