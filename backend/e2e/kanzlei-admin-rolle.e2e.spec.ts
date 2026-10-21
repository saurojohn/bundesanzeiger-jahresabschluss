import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

/**
 * Die Admin-Rolle ist an die **Kanzlei** gebunden — an zwei weiteren
 * Stellen geprueft.
 *
 * BEFUND 2026-10-21 (Nachtrag 71): Der Defekt vom 2026-10-11 („Admin
 * IRGENDWO" statt „Admin **IN** dieser Kanzlei") war in vier Services
 * behoben worden — Subscription, API-Keys, Webhooks, Custom-Domain — mit
 * dem gemeinsamen Helfer `assertAdminInKanzlei()`. Zwei Stellen blieben
 * stehen:
 *
 * 1. `branding.service.ts` -> `assertKanzleiAccess()`
 *      "Admin IRGENDWO"  +  "hat einen Mandanten in der Ziel-Kanzlei"
 *    =  nicht "Admin in der Ziel-Kanzlei".
 *
 *      **Gemessen:** PATCH /api/branding/<Kanzlei B> -> HTTP 200, die
 *      `primaryColor` der Kanzlei B wurde von #123456 auf #ff0000 gesetzt.
 *      Das Branding ist die White-Label-Identitaet der Kanzlei (Logo,
 *      Farben, Custom-Domain) — der fremde Mandant sieht sie auf seinen
 *      Abschluessen.
 *
 * 2. `mandant.service.ts` -> `delete()` / `archivieren()`
 *      `assertMandantAccess()` laesst **eigene** Mandanten zu (jede Rolle),
 *      danach wurde nur noch „Admin IRGENDWO" geprueft. Das ist eine
 *      Rolleneskalation:
 *
 *      **Gemessen:** DELETE /api/mandant/<Aaa> -> HTTP 204, der Mandant ist
 *      geloescht — ausgefuehrt von einem STEUERBERATER, der dort nur
 *      Berater ist (und in einer anderen Kanzlei Admin).
 *
 * **Erst messen, dann behaupten:** die erste Branding-Messung endete mit
 * HTTP 402 ("Tarif Pilot enthaelt white-label-branding nicht") — das
 * **Tarif-Gate** stand vor der Rechtepruefung. Ohne eine PREMIUM-Kanzlei B
 * waere der Befund unbewiesen geblieben. Deshalb legt dieser Test eine
 * PREMIUM-Kanzlei an.
 *
 * **Gegenproben:** die erlaubten Wege muessen erlaubt bleiben — Branding und
 * Loeschen in der **eigenen** Admin-Kanzlei.
 */
const BASE = 'http://localhost:3000';

