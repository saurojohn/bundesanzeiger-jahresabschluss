import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

/**
 * Der DATEV-Import schreibt **Buecher** — die Rolle muss auf dem Mandanten
 * der Datei gelten.
 *
 * BEFUND 2026-10-21 (Nachtrag 74): Der `RolesGuard` prueft
 * STEUERBERATER/KANZLEI_ADMIN auf dem **Kontext-Mandanten** (x-mandant-id);
 * der `DatevImportService` prueft nur den *Zugriff* auf den Mandanten der
 * Datei (`assertMandantAccess`). Zusammen belegten die beiden Pruefungen
 * nicht „darf in diesen Buechern schreiben".
 *
 * **Gemessen.** Eine Person, die in Mandant A (Demo GmbH) STEUERBERATER und
 * in Mandant B (Beispiel GmbH) nur WIRTSCHAFTSPRUEFER ist:
 *
 *     POST /api/datev-import/execute (Kontext = A) -> HTTP 201
 *     importedCount: 2, bilanzId: …, guvId: …
 *     Bilanzen in B: 1, GuV: 1
 *
 * Der Import hat die Buecher von Mandant B geschrieben — der Mandant, fuer
 * den dieselbe Person Wirtschaftspruefer ist. Das bricht die
 * Unabhaengigkeit nach IDW PS 880: **wer die Buecher schreibt, prueft sie
 * nicht.**
 *
 * **Gegenprobe:** ein STEUERBERATER des Mandanten muss weiterhin importieren
 * koennen — sonst waere die Kontrolle nur ein Produktschalter.
 */
const BASE = 'http://localhost:3000';

