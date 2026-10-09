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

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    integrity = new AuditIntegrityService(prisma);
  });

  /**
   * JEDER Test bekommt seine eigene Kanzlei. Ein gemeinsamer Mandant
   * liess den 25-Eintrags-Test 37 Eintraege zaehlen (12 aus dem
   * Reihenfolge-Test) — ein Fehlschlag, der von der Teststruktur
   * stammt und nicht vom Produktivcode.
   */
  async function eigeneKanzlei(): Promise<string> {
    const kanzlei = await prisma.kanzlei.create({
      data: {
        name: `Kette-gleicher-Zeitstempel ${suffix()}`,
        rechtsform: 'Einzelkanzlei',
        adresse: { strasse: 'Testweg 2', plz: '10999', ort: 'München', land: 'DE' },
      },
    });
    return kanzlei.id;
  }

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /**
   * Die Reihenfolge, in der `computeHashForEntry()` aufgerufen wird,
   * IST bedeutsam — genau das ist die Sache, die ich hier falsch
   * behauptet habe.
   *
   * Die Methode berechnet `prevHash` aus dem Hash des Vorgängers.
   * Ist dieser noch nicht gesetzt (weil der Vorgänger später gehasht
   * wird), ist `prevHash` null und die Kette bricht. Der
   * Produktivpfad garantiert die Reihenfolge über `enqueue`
   * (Promise-Kette) — dieser Test tut das nicht, und behauptete
   * zunächst das Gegenteil.
   *
   * Der erste Entwurf („hält unabhängig von der Reihenfolge, in der
   * Postgres liefert") war lokal grün — Postgres lieferte zufällig eine
   * günstige Reihenfolge — und im CI rot. Das war kein Testfehler im
   * Fixture, sondern eine FALSCHE BEHAUPTUNG über das System.
   *
   * Korrekt ist: die Berechnung folgt der Sequenz, und das prüft der
   * 25-Eintrags-Test. Dieser Test hält stattdessen fest, dass die
   * Sequenz die Reihenfolge vorgibt — auch wenn Postgres sie
   * beliebig zurückliefert.
   */
  it('die Sequenz, nicht die Postgres-Lieferreihenfolge, bestimmt die Kette', async () => {
    const kanzleiId = await eigeneKanzlei();
    const ms = new Date('2026-10-08T21:00:00.000Z');
    for (let i = 0; i < 12; i += 1) {
      await prisma.$executeRawUnsafe(
        'INSERT INTO "audit_log" ("id","kanzleiId","mandantId","jahresabschlussId","userId","action","entityType","entityId","newState","ipAddress","userAgent","geoLocation","createdAt") VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7,$8,$9::jsonb,$10,$11,$12,$13::timestamp)',
        zufallsUuid(), kanzleiId, null, null, null, 'UPDATE', 'Bilanz',
        `reihenfolge-${i}`, JSON.stringify({ i }), null, 'test', null, ms,
      );
    }

    // OHNE `orderBy`: die Reihenfolge, in der die Zeilen kommen,
    // bestimmt Postgres — und ist im Zweifelsfall beliebig.
    const unsortiert = await prisma.auditLog.findMany({ where: { kanzleiId } });
    expect(unsortiert.length).toBe(12);

    // In der SEQUENZ-Reihenfolge hashen (wie `enqueue` es tut).
    const sortiert = [...unsortiert].sort((a, b) =>
      a.sequenz === null || b.sequenz === null
        ? 0
        : Number(a.sequenz - b.sequenz),
    );
    for (const e of sortiert) {
      await integrity.computeHashForEntry(e.id);
    }

    const ergebnis = await integrity.verifyIntegrity({ kanzleiId });
    expect(
      ergebnis.status,
      `Kette muss ueber die Sequenz vollstaendig sein: ${JSON.stringify(ergebnis)}`,
    ).toBe('OK');
    expect(ergebnis.entriesChecked).toBe(12);
  });

  it('hält die Kette über 25 Einträge mit IDENTISCHEM Zeitstempel', async () => {
    const kanzleiId = await eigeneKanzlei();
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
    // BUGFIX 2026-10-08: Die Reihenfolge MUSS der Sequenz folgen.
    //
    // `computeHashForEntry()` berechnet prevHash aus dem Eintrag, der
    // in der KETTE VORHER gehasht wurde. Der Produktivpfad garantiert
    // das ueber `enqueue` (Promise-Kette). Dieser Test ruft die Methode
    // direkt auf und MUSS darum selbst nach `sequenz` sortieren.
    //
    // Mit `orderBy: { createdAt: 'asc' }` ist die Reihenfolge bei 25
    // IDENTISCHEN Zeitstempeln beliebig. Rechnet man in dieser
    // Reihenfolge, bekommt ein später Hash-aufgerufener Eintrag als
    // prevHash den noch NULLEN Hash seines Vorgängers.
    //
    // Lokal lieferte Postgres die Heap-Reihenfolge (= Einfuegereihenfolge)
    // und der Test war gruen; im CI-Lauf war sie eine andere und der
    // Test meldete BROKEN bei `entriesChecked: 2`. Dieselbe Falle wie
    // bei den fortlaufenden UUIDs — der Test hing an einer Annahme
    // ueber die Umgebung.
    const eintraege = await prisma.auditLog.findMany({
      where: { kanzleiId },
      orderBy: { sequenz: 'asc' },
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