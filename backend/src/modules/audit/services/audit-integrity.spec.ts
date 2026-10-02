import { describe, it, expect } from 'vitest';
import { AuditIntegrityService } from './audit-integrity.service';

/**
 * Regressionstest für die Hash-Chain (Befund 2026-10-02).
 *
 * Die als „Manipulationserkennung" verkaufte Hash-Chain hat noch nie einen
 * Hash verifiziert. Grund: Beide Seiten serialisierten den **ganzen**
 * Prisma-Eintrag — beim Schreiben ist `entryHash` noch `null`, beim Lesen
 * gefüllt. Der Hash über `prevHash + serializeForHashing(entry)` war damit
 * auf der Schreib- und der Leseseite nie identisch, und
 * `verifyIntegrity()` konnte nur `PARTIAL` oder `BROKEN` melden.
 *
 * Der Test bildet beide Seiten mit derselben Instanz nach und verlangt,
 * dass die Kette `OK` meldet.
 */
describe('AuditIntegrityService — Hash-Chain', () => {
  const service = new AuditIntegrityService({} as never);

  /** Minimales Prisma-Similar für einen AuditLog-Eintrag. */
  function buildEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: '11111111-1111-4111-8111-111111111111',
      kanzleiId: '22222222-2222-4222-8222-222222222222',
      mandantId: null,
      userId: '33333333-3333-4333-8333-333333333333',
      jahresabschlussId: null,
      action: 'UPDATE',
      entityType: 'Mandant',
      entityId: 'abc',
      previousState: { name: 'alt' },
      newState: { name: 'neu' },
      ipAddress: '10.0.0.1',
      userAgent: 'vitest',
      geoLocation: null,
      createdAt: new Date('2026-01-15T10:00:00.000Z'),
      ...overrides,
    };
  }

  function computeHash(prevHash: string, entry: unknown): string {
    const crypto = require('node:crypto') as typeof import('node:crypto');
    const serialized = (
      service as unknown as {
        serializeForHashing(e: unknown): string;
      }
    ).serializeForHashing(entry);
    return crypto.createHash('sha256').update(prevHash + serialized).digest('hex');
  }

  it('berechnet denselben Hash beim Schreiben und beim Verifizieren', () => {
    const prevHash = '0'.repeat(64);
    // Schreibseite: der Eintrag ist noch ohne Hash in der DB.
    const beimSchreiben = buildEntry();
    const geschriebenerHash = computeHash(prevHash, beimSchreiben);

    // Leseseite: derselbe Eintrag, jetzt mit gesetzten Hash-Feldern.
    const beimLesen = buildEntry({
      entryHash: geschriebenerHash,
      prevHash,
    });
    const erwarteterHash = computeHash(prevHash, beimLesen);

    // Vor dem Fix waren das zwei verschiedene Werte — die Kette konnte
    // grundsätzlich nie `OK` melden.
    expect(erwarteterHash).toBe(geschriebenerHash);
  });

  it('schließt entryHash und prevHash aus dem Hash aus', () => {
    const prevHash = '0'.repeat(64);
    const ohneHash = buildEntry();
    const mitHash = buildEntry({ entryHash: 'a'.repeat(64), prevHash });

    // Der Hash darf nicht vom eigenen Ergebnis abhängen.
    expect(computeHash(prevHash, ohneHash)).toBe(computeHash(prevHash, mitHash));
  });

  it('ist unabhängig von der Schlüsselreihenfolge', () => {
    const prevHash = '0'.repeat(64);
    const a = buildEntry();
    // Gleiche Felder, andere Reihenfolge.
    const b: Record<string, unknown> = {};
    for (const key of Object.keys(a).reverse()) b[key] = a[key];

    // Prisma liefert die Felder in Schema-Reihenfolge; ohne Sortierung wäre
    // der Hash von der Reihenfolge abhängig und damit nicht reproduzierbar.
    expect(computeHash(prevHash, b)).toBe(computeHash(prevHash, a));
  });

  it('erkennt eine nachträgliche Manipulation', () => {
    const prevHash = '0'.repeat(64);
    const original = buildEntry();
    const hash = computeHash(prevHash, original);

    // Jemand ändert newState nach dem Schreiben.
    const manipuliert = buildEntry({
      entryHash: hash,
      prevHash,
      newState: { name: 'manipuliert' },
    });

    expect(computeHash(prevHash, manipuliert)).not.toBe(hash);
  });

  it('serialisiert Date als ISO-8601 (stabil über DB-Roundtrip)', () => {
    const prevHash = '0'.repeat(64);
    const mitDate = buildEntry();
    // Nach einem DB-Roundtrip kommt der Wert als String zurück.
    const mitString = buildEntry({ createdAt: '2026-01-15T10:00:00.000Z' });
    expect(computeHash(prevHash, mitString)).toBe(computeHash(prevHash, mitDate));
  });
});