describe('Admin-Rolle ist an die Kanzlei gebunden (Nachtrag 71)', () => {
  const prisma = new PrismaClient();
  let token = '';
  /** Die Kanzlei des Seed (Kanzlei A) — dort ist der Admin. */
  let kanzleiAId = '';
  let kanzleiAOriginalColor = '';
  /** Kanzlei B — dort ist der Admin nur STEUERBERATER. */
  let kanzleiBId = '';
  let kanzleiBOriginalColor = '';
  /** Mandant der Kanzlei B, in dem der Admin nur STEUERBERATER ist. */
  let mandantBeraterId = '';
  /**
   * Ein **zweiter** solcher Mandant — fuer den Archiv-Test.
   *
   * Grund: die Negativproben muessen unabhaengig voneinander sein. Mit
   * einem Mandanten fuer beide Tests wurde der Archiv-Test unter der alten
   * Regel "Mandant nicht gefunden" (404) statt 403 — rot, aber aus dem
   * falschen Grund: der Loesch-Test hatte den Mandanten schon vernichtet.
   */
  let mandantBerater2Id = '';
  /** Frischer Mandant der Kanzlei A — der Admin verwaltet ihn. */
  let mandantAdminId = '';

  const login = async (email: string, pw = 'Demo123!') => {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: pw }),
    });
    const d = (await r.json()) as { accessToken: string };
    expect(d.accessToken, `Login ${email}`).toBeTruthy();
    return d;
  };

  const mandantAnlegen = async (firmenname: string, kanzleiId: string) => {
    const m = await prisma.mandant.create({
      data: {
        kanzleiId,
        firmenname,
        rechtsform: 'GmbH',
        adresse: { strasse: 'Rollweg 1', plz: '10999', ort: 'Muenchen', land: 'DE' },
        geschaeftsfuehrer: [
          { name: 'Test', geburtsdatum: '1970-01-01', anteilProzent: 100 },
        ],
        groessenklasse: 'KLEINST',
        publishChannel: 'PDF_DIRECT',
      },
      select: { id: true },
    });
    return m.id;
  };

  beforeAll(async () => {
    const ts = Date.now();
    const admin = await prisma.user.findFirstOrThrow({
      where: { email: 'kanzlei-admin@kanzlei.de' },
      select: { id: true },
    });

    // Kanzlei A = die Kanzlei des Seed. Der Admin ist dort KANZLEI_ADMIN.
    const seedKanzlei = await prisma.kanzlei.findFirstOrThrow({
      orderBy: { createdAt: 'asc' },
      select: { id: true, primaryColor: true },
    });
    kanzleiAId = seedKanzlei.id;
    kanzleiAOriginalColor = seedKanzlei.primaryColor ?? '';

    // Kanzlei B: PREMIUM (sonst steht das Tarif-Gate vor der Rechtepruefung),
    // und der Admin ist dort nur STEUERBERATER.
    const kanzleiB = await prisma.kanzlei.create({
      data: {
        name: `Rollen-Kanzlei-B-${ts}`,
        rechtsform: 'Einzelkanzlei',
        adresse: { strasse: 'Rollweg 1', plz: '10999', ort: 'Muenchen', land: 'DE' },
        primaryColor: '#123456',
        subscriptionTier: 'PREMIUM',
      },
      select: { id: true, primaryColor: true },
    });
    kanzleiBId = kanzleiB.id;
    kanzleiBOriginalColor = kanzleiB.primaryColor ?? '';

    mandantBeraterId = await mandantAnlegen(`Aaa-${ts}`, kanzleiB.id);
    mandantBerater2Id = await mandantAnlegen(`Ccc-${ts}`, kanzleiB.id);
    mandantAdminId = await mandantAnlegen(`Eigen-${ts}`, kanzleiAId);

    for (const mandantId of [mandantBeraterId, mandantBerater2Id]) {
      await prisma.userMandantRole.create({
        data: { userId: admin.id, mandantId, rolle: 'STEUERBERATER' },
      });
    }

    token = (await login('kanzlei-admin@kanzlei.de')).accessToken;
  });

  afterAll(async () => {
    // Die Farbe der Seed-Kanzlei zuruecksetzen — sonst sieht ein spaeterer
    // Test eine vom Test geaenderte Kanzlei.
    await prisma.kanzlei.update({
      where: { id: kanzleiAId },
      data: { primaryColor: kanzleiAOriginalColor },
    });
    await prisma.userMandantRole.deleteMany({
      where: { mandantId: { in: [mandantBeraterId, mandantBerater2Id] } },
    });
    await prisma.mandant.deleteMany({
      where: { id: { in: [mandantBeraterId, mandantBerater2Id, mandantAdminId] } },
    });
    if (kanzleiBId) {
      await prisma.kanzlei.deleteMany({ where: { id: kanzleiBId } });
    }
    await prisma.$disconnect();
  });

  const h = (mandantId?: string) => ({
    'content-type': 'application/json',
    authorization: `Bearer ${token}`,
    ...(mandantId ? { 'x-mandant-id': mandantId } : {}),
  });

  it('aendert das Branding einer fremden Kanzlei nicht', async () => {
    const res = await fetch(`${BASE}/api/branding/${kanzleiBId}`, {
      method: 'PATCH',
      headers: h(),
      body: JSON.stringify({ primaryColor: '#ff0000' }),
    });
    const body = await res.text();
    expect(
      res.status,
      'das Branding der Kanzlei, in der der User nur Berater ist, gehoert ihm ' +
        `nicht — Antwort: ${body.slice(0, 160)}`,
    ).toBe(403);

    const kanzlei = await prisma.kanzlei.findUnique({
      where: { id: kanzleiBId },
      select: { primaryColor: true },
    });
    expect(
      kanzlei?.primaryColor,
      'die Farbe der fremden Kanzlei darf sich nicht geaendert haben',
    ).toBe(kanzleiBOriginalColor);
  });

  it('loescht einen eigenen Mandanten nicht, in dem der User nur Berater ist', async () => {
    const res = await fetch(`${BASE}/api/mandant/${mandantBeraterId}`, {
      method: 'DELETE',
      headers: h(),
    });
    const body = await res.text();
    expect(
      res.status,
      'ein Loeschen ist eine KANZLEI_ADMIN-Aktion; ein STEUERBERATER darf ' +
        `sie nicht ausfuehren — Antwort: ${body.slice(0, 160)}`,
    ).toBe(403);

    const mandant = await prisma.mandant.findUnique({
      where: { id: mandantBeraterId },
      select: { id: true },
    });
    expect(mandant, 'der Mandant darf nicht geloescht sein').toBeTruthy();
  });

  it('archiviert einen eigenen Mandanten nicht, in dem der User nur Berater ist', async () => {
    const res = await fetch(`${BASE}/api/mandant/${mandantBerater2Id}/archivierung`, {
      method: 'PATCH',
      headers: h(),
      body: JSON.stringify({}),
    });
    const body = await res.text();
    expect(
      res.status,
      'das Archivieren ist eine KANZLEI_ADMIN-Aktion — ' +
        `Antwort: ${body.slice(0, 160)}`,
    ).toBe(403);

    const mandant = await prisma.mandant.findUnique({
      where: { id: mandantBerater2Id },
      select: { archiviertAt: true },
    });
    expect(mandant?.archiviertAt, 'der Mandant darf nicht archiviert sein').toBeNull();
  });

  // ===========================================================================
  // Gegenproben (positiv) — die erlaubten Wege muessen erlaubt bleiben.
  // ===========================================================================
  it('Gegenprobe: das Branding der eigenen Admin-Kanzlei bleibt aenderbar', async () => {
    const res = await fetch(`${BASE}/api/branding/${kanzleiAId}`, {
      method: 'PATCH',
      headers: h(),
      body: JSON.stringify({ primaryColor: '#0a0b0c' }),
    });
    const body = await res.text();
    expect(
      res.status,
      'der KANZLEI_ADMIN muss das Branding seiner eigenen Kanzlei aendern ' +
        `koennen — Antwort: ${body.slice(0, 160)}`,
    ).toBe(200);
  });

  it('Gegenprobe: der Mandant der eigenen Admin-Kanzlei bleibt loeschbar', async () => {
    const res = await fetch(`${BASE}/api/mandant/${mandantAdminId}`, {
      method: 'DELETE',
      headers: h(),
    });
    const body = await res.text();
    expect(
      res.status,
      'der KANZLEI_ADMIN muss einen Mandanten seiner eigenen Kanzlei loeschen ' +
        `koennen — Antwort: ${body.slice(0, 160)}`,
    ).toBe(204);
  });
});
