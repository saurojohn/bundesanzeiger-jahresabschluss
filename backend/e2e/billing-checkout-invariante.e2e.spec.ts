import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

/**
 * BEFUND 2026-10-22 (Nachtrag 85): Der Checkout lieferte eine **Mock-Session,
 * die nicht aktiviert werden konnte** — die Kanzlei sah "Premium gebucht",
 * der Tarif blieb PILOT.
 *
 * **Gemessen** mit der Konfiguration aus `infra/hetzner/.env.prod.example`
 * (dort fehlte der gesamte Billing-Block):
 *
 *     POST /api/subscription/<id>/checkout {tier: 'PREMIUM'}
 *       -> HTTP 200, providerName = 'mock',
 *          url = …&mock_session=mock_…&tier=PREMIUM&kanzlei=…
 *     POST /api/subscription/<id>/mock-activate {mockSession: 'mock_…'}
 *       -> HTTP 404 "Nicht gefunden"
 *     SELECT "subscriptionTier" FROM kanzlei
 *       -> PILOT            (unveraendert)
 *
 * Der Test ist deshalb als **Invariante** formuliert, nicht als
 * Statuscode-Fest: er gilt in JEDER Konfiguration.
 *
 *     "Der Checkout liefert niemals eine Session, die nicht aktiviert
 *      werden kann."
 *
 * - Mock ausdruecklich freigeschaltet: Checkout **und** Aktivierung
 *   funktionieren.
 * - Mock nicht freigeschaltet: der Checkout antwortet 503 mit einer
 *   Meldung, die die Ursache nennt — und erzeugt ueberhaupt keine Session.
 */
const BASE = 'http://localhost:3000';

describe('Billing: der Checkout liefert nie eine tote Session (Nachtrag 85)', () => {
  const prisma = new PrismaClient();
  let kanzleiId = '';
  let mandantId = '';
  let token = '';
  // Der Mock-Activate schreibt mehr als den Tarif (Status, Provider-ID,
  // Periodenende) — der Test muss **alles** zuruecksetzen, sonst leakt der
  // Zustand in die folgenden Specs.
  let vorher: {
    subscriptionTier: string | null;
    subscriptionStatus: string | null;
    subscriptionProvider: string | null;
    subscriptionProviderId: string | null;
    subscriptionPeriodEnd: Date | null;
  } | null = null;

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

  const head = () => ({
    'content-type': 'application/json',
    authorization: `Bearer ${token}`,
    'x-mandant-id': mandantId,
  });

  beforeAll(async () => {
    const kanzlei = await prisma.kanzlei.findFirstOrThrow({
      orderBy: { createdAt: 'asc' },
    });
    kanzleiId = kanzlei.id;
    vorher = {
      subscriptionTier: kanzlei.subscriptionTier,
      subscriptionStatus: kanzlei.subscriptionStatus,
      subscriptionProvider: kanzlei.subscriptionProvider,
      subscriptionProviderId: kanzlei.subscriptionProviderId,
      subscriptionPeriodEnd: kanzlei.subscriptionPeriodEnd,
    };
    const mandant = await prisma.mandant.findFirstOrThrow({
      where: { kanzleiId },
    });
    mandantId = mandant.id;
    token = await login('kanzlei-admin@kanzlei.de');
  });

  afterAll(async () => {
    if (kanzleiId && vorher) {
      await prisma.kanzlei.update({
        where: { id: kanzleiId },
        data: { ...vorher },
      });
    }
    await prisma.$disconnect();
  });

  it('Checkout und Aktivierung passen zusammen', async () => {
    const checkout = await fetch(`${BASE}/api/subscription/${kanzleiId}/checkout`, {
      method: 'POST',
      headers: head(),
      body: JSON.stringify({
        tier: 'PREMIUM',
        successUrl: 'http://localhost:3001/de-DE/einstellungen/subscription?upgrade=success',
        cancelUrl: 'http://localhost:3001/de-DE/einstellungen/subscription',
      }),
    });
    const body = (await checkout.json().catch(() => ({}))) as {
      providerName?: string;
      sessionId?: string;
      url?: string;
      message?: string;
    };

    if (checkout.status === 503) {
      // Der Mock ist nicht freigeschaltet: der Checkout muss das sagen und
      // darf keine Session erzeugt haben.
      expect(
        body.message ?? '',
        'die Meldung muss die Ursache nennen (STRIPE_SECRET_KEY / BILLING_MOCK_ENABLED)',
      ).toMatch(/BILLING_MOCK_ENABLED|STRIPE_SECRET_KEY/);
      expect(body.sessionId, 'ohne Freischaltung darf keine Session entstehen').toBeUndefined();
      return;
    }

    expect(checkout.status, `Antwort: ${JSON.stringify(body).slice(0, 200)}`).toBe(200);
    expect(body.providerName).toBe('mock');

    // Eine Session wurde geliefert — sie muss auch einlösbar sein.
    const activate = await fetch(
      `${BASE}/api/subscription/${kanzleiId}/mock-activate`,
      {
        method: 'POST',
        headers: head(),
        body: JSON.stringify({ tier: 'PREMIUM', mockSession: body.sessionId }),
      },
    );
    expect(
      activate.status,
      'eine gelieferte Session muss einloesbar sein — sonst hat der ' +
        'Checkout eine tote Session erzeugt',
    ).toBe(200);

    // Und der Tarif steht danach auch wirklich auf PREMIUM.
    const nachher = await prisma.kanzlei.findUniqueOrThrow({
      where: { id: kanzleiId },
      select: { subscriptionTier: true },
    });
    expect(nachher.subscriptionTier).toBe('PREMIUM');
  });
});
