import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

/**
 * Das Vier-Augen-Prinzip braucht **zwei Dinge**, nicht eines:
 *
 *   1. Zwei verschiedene Personen (nicht der Pruefende selbst) — das war
 *      seit 2026-10-07 erzwungen (`freigegebenVonId`).
 *   2. Beide muessen fuer den Mandanten bestellte Wirtschaftspruefer sein.
 *      Das war **nicht** erzwungen: die Rollenpruefung sah „WP irgendwo".
 *
 * BEFUND 2026-10-21 (Nachtrag 72): `wp-pruefung.service.ts` und
 * `wp-notiz.service.ts` prueften:
 *
 *     user.mandanten.some((m) => m.rolle === 'WIRTSCHAFTSPRUEFER')  // "WP IRGENDWO"
 *     ...
 *     assertMandantAccess(mandantId, user)                          // irgendeine Rolle
 *
 * Zusammen belegen die beiden Pruefungen **nicht** „WP fuer diesen
 * Mandanten".
 *
 * **Gemessen.** Zwei Personen, beide WP in Mandant A (Demo GmbH) und nur
 * STEUERBERATER in Mandant B (Beispiel GmbH):
 *
 *     POST /api/wp/pruefungs              -> HTTP 201  (Pruefung fuer B angelegt)
 *     POST /api/wp/pruefungen/:id/finalize -> HTTP 200  (status APPROVED)
 *     Status der Bilanz in Mandant B danach: APPROVED
 *
 * Die Bilanz eines Mandanten wurde also von zwei Personen freigegeben, die
 * fuer diesen Mandanten nicht bestellte Wirtschaftspruefer sind — dort sind
 * sie die Ersteller. Das ist genau das, was IDW PS 880 verhindern soll.
 *
 * **Die Regel jetzt:** die WIRTSCHAFTSPRUEFER-Rolle muss auf dem Mandanten
 * der geprueften Bilanz gelten (`common/utils/mandant-rolle.ts`).
 *
 * **Gegenprobe:** ein echter WP des Mandanten B muss weiterhin pruefen und
 * freigeben koennen — die zweite Person der Vier-Augen-Kontrolle.
 */
const BASE = 'http://localhost:3000';

