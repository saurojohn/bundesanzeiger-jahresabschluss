/* eslint-disable no-console */
/**
 * Backfill-Script für Audit-Hash-Chain (M4 Sprint 5)
 *
 * Setzt entryHash + prevHash für alle existierenden AuditLog-Einträge
 * (die vor der Schema-Migration keinen Hash hatten).
 *
 * Aufruf:
 *   cd backend && npx ts-node scripts/backfill-audit-hash-chain.ts
 *
 * Voraussetzung:
 *   - Schema-Migration 2026_09_25_m4_production_schema ist gelaufen
 *     (ALTER TABLE audit_log ADD COLUMN entryHash, prevHash)
 *   - DATABASE_URL gesetzt
 *
 * ## BEFUND 2026-10-20 (Nachtrag 66): Dieses Skript war **kaputt** — und
 * hätte bei Ausführung die Kette zerstört.
 *
 * Es hatte drei voneinander unabhängige Fehler. Jeder einzelne hätte
 * gereicht, die Kette zu brechen:
 *
 * 1. **Die Hash-Berechnung war eine Nachbau.**
 *    Das Skript serialisierte den Eintrag selbst — ohne rekursive
 *    Sortierung der Schlüssel, ohne Ausschluss von `entryHash`/`prevHash`/
 *    `sequenz` und ohne Ausschluss der veränderbaren Fremdschlüssel
 *    (`mandantId`, `userId`, `jahresabschlussId`, `kanzleiId`). Und ohne
 *    BigInt-Behandlung: `sequenz` ist BIGINT, `JSON.stringify` wirft
 *    darauf — das Skript wäre beim **ersten** Eintrag abgebrochen.
 *
 *    Und selbst wenn es gelaufen wäre: der Hash wäre ein **anderer** als
 *    der des Produktivcodes. Die Kette wäre BROKEN, und `verifyIntegrity()`
 *    hätte es gemeldet. (Nachtrag 54: „Wer eine Funktion zum Vergleich
 *    nachbaut, misst die Nachbildung.")
 *
 * 2. **Die Reihenfolge war `createdAt`, nicht `sequenz`.** Bei gleichen
 *    Zeitstempeln (bei einem Sammel-Import der Regelfall) ist die
 *    Reihenfolge nicht bestimmt — die Kette haengte dann an einem anderen
 *    Vorgänger als der Produktivcode.
 *
 * 3. **`prevHash` kam aus einer lokalen Variablen.** Der Idempotenz-Fall
 *    („WHERE entryHash IS NULL") haette dem ersten noch fehlenden Eintrag
 *    den GENESIS-Hash gegeben — statt des Hashes seines tatsaechlichen
 *    Vorgaengers.
 *
 * **Die Behebung:** Das Skript rechnet nicht mehr selbst. Es benutzt
 * `AuditIntegrityService.computeHashForEntry()` — dieselbe Funktion, die
 * der Produktivpfad benutzt. Eine zweite Implementierung kann nicht mehr
 * auseinanderlaufen.
 */
import { PrismaClient } from '@prisma/client';
import { AuditIntegrityService } from '../src/modules/audit/services/audit-integrity.service';

const prisma = new PrismaClient();

async function backfill(): Promise<void> {
  console.log('[Backfill] Starte Audit-Hash-Chain-Backfill...');

  const totalUnhashed = await prisma.auditLog.count({
    where: { entryHash: null },
  });
  console.log(`[Backfill] ${totalUnhashed} unhashed AuditLog-Einträge gefunden.`);

  if (totalUnhashed === 0) {
    console.log('[Backfill] Nichts zu tun — alle Einträge bereits gehasht.');
    return;
  }

  // **Der Produktivcode.** `computeHashForEntry()` sucht den Vorgänger
  // selbst in der Datenbank (`sequenz`, `kanzleiId`-gefiltert) und
  // serialisiert mit derselben kanonischen Form wie der Schreibpfad.
  const integrity = new AuditIntegrityService(prisma as never);

  // Reihenfolge: `sequenz` — dieselbe Totalordnung, die der Produktivpfad
  // verwendet. Nur so ist der Vorgänger eines Eintrags **schon** gehasht,
  // wenn der nächste drankommt.
  let processed = 0;
  while (true) {
    const next = await prisma.auditLog.findFirst({
      where: { entryHash: null },
      orderBy: [{ sequenz: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    if (!next) break;

    await integrity.computeHashForEntry(next.id);
    processed++;

    if (processed % 100 === 0) {
      console.log(
        `[Backfill] ${processed}/${totalUnhashed} Einträge verarbeitet...`,
      );
    }
  }

  // Gegenprobe: der Weg, den ein Auditor geht.
  const integrityResult = await integrity.verifyIntegrity();
  console.log(
    `[Backfill] Fertig: ${processed} AuditLog-Einträge gehasht. ` +
      `Integritätsprüfung: ${integrityResult.status} ` +
      `(${integrityResult.entriesChecked} Einträge geprüft).`,
  );
  if (integrityResult.status !== 'OK') {
    throw new Error(
      'Die Hash-Kette ist nach dem Backfill NICHT intakt — ' +
        `Status ${integrityResult.status}. Bitte NICHT als erfolgreich verbuchen.`,
    );
  }
}

backfill()
  .catch((err) => {
    console.error('[Backfill] Fehler:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
