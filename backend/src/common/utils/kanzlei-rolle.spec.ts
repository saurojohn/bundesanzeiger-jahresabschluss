import { describe, it, expect } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import {
  assertAdminInKanzlei,
  hatAdminRolleInKanzlei,
} from './kanzlei-rolle';

/**
 * BEFUND 2026-10-11 — Kanzlei-übergreifende Rechteausweitung.
 *
 * Vier Services hatten dieselbe Lücke:
 *
 *     user.mandanten.some((m) => m.rolle === 'KANZLEI_ADMIN')   // Admin IRGENDWO
 *     ...
 *     assertKanzleiAccess(kanzleiId, user)                        // Mandant IRGENDWO
 *
 * Zwei unabhängige Prüfungen. Wer in Kanzlei A KANZLEI_ADMIN ist und in
 * Kanzlei B nur STEUERBERATER, besteht beide für B — und durfte dort
 * Subscription kündigen, API-Keys anlegen, Webhooks registrieren
 * (inklusive `testDelivery`, das einen echten HTTP-Request auslöst) und die
 * Custom-Domain verifizieren.
 *
 * Der Test ist gegen die BEIDEN Seiten der Bindung geschrieben: der
 * Zugriff muss bestehen UND die Rolle dazu passen.
 */

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; // Mandant in Kanzlei A
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; // Mandant in Kanzlei B

describe('Rolle ist an die Kanzlei gebunden', () => {
  it('Admin im Mandanten der Ziel-Kanzlei darf', () => {
    expect(hatAdminRolleInKanzlei([B], [{ id: B, rolle: 'KANZLEI_ADMIN' }])).toBe(true);
  });

  it('der Kernfall: Admin in A, nur Berater in B → NEIN', () => {
    // Genau die Konstellation, die vorher durchrutschte: die
    // `.some()`-Prüfung sah KANZLEI_ADMIN (in A), der Zugriffstest sah den
    // Mandanten in B. Zusammen ergab das fälschlich "Admin in B".
    const zugang = [{ id: A, rolle: 'KANZLEI_ADMIN' }, { id: B, rolle: 'STEUERBERATER' }];
    expect(hatAdminRolleInKanzlei([B], zugang)).toBe(false);
  });

  it('ohne jeden Mandanten in der Kanzlei → NEIN', () => {
    expect(
      hatAdminRolleInKanzlei([], [{ id: A, rolle: 'KANZLEI_ADMIN' }]),
    ).toBe(false);
  });

  it('mehrere Mandanten in derselben Kanzlei: einer als Admin reicht', () => {
    const zugang = [
      { id: B, rolle: 'STEUERBERATER' },
      { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', rolle: 'KANZLEI_ADMIN' },
    ];
    expect(
      hatAdminRolleInKanzlei(['cccccccc-cccc-4ccc-8ccc-cccccccccccc', B], zugang),
    ).toBe(true);
  });
});

describe('assertAdminInKanzlei trennt die beiden Fälle in der Meldung', () => {
  it('kein Zugriff → Zugriffsmeldung', () => {
    // Beim Debugging ist der Unterschied entscheidend: "kein Zugriff" und
    // "keine Admin-Rolle" fuehren an verschiedene Stellen.
    expect(() =>
      assertAdminInKanzlei([], [{ id: A, rolle: 'KANZLEI_ADMIN' }], 'Nur Admin dieser Kanzlei'),
    ).toThrow(/Kein Zugriff auf diese Kanzlei/);
  });

  it('Zugriff, aber keine Admin-Rolle → Rollenmeldung', () => {
    expect(() =>
      assertAdminInKanzlei(
        [B],
        [{ id: A, rolle: 'KANZLEI_ADMIN' }, { id: B, rolle: 'STEUERBERATER' }],
        'Nur Admin dieser Kanzlei',
      ),
    ).toThrow(/Nur Admin dieser Kanzlei/);
  });

  it('beides vorhanden → kein Wurf', () => {
    expect(() =>
      assertAdminInKanzlei([B], [{ id: B, rolle: 'KANZLEI_ADMIN' }], 'Nur Admin dieser Kanzlei'),
    ).not.toThrow();
  });

  it('wirft ForbiddenException (nicht nur Error)', () => {
    expect(() =>
      assertAdminInKanzlei([B], [{ id: B, rolle: 'GF' }], 'x'),
    ).toThrow(ForbiddenException);
  });
});