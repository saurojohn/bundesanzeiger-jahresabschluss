import { beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

/**
 * Zahlungsweg-Abnahme: ein **korrekt signiertes** Stripe-Webhook muss den
 * Tarif setzen, ein **gefälschtes** darf nichts ändern.
 *
 * BEFUND 2026-10-19 (Nachtrag 52): Der Zahlungsweg war **nicht
 * installierbar**. `stripe` stand in keiner `package.json`, das Paket war
 * nicht installiert, und `BillingProviderService` wirft beim Konstruieren
 * mit `STRIPE_SECRET_KEY`:
 *
 *     Error: Stripe-SDK fehlt. Installiere mit: cd backend && npm install stripe
 *         at new BillingProviderService
 *         at Injector.instantiateClass
 *
 * Gemessen: `STRIPE_SECRET_KEY=…` gesetzt → **HTTP 000, der Server startet
 * gar nicht.** Es war nicht „die Zahlungsseite ist kaputt" — es war „die
 * ganze Anwendung ist tot". Und der Fehler fällt genau in dem Moment auf,
 * in dem man Stripe **konfiguriert**, also beim Going-live.
 *
 * **Dieser Test ist eine Abnahme, kein Unit-Test.** Er läuft nur, wenn der
 * Server mit `STRIPE_SECRET_KEY` **und** `STRIPE_WEBHOOK_SECRET` läuft —
 * also in einer Stripe-konfigurierten Umgebung. Im Pilotbetrieb (Mock-
 * Provider) liefert `handleWebhook()` immer `null`, und der Zahlungsweg
 * wird dort **nicht** geprüft.
 *
 * Start (siehe `backend/scripts/verify-billing-webhook.sh`):
 *
 *     cd backend
 *     STRIPE_SECRET_KEY=sk_test_… STRIPE_WEBHOOK_SECRET=whsec_… \
 *       npx vitest run e2e/billing-webhook-stripe.e2e.spec.ts
 *
 * Voraussetzung: der Server läuft mit denselben Variablen.
 */

const BASE = 'http://localhost:3000';
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? '';

const stripeAktiv = Boolean(process.env.STRIPE_SECRET_KEY && WEBHOOK_SECRET);

/**
 * Das Stripe-SDK laedt den CJS-Build. Die Typdeklaration beschreibt nur
 * den Teil, den die Abnahme benutzt: die Signaturhilfe fuer Tests.
 */
type StripeCtor = new (key: string, opts: unknown) => {
  webhooks: {
    generateTestHeaderString: (a: { payload: string; secret: string }) => string;
  };
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const StripeCtor = require('stripe') as StripeCtor;

describe.skipIf(!stripeAktiv)('Zahlungsweg-Abnahme (Stripe-Modus)', () => {
  const prisma = new PrismaClient();
  let kanzleiId = '';

  beforeAll(async () => {
    const kanzleien = await prisma.kanzlei.findMany({ select: { id: true } });
    kanzleiId = kanzleien[0]?.id ?? '';
    expect(kanzleiId, 'es muss mindestens eine Kanzlei geben').not.toBe('');
  });

  /** Baut ein Stripe-Event und die zugehoerige Signatur — mit dem echten SDK. */
  async function signiertesEvent(
    typ: string,
    tier: string,
    subscriptionId: string,
  ): Promise<{ rawBody: Buffer; header: string }> {
    const stripe = new StripeCtor(process.env.STRIPE_SECRET_KEY ?? '', {
      apiVersion: '2024-11-20.acacia',
    });
    const payload = JSON.stringify({
      id: `evt_${subscriptionId}`,
      type: typ,
      data: {
        object: {
          id: subscriptionId,
          status: 'active',
          metadata: { tier, kanzleiId },
        },
      },
    });
    const rawBody = Buffer.from(payload);
    const header = stripe.webhooks.generateTestHeaderString({
      payload,
      secret: WEBHOOK_SECRET,
    });
    return { rawBody, header };
  }

  const senden = (rawBody: Buffer, header: string) =>
    fetch(`${BASE}/api/subscription/webhook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': header,
      },
      body: rawBody,
    });

  it('ein korrekt signiertes Webhook setzt den Tarif', async () => {
    const vorher = await prisma.kanzlei.findUniqueOrThrow({
      where: { id: kanzleiId },
      select: { subscriptionTier: true },
    });

    const { rawBody, header } = await signiertesEvent(
      'customer.subscription.updated',
      'PREMIUM',
      'sub_akzeptiert_1',
    );
    const res = await senden(rawBody, header);
    const text = await res.text();

    expect(
      res.status,
      `ein korrekt signiertes Webhook muss angenommen werden. Antwort: ${text}`,
    ).toBe(200);
    expect(JSON.parse(text)).toEqual({ received: true });

    const nachher = await prisma.kanzlei.findUniqueOrThrow({
      where: { id: kanzleiId },
      select: { subscriptionTier: true },
    });
    expect(
      nachher.subscriptionTier,
      `der Tarif wurde nicht gesetzt (vorher ${vorher.subscriptionTier}, ` +
        `nachher ${nachher.subscriptionTier})`,
    ).toBe('PREMIUM');
  });

  it('ein gefaelschtes Webhook aendert nichts', async () => {
    const vorher = await prisma.kanzlei.findUniqueOrThrow({
      where: { id: kanzleiId },
      select: { subscriptionTier: true },
    });

    const { rawBody } = await signiertesEvent(
      'customer.subscription.updated',
      'STANDARD',
      'sub_gefaelscht_1',
    );
    // Signatur mit einem FALSCHEN Secret: formal gueltiges Format,
    // aber nicht mit dem konfigurierten Secret berechnet.
    const falscheSignatur =
      't=1700000000,v1=' + 'a'.repeat(64);

    const res = await senden(rawBody, falscheSignatur);
    expect(res.status, 'eine gefaelschte Signatur darf nicht angenommen werden').not.toBe(200);

    const nachher = await prisma.kanzlei.findUniqueOrThrow({
      where: { id: kanzleiId },
      select: { subscriptionTier: true },
    });
    expect(
      nachher.subscriptionTier,
      'eine gefaelschte Signatur hat den Tarif verändert',
    ).toBe(vorher.subscriptionTier);
  });

  it('ohne konfiguriertes Secret wird nichts angenommen', async () => {
    // Fail-closed (Nachtrag 46): Ohne `STRIPE_WEBHOOK_SECRET` waere der
    // HMAC-Schluessel der leere String — jeder koennte ihn rechnen.
    const vorher = await prisma.kanzlei.findUniqueOrThrow({
      where: { id: kanzleiId },
      select: { subscriptionTier: true },
    });
    const payload = Buffer.from(
      JSON.stringify({
        id: 'evt_ohne_secret',
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_ohne_secret',
            status: 'active',
            metadata: { tier: 'PILOT', kanzleiId },
          },
        },
      }),
    );
    // Signatur mit dem LEEREN Secret — genau das, was ein Angreifer ohne
    // Kenntnis des Secrets berechnen wuerde, wenn der Default '' waere.
    const stripe = new StripeCtor(process.env.STRIPE_SECRET_KEY ?? '', {
      apiVersion: '2024-11-20.acacia',
    });
    const header = stripe.webhooks.generateTestHeaderString({
      payload: payload.toString('utf8'),
      secret: '',
    });

    const res = await senden(payload, header);
    expect(
      res.status,
      'eine mit dem LEEREN Secret gerechnete Signatur darf nicht angenommen ' +
        'werden — das waere die Umgehung des fail-closed-Verhaltens',
    ).not.toBe(200);

    const nachher = await prisma.kanzlei.findUniqueOrThrow({
      where: { id: kanzleiId },
      select: { subscriptionTier: true },
    });
    expect(nachher.subscriptionTier).toBe(vorher.subscriptionTier);
  });
});