describe('DATEV-Import: die Rolle muss auf dem Mandanten der Datei gelten (Nachtrag 74)', () => {
  const prisma = new PrismaClient();
  let mandantAId = '';
  let mandantBId = '';
  let personId = '';
  let personEmail = '';
  let jahr = 0;
  /** Zweites Jahr — fuer die Gegenprobe (siehe dort). */
  let jahrGegenprobe = 0;

  const businessCsv = (jahr: number) =>
    [
      '"Formatname";"Version";"Berater";"Mandant";"WJ-Beginn";"WJ-Ende";"Sachkontenlaenge";"Datum-von";"Datum-bis";"Bezeichnung";"Diktat";"Buchungstyp";"Rechnungslegungszweck"',
      `"EXTF_Buchungsstapel";"12";"12345";"67890";"01.01.${jahr}";"31.12.${jahr}";"4";"01.01.${jahr}";"31.12.${jahr}";"Messung";"Buchhaltung";"1";"00"`,
      '"Umsatz";"SH";"WKZ";"Kurs";"Basis";"BWKZ";"Konto";"Gegenkonto";"BUSchluessel";"Belegdatum";"Belegfeld1";"Belegfeld2";"Skonto";"Buchungstext";"Postensperre";"Adressnummer";"PartnerBLZ"',
      '"1000,00";"S";"EUR";"";"";"";"1800";"4400";"0";"3112";"MESS";"";"";"Bank an Erloes";"0";"";""',
    ].join('\r\n');

  const login = async (email: string) => {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'Demo123!' }),
    });
    const d = (await r.json()) as { accessToken: string };
    expect(d.accessToken, `Login ${email}`).toBeTruthy();
    return d.accessToken;
  };

  beforeAll(async () => {
    mandantAId = (
      await prisma.mandant.findFirstOrThrow({
        where: { firmenname: 'Demo GmbH' },
        select: { id: true },
      })
    ).id;
    mandantBId = (
      await prisma.mandant.findFirstOrThrow({
        where: { firmenname: 'Beispiel GmbH' },
        select: { id: true },
      })
    ).id;

    personEmail = `mess-datev-${Date.now()}@kanzlei.de`;
    const person = await prisma.user.create({
      data: {
        email: personEmail,
        passwordHash: await bcrypt.hash('Demo123!', 10),
        vorname: 'Mess',
        nachname: 'Importierer',
        globalRole: 'USER',
        isActive: true,
      },
      select: { id: true },
    });
    personId = person.id;
    await prisma.userMandantRole.create({
      data: { userId: personId, mandantId: mandantAId, rolle: 'STEUERBERATER' },
    });
    await prisma.userMandantRole.create({
      data: { userId: personId, mandantId: mandantBId, rolle: 'WIRTSCHAFTSPRUEFER' },
    });

    // Freie Jahre — die Belegung durch andere Specs ist nicht vorhersehbar.
    //
    // **Zwei** Jahre, einer je Test: der Import legt Bilanz und GuV an,
    // und der Jahresabschluss hat einen Unique-Constraint. Mit einem
    // gemeinsamen Jahr laeuft die Gegenprobe im Negativproben-Lauf auf
    // "existiert bereits Bilanz/GuV" (400) — rot, aber aus dem falschen
    // Grund.
    for (let j = 2050; j <= 2099; j++) {
      const b = await prisma.bilanz.count({ where: { mandantId: mandantBId, geschaeftsjahr: j } });
      const g = await prisma.guV.count({ where: { mandantId: mandantBId, geschaeftsjahr: j } });
      if (b + g === 0) {
        if (!jahr) jahr = j;
        else { jahrGegenprobe = j; break; }
      }
    }
    expect(jahr, 'ein freies Geschaeftsjahr finden').toBeGreaterThan(0);
    expect(jahrGegenprobe, 'ein zweites freies Geschaeftsjahr finden').toBeGreaterThan(0);
  });

  afterAll(async () => {
    for (const j of [jahr, jahrGegenprobe]) {
      if (!j) continue;
      await prisma.bilanz.deleteMany({ where: { mandantId: mandantBId, geschaeftsjahr: j } });
      await prisma.guV.deleteMany({ where: { mandantId: mandantBId, geschaeftsjahr: j } });
    }
    if (personId) {
      await prisma.userMandantRole.deleteMany({ where: { userId: personId } });
      await prisma.user.deleteMany({ where: { id: personId } });
    }
    await prisma.$disconnect();
  });

  it('schreibt keine Buchhaltungsdaten in einen Mandanten ohne Berater-Rolle', async () => {
    const token = await login(personEmail);
    const res = await fetch(`${BASE}/api/datev-import/execute`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        // Der Kontext zeigt auf Mandant A, in dem die Person STEUERBERATER ist.
        'x-mandant-id': mandantAId,
      },
      body: JSON.stringify({
        csvBase64: Buffer.from(businessCsv(jahr)).toString('base64'),
        mandantId: mandantBId,
        geschaeftsjahr: jahr,
        skrPlan: 'SKR04',
      }),
    });
    const body = await res.text();
    expect(
      res.status,
      'wer fuer Mandant B nur Wirtschaftspruefer ist, darf dort keine Buecher ' +
        `schreiben — Antwort: ${body.slice(0, 200)}`,
    ).toBe(403);

    const bilanzen = await prisma.bilanz.count({
      where: { mandantId: mandantBId, geschaeftsjahr: jahr },
    });
    const guvs = await prisma.guV.count({
      where: { mandantId: mandantBId, geschaeftsjahr: jahr },
    });
    expect(bilanzen + guvs, 'es darf keine Bilanz und keine GuV entstanden sein').toBe(0);
  });

  it('Gegenprobe: der Steuerberater des Mandanten darf weiterhin importieren', async () => {
    // steuerberater@kanzlei.de ist STEUERBERATER in beiden Kanzleien — der
    // erlaubte Weg muss offen bleiben.
    const token = await login('steuerberater@kanzlei.de');
    const res = await fetch(`${BASE}/api/datev-import/execute`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'x-mandant-id': mandantBId,
      },
      body: JSON.stringify({
        csvBase64: Buffer.from(businessCsv(jahrGegenprobe)).toString('base64'),
        mandantId: mandantBId,
        geschaeftsjahr: jahrGegenprobe,
        skrPlan: 'SKR04',
      }),
    });
    const body = await res.text();
    expect(
      res.status,
      'der Steuerberater des Mandanten muss importieren koennen — ' +
        `Antwort: ${body.slice(0, 200)}`,
    ).toBe(201);

    const bilanzen = await prisma.bilanz.count({
      where: { mandantId: mandantBId, geschaeftsjahr: jahrGegenprobe },
    });
    expect(bilanzen, 'die importierte Bilanz muss existieren').toBe(1);
  });
});
