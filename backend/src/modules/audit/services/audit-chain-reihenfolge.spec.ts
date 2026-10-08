/**
 * Reproduktion: die Audit-Hash-Chain bricht, wenn zwei Einträge in
 * derselben Millisekunde entstehen UND ihre UUID-Zuordnung der
 * Einfügereihenfolge widerspricht.
 *
 * Mechanismus (aus dem Code gelesen):
 * - `computeHashForEntry()` sucht den Vorgänger über
 *     createdAt < X ODER (createdAt = X UND id < X.id)
 *   und ordnet nach `[{createdAt: 'desc'}, {id: 'desc'}]`.
 * - `id` ist eine ZUFALLS-UUID (uuid v4).
 * - Die Verarbeitung läuft seriell in EINFÜGEREihenfolge
 *   (`AuditIntegrityService.enqueue`).
 *
 * Entstehen zwei Einträge in derselben Millisekunde, ist die
 * Einfügereihenfolge nicht mehr maßgeblich — die UUID-Reihenfolge
 * entscheidet. Wird der ZWEITE zuerst verarbeitet und hat eine
 * GRÖSSERE UUID, findet er den ersten nicht als Vorgänger und
 * beginnt die Kette neu (GENESIS).
 *
 * Postgres `timestamptz` hat Mikrosekunden, Prisma schreibt aber in
 * JS `Date` — Millisekunden. Drei Einträge in einer Schleife landen
 * regelmäßig in derselben Millisekunde.
 */

import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { AuditIntegrityService } from './audit-integrity.service';

const GENESIS = (AuditIntegrityService as unknown as { GENESIS_HASH: string }).GENESIS_HASH;

function hash(prev: string, e: Record<string, unknown>): string {
  return crypto
    .createHash('sha256')
    .update(prev + JSON.stringify(e, Object.keys(e).sort()))
    .digest('hex');
}

/** Bildet die Abfrage aus `computeHashForEntry` nach. */
function vorgaengerVon(
  eintraege: Array<{ id: string; createdAt: Date; entryHash: string | null }>,
  current: { id: string; createdAt: Date },
): (typeof eintraege)[number] | undefined {
  const treffer = eintraege
    .filter((e) => e.id !== current.id)
    .filter(
      (e) =>
        e.createdAt < current.createdAt ||
        (e.createdAt.getTime() === current.createdAt.getTime() && e.id < current.id),
    )
    .sort((a, b) => {
      const t = b.createdAt.getTime() - a.createdAt.getTime();
      return t !== 0 ? t : b.id.localeCompare(a.id);
    });
  return treffer[0];
}

describe('Audit-Chain: Reihenfolge bei identischem Zeitstempel', () => {
  it('zweiter Eintrag mit GROSSER UUID findet den ersten nicht als Vorgänger', () => {
    const ms = new Date('2026-10-08T10:00:00.000Z');
    // Eingefuegt: erst A (kleinere UUID), dann B (groessere UUID).
    const a = { id: '00000000-0000-4000-8000-000000000001', createdAt: ms, entryHash: hash(GENESIS, { id: 'a' }) };
    const b = { id: 'ffffffff-0000-4000-8000-000000000002', createdAt: ms, entryHash: null as unknown as null };

    const vorgaenger = vorgaengerVon([a, b], b);
    expect(vorgaenger?.id).toBe(a.id);
    // Und jetzt der Fall, der bricht: der später eingefügte Eintrag
    // mit der KLEINEREN UUID.
    const c = { id: '00000000-0000-4000-8000-000000000000', createdAt: ms, entryHash: null as unknown as null };
    const d = { id: '00000000-0000-4000-8000-00000000000a', createdAt: ms, entryHash: hash(GENESIS, { id: 'd' }) };

    // c wird ZWEITENS verarbeitet (Einfuegereihenfolge), hat aber eine
    // KLEINERE UUID als d. Der Zeitstempel ist gleich — also entscheidet
    // die UUID, und c sieht d NICHT als Vorgaenger.
    const vorgaengerC = vorgaengerVon([c, d], c);
    expect(
      vorgaengerC,
      'BUG: der spaeter eingefuegte Eintrag beginnt die Kette neu, weil die ' +
        'Zufalls-UUID der Einfuegereihenfolge widerspricht',
    ).toBeUndefined();
    expect(vorgaengerC?.entryHash).toBeUndefined();
  });

  it('bei verschiedenen Zeitstempeln ist die Reihenfolge korrekt', () => {
    const frueh = { id: 'ffffffff-0000-4000-8000-000000000009', createdAt: new Date('2026-10-08T10:00:00.000Z'), entryHash: 'h1' };
    const spaet = { id: '00000000-0000-4000-8000-000000000001', createdAt: new Date('2026-10-08T10:00:00.500Z'), entryHash: 'h2' };
    expect(vorgaengerVon([frueh, spaet], spaet)?.id).toBe(frueh.id);
  });

  it('GENESIS bei der leeren Kanzlei', () => {
    expect(
      vorgaengerVon([], { id: 'x', createdAt: new Date() }),
    ).toBeUndefined();
    expect(GENESIS).toHaveLength(64);
  });
});