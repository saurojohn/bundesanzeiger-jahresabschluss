import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

/**
 * Die Tarifgrenze gilt fuer **jeden** Schreibpfad einer Premium-Funktion —
 * nicht nur fuer die, an denen sie zuerst eingebaut wurde.
 *
 * BEFUND 2026-10-22 (Nachtrag 80): `branding.service.ts` ->
 * `updateBranding()` pruefte den Tarif fuer die Farben
 * (`white-label-branding`) und fuer die Custom-Domain (`custom-domain`).
 * Der **Logo-Upload** pruefte gar nichts:
 *
 *     PATCH /api/branding/:id  {primaryColor} -> HTTP 402  (Gate wirkt)
 *     POST  /api/branding/:id/logo              -> HTTP 200  (kein Gate)
 *
 * Das Logo landet als WORM-Objekt (zehn Jahre Aufbewahrung) und wird ueber
 * `GET /api/branding/:id/logo/blob` ausgeliefert.
 */
const BASE = 'http://localhost:3000';
/** 1x1 Pixel PNG. */
const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('Tarifgrenze: White-Label gilt fuer jeden Schreibpfad (Nachtrag 80)', () => {
  const prisma = new PrismaClient();
  let kanzleiId = '';
  let kanzleiName = '';
  let originalTier: string | null = null;
  let token = '';

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

  const headers = async () => ({
    'content-type': 'application/json',
    authorization: `Bearer ${token}`,
    'x-mandant-id': (
      await prisma.mandant.findFirstOrThrow({
        where: { firmenname: 'Demo GmbH' },
        select: { id: true },
      })
    ).id,
  });

  const tariffSetzen = async (tier: string) => {
    await prisma.kanzlei.update({ where: { id: kanzleiId }, data: { subscriptionTier: tier } });
  };

  const logoHochladen = async () => {
    const res = await fetch(`${BASE}/api/branding/${kanzleiId}/logo`, {
      method: 'POST',
      headers: await headers(),
      body: JSON.stringify({
        logoBase64: PNG_1PX,
        mimeType: 'image/png',
        filename: 'logo.png',
      }),
    });
    return { status: res.status, text: await res.text() };
  };

  beforeAll(async () => {
    const kanzlei = await prisma.kanzlei.findFirstOrThrow({
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, subscriptionTier: true },
    });
    kanzleiId = kanzlei.id;
    kanzleiName = kanzlei.name;
    originalTier = kanzlei.subscriptionTier;
    token = await login('kanzlei-admin@kanzlei.de');
  });

  afterAll(async () => {
    // Das Logo ist ein WORM-Objekt (unveraenderlich) — die *Referenz* in der
    // Datenbank wird zurueckgesetzt, das Objekt bleibt (GoBD).
    await prisma.kanzlei.update({
      where: { id: kanzleiId },
      data: { logoUrl: null, logoWormKey: null, subscriptionTier: originalTier },
    });
    await prisma.$disconnect();
  });

  it('PILOT: die Farbe ist gesperrt (der Gate-Fall)', async () => {
    await tariffSetzen('PILOT');
    const res = await fetch(`${BASE}/api/branding/${kanzleiId}`, {
      method: 'PATCH',
      headers: await headers(),
      body: JSON.stringify({ primaryColor: '#ff0000' }),
    });
    const text = await res.text();
    expect(
      res.status,
      `die Farbe ist eine Premium-Funktion — Antwort: ${text.slice(0, 200)}`,
    ).toBe(402);
  });

  it('PILOT: das Logo ist gesperrt', async () => {
    await tariffSetzen('PILOT');
    const res = await logoHochladen();
    expect(
      res.status,
      'das Logo ist Teil des White-Label-Branding und damit Premium — ' +
        `Antwort: ${res.text.slice(0, 220)}`,
    ).toBe(402);

    const kanzlei = await prisma.kanzlei.findUnique({
      where: { id: kanzleiId },
      select: { logoUrl: true },
    });
    expect(kanzlei?.logoUrl, 'es darf kein Logo gesetzt worden sein').toBeNull();
  });

  it('Gegenprobe: mit Premium-Tarif ist das Logo erlaubt', async () => {
    await tariffSetzen('PREMIUM');
    const res = await logoHochladen();
    expect(
      res.status,
      'mit Premium-Tarif muss der Logo-Upload klappen — ' +
        `Antwort: ${res.text.slice(0, 220)}`,
    ).toBe(200);

    const kanzlei = await prisma.kanzlei.findUnique({
      where: { id: kanzleiId },
      select: { logoUrl: true },
    });
    expect(kanzlei?.logoUrl, 'das Logo muss gesetzt sein').toBeTruthy();
  });
});
