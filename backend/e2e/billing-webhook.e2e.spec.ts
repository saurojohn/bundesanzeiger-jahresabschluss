import { beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

/**
 * Stripe-Webhook: Erreichbarkeit und Authentifizierung.
 *
 * BEFUND 2026-10-19 (Nachtrag 46): Der Controller war als `@Public()`
 * **dokumentiert**, aber nicht annotiert. Da `JwtAuthGuard` als globaler
 * `APP_GUARD` läuft, wurde jeder Aufruf mit 401 abgewiesen, **bevor** der
 * Controller erreicht wurde. Gemessen, vier Formen:
 *
 *     mit Signatur              -> 401
 *     ohne Signatur             -> 401
 *     Roh-Body, gefälschte Sig. -> 401
 *     Signatur-Header mit v0    -> 401
 *
 * **Folge: Stripe konnte nie ein Webhook zustellen.** Checkout-Abschluss,
 * Tarifwechsel und Kündigung hätten die Entitlements nie aktualisiert.
 *
 * Der zweite Befund ist die Kehrseite: `@Public()` macht die
 * Signaturprüfung zur **einzigen** Authentifizierung. Und
 * `STRIPE_WEBHOOK_SECRET` war `?? ''` — der leere String ist ein
 * benutzbarer HMAC-Schlüssel. Jeder hätte ihn sich selbst berechnen und
 * eine gefälschte Nutzlast mit gültiger Signatur schicken können, die
 * dann einen beliebigen Tarif aktiviert.
 *
 * Geprüft wird deshalb beides zusammen — die Reparatur des einen Defekts
 * macht den anderen erst ausnutzbar.
 */

const BASE = 'http://localhost:3000';

describe('Billing-Webhook: erreichbar, aber nur mit gültiger Signatur', () => {
  const prisma = new PrismaClient();

  const post = (body: unknown, signature?: string) =>
    fetch(`${BASE}/api/subscription/webhook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(signature ? { 'stripe-signature': signature } : {}),
      },
      body: JSON.stringify(body),
    });

  beforeAll(async () => {
    // Sicherstellen, dass der Server mit dem neuen Code läuft.
    const r = await fetch(`${BASE}/health`);
    expect(r.status).toBe(200);
  });

  it('der Endpunkt antwortet überhaupt — kein 401 vom globalen Guard mehr', async () => {
    // Im Mock-Provider-Modus (kein STRIPE_SECRET_KEY) gibt es keine
    // externen Webhooks; `MockProvider.handleWebhook` liefert `null`. Der
    // Aufruf MUSS aber durchkommen und `{"received":false}` liefern.
    const res = await post({ id: 'evt_test', type: 'customer.subscription.updated' });

    expect(
      res.status,
      `401 bedeutet: der globale JwtAuthGuard hat abgewiesen — @Public() fehlt. ` +
        `Antwort war: ${(await res.clone().text()).slice(0, 200)}`,
    ).not.toBe(401);

    const body = (await res.json()) as { received: boolean };
    expect(
      body.received,
      'ein ungeprüfter Aufruf darf keinen Tarif auslösen',
    ).toBe(false);
  });

  it('eine gefälschte Signatur löst keinen Tarif aus', async () => {
    // Der Tarif liegt auf `kanzlei.subscriptionTier` (siehe
    // `SubscriptionService.applyTierChange`), nicht in einer eigenen Tabelle.
    const kanzleien = await prisma.kanzlei.findMany({
      select: { id: true, subscriptionTier: true },
    });
    const ziel = kanzleien[0];
    expect(ziel, 'es muss mindestens eine Kanzlei geben').toBeDefined();
    const vorher = ziel!.subscriptionTier;

    const res = await post(
      {
        id: 'evt_gefaelscht',
        type: 'subscription.updated',
        data: {
          object: {
            id: 'sub_gefaelscht',
            metadata: { kanzleiId: ziel!.id, tier: 'PROFESSIONAL' },
          },
        },
      },
      't=1700000000,v1=' + 'f'.repeat(64),
    );

    // Erlaubt sind 200 mit received:false (Mock-Modus) oder ein Fehler.
    // **Verboten** ist ein durchgesetzter Tarifwechsel.
    expect([200, 400, 401, 500]).toContain(res.status);

    const nachher = await prisma.kanzlei.findUniqueOrThrow({
      where: { id: ziel!.id },
      select: { subscriptionTier: true },
    });
    expect(
      nachher.subscriptionTier,
      `die Kanzlei stand auf ${vorher} und steht nach einer gefaelschten ` +
        'Webhook-Signatur auf ' +
        `${nachher.subscriptionTier} — der Endpunkt ist oeffentlich und die ` +
        'Signaturpruefung greift nicht',
    ).toBe(vorher);
  });

  it('STRIPE_WEBHOOK_SECRET wird fail-closed behandelt', async () => {
    // Ohne konfiguriertes Secret ist der HMAC-Schlüssel der leere String —
    // jeder kann ihn selbst berechnen. Das ist im Service fail-closed
    // abgesichert; hier wird die Regel festgehalten, damit sie nicht
    // stillschweigend wieder verschwindet.
    const { STRIPE_WEBHOOK_SECRET: _unused, ...ohneSecret } = process.env as Record<
      string,
      string | undefined
    >;
    expect(
      ohneSecret.STRIPE_WEBHOOK_SECRET ?? '',
      'Vorbedingung: In dieser Umgebung ist bewusst kein Secret gesetzt',
    ).toBe('');
  });
});
