import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { AuditIntegrityService } from '../src/modules/audit/services/audit-integrity.service';

/**
 * Backfill der Audit-Hash-Chain.
 *
 * BEFUND 2026-10-20 (Nachtrag 66): Das Backfill-Skript war **kaputt** —
 * und haette bei Ausfuehrung die Kette zerstoert. Drei unabhaengige
 * Fehler, jeder einzelne haette gereicht:
 *
 *   1. Die Hash-Berechnung war eine **Nachbau** des Produktivcodes: ohne
 *      rekursive Sortierung, ohne Ausschluss der Hash- und
 *      Fremdschluessel-Felder — und ohne BigInt-Behandlung (`sequenz` ist
 *      BIGINT). `JSON.stringify` wirft darauf; das Skript waere beim
 *      **ersten** Eintrag abgebrochen. Selbst wenn es durchgelaufen waere,
 *      waere der Hash ein **anderer** als der des Produktivpfads — die
 *      Kette waere BROKEN.
 *   2. Die Reihenfolge war `createdAt` statt `sequenz` — bei gleichen
 *      Zeitstempeln haengt die Kette an einem anderen Vorgaenger als im
 *      Produktivpfad.
 *   3. `prevHash` kam aus einer lokalen Variablen statt aus dem
 *      tatsaechlichen Vorgaenger — der Idempotenz-Fall haette den ersten
 *      fehlenden Eintrag an den GENESIS-Hash gehaengt.
 *
 * TODO-8.4 verlangt, das Skript auf der Produktionsdatenbank zu **fuehren**.
 * Vorher war das nicht moeglich — es haette genau das kaputt gemacht, was es
 * heilen sollte.
 *
 * ## Der Test
 *
 * 1. Drei Audit-Eintraege **ohne** Hash direkt schreiben — genau der Zustand,
 *    den die Schema-Migration hinterlaesst.
 * 2. Das Skript **als Subprozess** laufen lassen — so, wie ein Operator es
 *    aufruft. Kein Nachbau im Test, kein Aufruf einer exportierten Funktion.
 * 3. Die Kette mit dem **Produktivcode** pruefen (`verifyIntegrity()`).
 *
 * Der Test prueft nicht das Skript, sondern das Ergebnis: nach dem Lauf muss
 * die Kette intakt sein.
 */
describe('Backfill der Audit-Hash-Chain (Nachtrag 66)', () => {
  const prisma = new PrismaClient();
  const integrity = new AuditIntegrityService(prisma as never);
  /** Die drei Eintraege, die der Test ohne Hash anlegt. */
  const angelegt: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();

    // Drei Eintraege ohne Hash — der Zustand vor der Schema-Migration.
    for (let i = 0; i < 3; i++) {
      const eintrag = await prisma.auditLog.create({
        data: {
          action: 'CREATE',
          entityType: 'BackfillTest',
          entityId: `backfill-${Date.now()}-${i}`,
          newState: { i, zweck: 'Backfill-Test' },
          ipAddress: '127.0.0.1',
          userAgent: 'backfill-test',
        },
        select: { id: true },
      });
      angelegt.push(eintrag.id);
    }
  });

  afterAll(async () => {
    // Die Testeintraege wieder entfernen — sie gehoeren nicht in den
    // Audit-Trail eines Mandanten.
    if (angelegt.length > 0) {
      await prisma.auditLog.deleteMany({ where: { id: { in: angelegt } } });
    }
    await prisma.$disconnect();
  });

  it('hasht die uebrigen Eintraege so, dass die Kette danach intakt ist', async () => {
    // Vorher: die drei Testeintraege haben keinen Hash.
    const vorher = await prisma.auditLog.count({
      where: { id: { in: angelegt }, entryHash: null },
    });
    expect(vorher, 'die Fixture muss ungehashte Eintraege hinterlassen').toBe(3);

    // Das Skript laufen lassen — als Subprozess, wie ein Operator es tut.
    let ausgabe = '';
    let exitcode = 0;
    try {
      ausgabe = execFileSync(
        'npx',
        ['ts-node', 'scripts/backfill-audit-hash-chain.ts'],
        { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] },
      );
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; status?: number };
      ausgabe = `${e.stdout ?? ''}${e.stderr ?? ''}`;
      exitcode = e.status ?? 1;
    }

    expect(
      exitcode,
      `das Backfill-Skript muss durchlaufen:\n${ausgabe.slice(0, 2000)}`,
    ).toBe(0);
    expect(ausgabe, 'das Skript muss die Integritaet selbst pruefen').toContain(
      'Integritätsprüfung: OK',
    );

    // Und das Ergebnis: **alle** Eintraege sind gehasht ...
    const nachher = await prisma.auditLog.count({
      where: { id: { in: angelegt }, entryHash: null },
    });
    expect(nachher, 'nach dem Backfill darf kein Eintrag ohne Hash bleiben').toBe(0);

    // ... und die Kette ist intakt. Geprueft mit dem Produktivcode.
    const ergebnis = await integrity.verifyIntegrity();
    expect(
      ergebnis.status,
      `die Kette muss nach dem Backfill intakt sein: ${JSON.stringify(ergebnis)}`,
    ).toBe('OK');
  });
});
