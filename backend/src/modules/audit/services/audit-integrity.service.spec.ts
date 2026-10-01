import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { AuditIntegrityService } from './audit-integrity.service';

/**
 * Hash-Chain des Audit-Trails — Manipulationserkennung (M4 Sprint 5).
 *
 * Ausgangslage für diesen Test (Befund aus AUDIT-ATOMICITY-REVIEW.md, 2.2):
 * `computeHashForEntry()` hat den Hash berechnet, aber mit einem LEEREN
 * `data`-Objekt geschrieben — `as never` unterdrückte zusätzlich den
 * TypeScript-Fehler. Damit blieb `entryHash` für immer null,
 * `verifyIntegrity()` meldete dauerhaft PARTIAL, und die beworbene
 * Manipulationserkennung hat noch nie einen Hash gespeichert.
 *
 * Der Test braucht eine echte Datenbank (Prisma). Er ist deshalb ein
 * Unit-Test mit eigener Connection und räumt seine Daten wieder auf.
 */

const prisma = new PrismaClient();
let integrity: AuditIntegrityService;

/**
 * kanzleiId bleibt null: das Feld ist nullable, und die Hash-Berechnung
 * haengt nicht daran. Eine erfundene UUID verletzt den FK auf kanzlei.
 */
const TEST_TAG = `hash-chain-test-${Date.now()}`;

function randomHex(bytes = 32): string {
  let out = '';
  for (let i = 0; i < bytes; i += 1) out += Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
  return out;
}

/** Legt einen Audit-Eintrag an und berechnet unmittelbar seinen Hash. */
async function createEntry(action: string, neuHash: boolean): Promise<{ id: string; entryHash: string | null; prevHash: string | null }> {
  const created = await prisma.auditLog.create({
    data: {
      kanzleiId: null,
      userId: null,
      action,
      entityType: 'HashChainTest',
      entityId: TEST_TAG,
      newState: { seq: action, nonce: randomHex(8) },
    },
    select: { id: true },
  });
  if (neuHash) await integrity.computeHashForEntry(created.id);
  const back = await prisma.auditLog.findUnique({ where: { id: created.id } });
  return { id: created.id, entryHash: back?.entryHash ?? null, prevHash: back?.prevHash ?? null };
}

beforeAll(async () => {
  integrity = new AuditIntegrityService(prisma as never);
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { entityId: TEST_TAG } });
  await prisma.$disconnect();
});

describe('Audit-Hash-Chain', () => {
  it('schreibt entryHash und prevHash tatsächlich in die Datenbank', async () => {
    const e = await createEntry('CREATE', true);
    expect(e.entryHash, 'entryHash muss persistiert sein — er war es nie').toMatch(/^[a-f0-9]{64}$/);
    expect(e.prevHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('verknüpft jeden Eintrag mit dem vorherigen (prevHash = entryHash des Vorgängers)', async () => {
    // KEIN Genesis voraussetzen: der Seed legt bereits Audit-Eintraege an,
    // der erste Test dieser Datei schreibt ebenso welche. Geprueft wird
    // ausschliesslich die Verkettung der beiden aufeinanderfolgenden
    // Eintraege — das ist die eigentliche Zusicherung.
    const first = await createEntry('FIRST', true);
    const second = await createEntry('SECOND', true);
    expect(
      second.prevHash,
      'Kette muss verkettet sein: prevHash == entryHash des Vorgaengers',
    ).toBe(first.entryHash);
  });

  it('erkennt eine nachträgliche Manipulation', async () => {
    const a = await createEntry('CHAIN_A', true);
    const b = await createEntry('CHAIN_B', true);
    expect(b.prevHash).toBe(a.entryHash);

    // Jemand ändert den Inhalt eines bereits verketteten Eintrags.
    await prisma.auditLog.update({
      where: { id: a.id },
      data: { newState: { seq: 'CHAIN_A', nonce: 'manipuliert' } },
    });

    const result = await integrity.verifyIntegrity({});
    // Der Status ist das entscheidende Signal: vor der Reparatur lieferte die
    // Kette dauerhaft PARTIAL (es waren gar keine Hashes gespeichert).
    // Nach der Manipulation muss sie BROKEN melden.
    expect(
      result.status,
      'Manipulation muss als BROKEN auffallen, nicht als OK',
    ).toBe('BROKEN');
    expect(result.brokenAt, 'gebrochene Stelle muss benannt werden').toBeDefined();
  });

  it('liefert bei vollstaendiger Kette ein konsistentes Ergebnis', async () => {
    const r = await integrity.verifyIntegrity({});
    // Gesamtstatus darf nicht PARTIAL sein — das war der Dauerzustand,
    // solange gar keine Hashes geschrieben wurden.
    expect(r.status).not.toBe('PARTIAL');
  });
});
