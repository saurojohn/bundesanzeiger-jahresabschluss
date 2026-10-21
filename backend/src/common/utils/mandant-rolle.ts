import { ForbiddenException } from '@nestjs/common';
import type { AuthUser } from '../../modules/auth/types/auth-user.types';

/**
 * Rolle **auf einem Mandanten** — nicht „irgendwo".
 *
 * BEFUND 2026-10-21 (Nachtrag 72): Zwei WP-Services prueften die
 * Wirtschaftspruefer-Rolle global:
 *
 *     const hasWPRole = user.mandanten.some((m) => m.rolle === 'WIRTSCHAFTSPRUEFER');
 *     // "WP IRGENDWO"
 *     ...
 *     assertMandantAccess(mandantId, user);   // irgendeine Rolle auf dem Ziel
 *
 * Zusammen belegen die beiden Pruefungen **nicht** „WP fuer diesen
 * Mandanten". Wer in Mandant A Wirtschaftspruefer und in Mandant B nur
 * Steuerberater ist, besteht beide fuer Mandant B.
 *
 * **Gemessen.** Zwei Personen, beide WP in Mandant A und nur
 * STEUERBERATER in Mandant B:
 *
 *     POST /api/wp/pruefungen           -> HTTP 201  (Pruefung fuer B angelegt)
 *     POST /api/wp/pruefungen/:id/finalize -> HTTP 200  (status APPROVED)
 *     Status der Bilanz in Mandant B danach: APPROVED
 *
 * Die Bilanz eines Mandanten wurde also von zwei Personen freigegeben, die
 * fuer diesen Mandanten **nicht** bestellte Wirtschaftspruefer sind — sie
 * sind dort die Ersteller. Das ist genau das, was das Vier-Augen-Prinzip
 * (IDW PS 880) verhindern soll: der Pruefer muss unabhaengig vom
 * Pruefenden sein.
 *
 * **Merksatz:** „Zugriff auf den Mandanten" und „Rolle auf dem Mandanten"
 * sind zwei verschiedene Fragen. Die erste beantwortet
 * `common/utils/mandant-zugriff.ts`, die zweite diese Datei.
 */

/** Mandanten-Zugriff aus der Auth-Session. */
export interface MandantRollenZugriff {
  id: string;
  rolle: string | string[];
}

/**
 * Hat der User die Rolle auf **diesem** Mandanten?
 *
 * Ein User kann mehrere Rollen auf demselben Mandanten haben
 * (`@@unique([userId, mandantId, rolle])`) — deshalb werden alle Rollen
 * dieses Mandanten geprueft, nicht nur die erste.
 */
export function hatRolleAufMandant(
  mandantId: string,
  rollen: readonly string[],
  userMandanten: MandantRollenZugriff[],
): boolean {
  const gesucht = new Set(rollen.map((r) => r.toUpperCase()));
  return userMandanten
    .filter((m) => m.id === mandantId)
    .flatMap((m) => (Array.isArray(m.rolle) ? m.rolle : [m.rolle]))
    .some((r) => gesucht.has(String(r).toUpperCase()));
}

/**
 * Wirft, wenn der User die Rolle auf diesem Mandanten **nicht** hat.
 *
 * SYSTEM_ADMIN darf alles (globale Administratorrechte).
 */
export function assertRolleAufMandant(
  mandantId: string,
  rollen: readonly string[],
  user: AuthUser,
  rolleMeldung: string,
): void {
  if (user.globalRole === 'SYSTEM_ADMIN') return;
  if (!hatRolleAufMandant(mandantId, rollen, user.mandanten ?? [])) {
    throw new ForbiddenException(rolleMeldung);
  }
}
