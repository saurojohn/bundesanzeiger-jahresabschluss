/**
 * Nachweis: die Audit-Hash-Kette bricht NICHT mehr, wenn mehrere
 * Einträge in derselben Millisekunde entstehen.
 *
 * Bugfix 2026-10-08. Die Kette war über `(createdAt, id)` verketten.
 * `id` ist eine ZUFALLS-UUID, die Verarbeitung läuft aber in
 * Einfügereihenfolge. Entstehen zwei Einträge in derselben
 * Millisekunde und hat der später eingefügte die kleinere UUID, findet
 * er den ersten nicht als Vorgänger und beginnt die Kette neu
 * (GENESIS). Das war die Ursache der sporadisch roten
 * `audit-chain`-e2e-Tests.
 *
 * Der Test legt 25 Einträge mit IDENTISCHEM createdAt an — genau das,
 * was ein Sammel-Import erzeugt — und verlangt eine lückenlose Kette.
 * Ohne `sequenz` schlägt er mit hoher Wahrscheinlichkeit fehl.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditIntegrityService } from './audit-integrity.service';

/**
 * Zufällige UUID v4. Der Test braucht IDs, deren Sortierung NICHT der
 * Einfügereihenfolge folgt — sonst prüft er nichts.
 */
function zufallsUuid(): string {
  const hex = (n: number): string =>
    Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
}

const ANZAHL = 25;
const suffix = () => Math.random().toString(36).slice(2, 8);

describe('Audit-Kette: gleicher Zeitstempel', () => {
  let prisma: PrismaService;
  let integrity: AuditIntegrityService;
  let kanzleiId: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    integrity = new AuditIntegrityService(prisma);
    const kanzlei = await prisma.kanzlei.create({
      data: {
        name: `Kette-gleicher-Zeitstempel ${suffix()}`,
        rechtsform: 'Einzelkanzlei',
        adresse: { strasse: 'Testweg 2', plz: '10999', ort: 'München', land: 'DE' },
      },
    });
    kanzleiId = kanzlei.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('hält die Kette über 25 Einträge mit IDENTISCHEM Zeitstempel', async () => {
    const ms = new Date('2026-10-08T20:00:00.000Z');

    for (let i = 0; i < ANZAHL; i += 1) {
      // createdAt wird bewusst ÜBERSCHRIEBEN: alle Einträge teilen
      // denselben Zeitstempel. Ohne eine von der Uhr unabhängige
      // Reihenfolge ist die Kette hier nicht bildbar.
      await prisma.$executeRawUnsafe(
        // Bezeichner GROSS schreiben: Postgres faltet unquoted
        // Spaltennamen auf Kleinschreibung, `kanzleiId` gibt es dort nicht.
        'INSERT INTO "audit_log" ("id","kanzleiId","mandantId","jahresabschlussId","userId","action","entityType","entityId","newState","ipAddress","userAgent","geoLocation","createdAt") VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7,$8,$9::jsonb,$10,$11,$12,$13::timestamp)',
        // ZUFÄLLIGE UUIDs — bewusst. Mit fortlaufenden UUIDs
        // (`...-000000000000`, `-000000000001`, …) stimmen
        // Zufallseintrag und Einfuegereihenfolge ueberein, und der Test
        // waere auch mit dem alten, kaputten Code gruen.
        //
        // Genau das ist hier passiert: der erste Negativprob-Versuch
        // war gruen, weil die Fixture zu „freundlich" war. Eine
        // Fixture, die den Fehler nicht auftreten laesst, macht den
        // Test wertlos.
        zufallsUuid(),
        kanzleiId,
        null, null, null,
        'UPDATE',
        'Bilanz',
        `stress-${i}`,
        JSON.stringify({ i }),
        null, 'test', null,
        ms,
      );
    }

    // Hashes berechnen lassen. Ohne AuditService.record() (das selbst
    // einfuegt) direkt ueber die Queue.
    const eintraege = await prisma.auditLog.findMany({
      where: { kanzleiId },
      orderBy: { createdAt: 'asc' },
    });
    expect(eintraege.length).toBe(ANZAHL);

    for (const e of eintraege) {
      await integrity.computeHashForEntry(e.id);
    }

    const ergebnis = await integrity.verifyIntegrity({ kanzleiId });
    expect(
      ergebnis.status,
      `Kette bei ${String(ANZAHL)} Einträgen mit identischem Zeitstempel: ${JSON.stringify(ergebnis)}`,
    ).toBe('OK');
    expect(ergebnis.entriesChecked).toBe(ANZAHL);

    // Und direkt nachgerechnet: jeder prevHash == entryHash des Vorgängers.
    const sortiert = await prisma.auditLog.findMany({
      where: { kanzleiId },
      orderBy: [{ sequenz: 'asc' }],
    });
    expect(sortiert.length).toBe(ANZAHL);
    const genesis = (AuditIntegrityService as unknown as { GENESIS_HASH: string })
      .GENESIS_HASH;
    expect(sortiert[0]!.prevHash).toBe(genesis);
    for (let i = 1; i < sortiert.length; i += 1) {
      expect(
        sortiert[i]!.prevHash,
        `Eintrag ${String(i)} haengt nicht am Vorgänger`,
      ).toBe(sortiert[i - 1]!.entryHash);
    }
    // Die Sequenz ist streng monoton — sie ist die Totalordnung.
    for (let i = 1; i < sortiert.length; i += 1) {
      expect(sortiert[i]!.sequenz > sortiert[i - 1]!.sequenz).toBe(true);
    }
  });
});