describe('Vier-Augen-Prinzip: der Pruefer muss WP des Mandanten sein (Nachtrag 72)', () => {
  const prisma = new PrismaClient();
  /** Mandant A — hier ist die Person WP. */
  let mandantAId = '';
  /** Mandant B — hier ist dieselbe Person nur STEUERBERATER. */
  let mandantBId = '';
  /** Die „fremde" Person: WP in A, nur Berater in B. */
  let personId = '';
  let personEmail = '';
  /** Die Rolle WIRTSCHAFTSPRUEFER, die P1 temporaer in Mandant A bekommt. */
  let p1UserId = '';
  let bilanzId = '';
  let jahr = 0;
  /**
   * Die IDs der **selbst angelegten** Rollen.
   *
   * BEFUND 2026-10-21: Die erste Fassung raeumte mit
   * `deleteMany({ mandantId: { in: [A, B] } })` auf — das loeschte die
   * **Seed-Rollen** des `steuerberater@kanzlei.de` mit (er ist dort
   * STEUERBERATER). Die Folge war nicht im eigenen Test zu sehen: vier
   * spaetere Specs fanden „Demo GmbH" nicht mehr in der Session, 16 Tests
   * wurden uebersprungen. **Aufraeumen loescht genau das, was der Test
   * angelegt hat — nichts sonst.**
   */
  const angelegteRollenIds: string[] = [];

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

    // Eine eigene Person: WP in Mandant A, nur STEUERBERATER in Mandant B.
    personEmail = `mess-wp-p2-${Date.now()}@kanzlei.de`;
    const person = await prisma.user.create({
      data: {
        email: personEmail,
        passwordHash: await bcrypt.hash('Demo123!', 10),
        vorname: 'Mess',
        nachname: 'Pruefer',
        globalRole: 'USER',
        isActive: true,
      },
      select: { id: true },
    });
    personId = person.id;
    angelegteRollenIds.push(
      (
        await prisma.userMandantRole.create({
          data: { userId: personId, mandantId: mandantAId, rolle: 'WIRTSCHAFTSPRUEFER' },
        })
      ).id,
    );
    angelegteRollenIds.push(
      (
        await prisma.userMandantRole.create({
          data: { userId: personId, mandantId: mandantBId, rolle: 'STEUERBERATER' },
        })
      ).id,
    );

    // P1 = der Seed-Berater, der in Mandant A temporaer WP ist.
    const p1 = await prisma.user.findFirstOrThrow({
      where: { email: 'steuerberater@kanzlei.de' },
      select: { id: true },
    });
    p1UserId = p1.id;
    angelegteRollenIds.push(
      (
        await prisma.userMandantRole.create({
          data: { userId: p1UserId, mandantId: mandantAId, rolle: 'WIRTSCHAFTSPRUEFER' },
        })
      ).id,
    );

    // Eine Bilanz in Mandant B (P1 ist dort STEUERBERATER und darf anlegen).
    jahr = 2050 + (Date.now() % 40);
    const token = await login('steuerberater@kanzlei.de');
    const res = await fetch(`${BASE}/api/bilanz?mandantId=${mandantBId}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'x-mandant-id': mandantBId,
      },
      body: JSON.stringify({
        mandantId: mandantBId,
        geschaeftsjahr: jahr,
        positionen: [
          { seite: 'AKTIVA', kontonummer: 'B.IV.', bezeichnung: 'Kasse', betragAktuell: 1000, reihenfolge: 1 },
        ],
      }),
    });
    const raw = await res.text();
    let parsed: { bilanz?: { id?: string } } = {};
    try { parsed = JSON.parse(raw); } catch { /* unten wird der Fehler sichtbar */ }
    bilanzId = parsed.bilanz?.id ?? '';
    expect(bilanzId, `Bilanz in Mandant B anlegen: ${raw.slice(0, 160)}`).toBeTruthy();
  });

  afterAll(async () => {
    if (bilanzId) await prisma.bilanz.deleteMany({ where: { id: bilanzId } });
    await prisma.userMandantRole.deleteMany({ where: { id: { in: angelegteRollenIds } } });
    if (personId) await prisma.user.deleteMany({ where: { id: personId } });
    await prisma.$disconnect();
  });

  it('startet keine WP-Pruefung fuer einen Mandanten, in dem die Person kein WP ist', async () => {
    const token = await login(personEmail);
    const res = await fetch(`${BASE}/api/wp/pruefungen`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        // Der Kontext zeigt auf Mandant A, in dem die Person WP ist —
        // damit sind Guard und RolesGuard zufrieden. Das Ziel ist B.
        'x-mandant-id': mandantAId,
      },
      body: JSON.stringify({ bilanzId, zusammenfassung: 'Pruefung Mandant B' }),
    });
    const body = await res.text();
    expect(
      res.status,
      'eine Person, die fuer Mandant B kein Wirtschaftspruefer ist, darf dort ' +
        `keine Pruefung starten — Antwort: ${body.slice(0, 180)}`,
    ).toBe(403);

    const pruefungen = await prisma.wPPruefungsAbschluss.count({ where: { bilanzId } });
    expect(pruefungen, 'es darf keine Pruefung entstanden sein').toBe(0);
  });

  it('gibt keine Pruefung frei, die fuer einen Mandanten ohne WP-Rolle laeuft', async () => {
    // Die Pruefung stammt von einem echten WP des Mandanten B (wp2@kanzlei.de)
    // — die Selbst-Freigabe-Sperre greift also nicht, und der Test prueft
    // ausschliesslich die Rollenfrage.
    const wp2 = await prisma.user.findFirstOrThrow({
      where: { email: 'wp2@kanzlei.de' },
      select: { id: true },
    });
    const pruefung = await prisma.wPPruefungsAbschluss.create({
      data: { bilanzId, wpUserId: wp2.id, status: 'IN_PROGRESS' },
      select: { id: true },
    });

    const token = await login(personEmail);
    const res = await fetch(`${BASE}/api/wp/pruefungen/${pruefung.id}/finalize`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'x-mandant-id': mandantAId,
      },
      body: JSON.stringify({ status: 'APPROVED', zusammenfassung: 'Freigabe durch Zweitpruefer' }),
    });
    const body = await res.text();
    expect(
      res.status,
      'eine Person, die fuer Mandant B kein Wirtschaftspruefer ist, darf die ' +
        `Pruefung nicht freigeben — Antwort: ${body.slice(0, 180)}`,
    ).toBe(403);

    const bilanz = await prisma.bilanz.findUnique({
      where: { id: bilanzId },
      select: { status: true },
    });
    expect(
      bilanz?.status,
      'die Bilanz darf nicht auf APPROVED gehen — sie ist der Validierungs-Marker',
    ).not.toBe('APPROVED');
  });

  it('Gegenprobe: ein echter WP des Mandanten darf weiterhin freigeben', async () => {
    // wp@kanzlei.de ist WP in Mandant B und hat die Pruefung nicht selbst
    // durchgefuehrt (die stammt von wp2) — der Vier-Augen-Weg bleibt offen.
    const wp2 = await prisma.user.findFirstOrThrow({
      where: { email: 'wp2@kanzlei.de' },
      select: { id: true },
    });
    const wp = await prisma.user.findFirstOrThrow({
      where: { email: 'wp@kanzlei.de' },
      select: { id: true },
    });
    const pruefung = await prisma.wPPruefungsAbschluss.create({
      data: { bilanzId, wpUserId: wp2.id, status: 'IN_PROGRESS' },
      select: { id: true },
    });

    const token = await login('wp@kanzlei.de');
    const res = await fetch(`${BASE}/api/wp/pruefungen/${pruefung.id}/finalize`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'x-mandant-id': mandantBId,
      },
      body: JSON.stringify({ status: 'APPROVED', zusammenfassung: 'Freigabe durch WP des Mandanten' }),
    });
    const body = await res.text();
    expect(
      res.status,
      'der zweite Wirtschaftspruefer des Mandanten muss freigeben koennen — ' +
        `Antwort: ${body.slice(0, 180)}`,
    ).toBe(200);

    const bilanz = await prisma.bilanz.findUnique({
      where: { id: bilanzId },
      select: { status: true },
    });
    expect(bilanz?.status, 'die Bilanz wird freigegeben').toBe('APPROVED');
  });
});
