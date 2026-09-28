/* eslint-disable no-console */
/**
 * Backfill-Script für Audit-Hash-Chain (M4 Sprint 5)
 *
 * Setzt entryHash + prevHash für alle existierenden AuditLog-Einträge
 * (die vor der Schema-Migration keinen Hash hatten).
 *
 * Algorithmus:
 *   - Hole ältesten unhashed Eintrag (Genesis-Eintrag)
 *   - Genesis-PrevHash = "0".repeat(64)
 *   - Berechne entryHash = SHA-256(prevHash + serialize(entry))
 *   - Update mit entryHash + prevHash
 *   - Nächster Eintrag: prevHash = entryHash vom vorherigen
 *
 * Idempotenz:
 *   - WHERE "entryHash" IS NULL — überspringt bereits gehashte Einträge
 *
 * Aufruf:
 *   cd backend && npx ts-node scripts/backfill-audit-hash-chain.ts
 *
 * Voraussetzung:
 *   - Schema-Migration 2026_09_25_m4_production_schema ist gelaufen
 *     (ALTER TABLE audit_log ADD COLUMN entryHash, prevHash)
 *   - DATABASE_URL gesetzt
 */

import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';

const prisma = new PrismaClient();
const GENESIS_HASH = '0'.repeat(64);

function serializeForHashing(entry: unknown): string {
  return JSON.stringify(entry, (_key, value) => {
    if (value instanceof Date) return value.toISOString();
    if (value === null) return null;
    return value;
  });
}

async function backfill() {
  console.log('[Backfill] Starte Audit-Hash-Chain-Backfill...');

  // Phase 1: Anzahl unhashed ermitteln
  const totalUnhashed = await prisma.auditLog.count({
    where: { entryHash: null },
  });
  console.log(`[Backfill] ${totalUnhashed} unhashed AuditLog-Einträge gefunden.`);

  if (totalUnhashed === 0) {
    console.log('[Backfill] Nichts zu tun — alle Einträge bereits gehasht.');
    return;
  }

  // Phase 2: Iteriere chronologisch
  let processed = 0;
  let prevHash = GENESIS_HASH;

  // Hole chronologisch alle unhashed Einträge (ID + createdAt + body)
  // Wir nutzen Cursor-Pattern: nach jedem Update den nächsten ältesten holen
  while (true) {
    const next = await prisma.auditLog.findFirst({
      where: { entryHash: null },
      orderBy: { createdAt: 'asc' },
    });
    if (!next) break;

    const entryString = serializeForHashing(next);
    const entryHash = crypto
      .createHash('sha256')
      .update(prevHash + entryString)
      .digest('hex');

    await prisma.auditLog.update({
      where: { id: next.id },
      data: { entryHash, prevHash },
    });

    prevHash = entryHash;
    processed++;

    if (processed % 100 === 0) {
      console.log(
        `[Backfill] ${processed}/${totalUnhashed} Einträge verarbeitet...`,
      );
    }
  }

  console.log(
    `[Backfill] Fertig: ${processed} AuditLog-Einträge gehasht. ` +
      `Chain-Länge: ${processed}. ` +
      `Letzter entryHash: ${prevHash.substring(0, 16)}...`,
  );
}

backfill()
  .catch((err) => {
    console.error('[Backfill] Fehler:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });