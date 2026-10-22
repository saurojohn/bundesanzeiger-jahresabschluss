import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  SubscriptionTier,
  SubscriptionStatus,
} from '../constants/subscription-tier.constants';

/**
 * Billing-Provider-Abstraktion (M4 Sprint 3).
 *
 * Strategy-Pattern: erlaubt später Stripe, Mollie, SevDesk etc. ohne
 * dass Services umgeschrieben werden müssen. Default = MockProvider
 * (für Dev/Pilot wenn kein STRIPE_SECRET_KEY gesetzt).
 *
 * Setup für echte Stripe-Integration:
 *   1. cd backend && npm install stripe
 *   2. .env: STRIPE_SECRET_KEY=sk_live_...
 *   3. StripeProvider ersetzt automatisch den MockProvider
 *
 * Provider-Vertrag:
 *   - createCheckoutSession: Stripe-Checkout-URL oder Mock-URL
 *   - createCustomerPortalSession: Stripe-Portal-URL
 *   - handleWebhook: parst Provider-Event → BillingEvent (normalisiert)
 *   - cancelSubscription: Kündigt beim Provider
 */

export interface CheckoutSessionResult {
  url: string;
  sessionId: string;
}

export interface BillingEvent {
  type:
    | 'subscription.created'
    | 'subscription.updated'
    | 'subscription.canceled'
    | 'payment.failed'
    | 'payment.succeeded';
  kanzleiId: string;
  providerSubscriptionId: string;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  rawEvent: unknown;
}

export interface BillingProvider {
  readonly name: 'stripe' | 'mock';
  createCheckoutSession(args: {
    kanzleiId: string;
    kanzleiName: string;
    tier: SubscriptionTier;
    successUrl: string;
    cancelUrl: string;
  }): Promise<CheckoutSessionResult>;
  createCustomerPortalSession(args: {
    providerCustomerId: string;
    returnUrl: string;
  }): Promise<{ url: string }>;
  handleWebhook(rawBody: Buffer, signature: string | null): Promise<BillingEvent | null>;
  cancelSubscription(providerSubscriptionId: string): Promise<void>;
}

@Injectable()
export class BillingProviderService implements OnModuleInit {
  private readonly logger = new Logger(BillingProviderService.name);
  private provider: BillingProvider;

  constructor(private readonly configService: ConfigService) {
    // BEFUND 2026-10-22 (Nachtrag 85): Die Provider-Wahl war eine
    // NEBENWIRKUNG der Konfiguration — der Provider heisst genau dann
    // 'mock', wenn `STRIPE_SECRET_KEY` nicht gesetzt ist. In der Produktion
    // enthaelt `infra/hetzner/.env.prod.example` **keine** Billing-Konfiguration
    // (gemessen: der Checkout lieferte eine Mock-Session, die Mock-Aktivierung
    // war gesperrt — der bezahlte Pfad war tot).
    //
    // Jetzt ist die Wahl eine **Entscheidung**:
    //   - `BILLING_PROVIDER=stripe` — Stripe (fehlt der Key, startet der
    //     Dienst nicht: ein unbeabsichtigter Mock im Produktivbetrieb ist
    //     ausgeschlossen)
    //   - `BILLING_PROVIDER=mock`   — Mock, ausdruecklich gewollt
    //   - nicht gesetzt             — Rueckfall auf die Ableitung aus dem
    //     Key, mit einer lauten Warnung (nicht still)
    const gewaehlt = (
      this.configService.get<string>('BILLING_PROVIDER') ?? ''
    ).toLowerCase();
    const stripeKey = this.configService.get<string>('STRIPE_SECRET_KEY');

    if (gewaehlt === 'mock') {
      this.provider = new MockProvider();
      this.logger.warn(
        'Billing-Provider: MOCK (ausdrücklich gewählt via BILLING_PROVIDER=mock)',
      );
      return;
    }
    if (gewaehlt === 'stripe') {
      if (!stripeKey) {
        throw new Error(
          'BILLING_PROVIDER=stripe, aber STRIPE_SECRET_KEY fehlt — der ' +
            'Dienst startet nicht. Ein unbeabsichtigter Mock im ' +
            'Produktivbetrieb ist ausgeschlossen.',
        );
      }
      this.provider = new StripeProvider(this.configService);
      this.logger.log('Billing-Provider: STRIPE (Live-Mode, ausdrücklich gewählt)');
      return;
    }

    // Nicht gesetzt: Rueckfall auf die Ableitung — aber mit einer Warnung,
    // die den Fehler der stillen Nebenwirkung benennt.
    if (stripeKey) {
      this.provider = new StripeProvider(this.configService);
      this.logger.warn(
        'Billing-Provider: BILLING_PROVIDER ist nicht gesetzt — der Provider ' +
          'wurde aus STRIPE_SECRET_KEY abgeleitet. Bitte BILLING_PROVIDER ' +
          'explizit setzen (stripe oder mock).',
      );
    } else {
      this.provider = new MockProvider();
      this.logger.warn(
        'Billing-Provider: MOCK — BILLING_PROVIDER ist nicht gesetzt und ' +
          'STRIPE_SECRET_KEY fehlt. In der Produktion ist damit kein ' +
          'bezahlter Tarifwechsel möglich; BILLING_PROVIDER und ' +
          'STRIPE_SECRET_KEY setzen.',
      );
    }
  }

  async onModuleInit(): Promise<void> {
    // Log-only. Echte Stripe-Init (SDK-Version prüfen) könnte hier stehen.
  }

  getProvider(): BillingProvider {
    return this.provider;
  }

  getProviderName(): 'stripe' | 'mock' {
    return this.provider.name;
  }
}

/**
 * Mock-Implementierung für Dev + Pilot-Phase.
 *
 * Liefert eine Pseudo-URL zurück die auf unseren eigenen /api/dev/billing/success
 * Endpoint zeigt, der die Subscription direkt auf den gewünschten Tier setzt.
 * Production-Deployments MÜSSEN Stripe aktivieren.
 */
class MockProvider implements BillingProvider {
  readonly name = 'mock' as const;

  async createCheckoutSession(args: {
    kanzleiId: string;
    kanzleiName: string;
    tier: SubscriptionTier;
    successUrl: string;
    cancelUrl: string;
  }): Promise<CheckoutSessionResult> {
    const sessionId = `mock_${Date.now()}_${args.kanzleiId.substring(0, 8)}`;
    // Im Mock-Mode leiten wir direkt auf success mit Tier-Param um.
    // Frontend erkennt den Mock-Mode und ruft /api/subscription/upgrade direkt.
    //
    // Bugfix 2026-10-05: hier stand ein festes `?`. Die successUrl kommt aus
    // dem Frontend und enthält bereits einen Query
    // (`…/subscription?upgrade=success`) — das Ergebnis war
    // `…?upgrade=success?mock_session=mock_…&tier=…`. Alles zwischen dem
    // ersten `?` und dem ersten `&` ist der WERT von `upgrade`, also:
    //
    //   new URL(url).searchParams.get('mock_session') → null
    //
    // Das Frontend schickte daraufhin einen leeren `mockSession` und die
    // Aktivierung scheiterte mit HTTP 400. Die Trennung am Trennzeichen
    // statt am Fragezeichen ist hier der ganze Unterschied.
    const separator = args.successUrl.includes('?') ? '&' : '?';
    const url = `${args.successUrl}${separator}mock_session=${sessionId}&tier=${args.tier}&kanzlei=${args.kanzleiId}`;
    return { url, sessionId };
  }

  async createCustomerPortalSession(): Promise<{ url: string }> {
    return { url: '/api/subscription?mock_portal=1' };
  }

  async handleWebhook(): Promise<BillingEvent | null> {
    return null; // Mock kennt keine externen Webhooks
  }

  async cancelSubscription(): Promise<void> {
    // No-op im Mock-Mode
  }
}

/**
 * Stripe-Provider (Platzhalter, aktiv sobald `stripe`-Package installiert).
 *
 * Die echte Implementierung wird nach `npm install stripe` ergänzt.
 * Damit der Code tsc-clean bleibt, ist die Stripe-SDK-Aufrufe in
 * Type-Guards gekapselt.
 */
export class StripeProvider implements BillingProvider {
  readonly name = 'stripe' as const;

  constructor(private readonly configService: ConfigService) {
    // Lazy-Load: stripe-SDK wird erst geladen wenn tatsächlich gebraucht.
    // Damit bleibt das Backend auch ohne `npm install stripe` lauffähig.
    this.verifyStripeInstalled();
  }

  private verifyStripeInstalled(): void {
    try {
       
      require.resolve('stripe');
      this.logger.log('Stripe-SDK gefunden');
    } catch {
      this.logger.error(
        'Stripe-SDK nicht installiert! `npm install stripe` ausführen oder STRIPE_SECRET_KEY entfernen.',
      );
      throw new Error(
        'Stripe-SDK fehlt. Installiere mit: cd backend && npm install stripe',
      );
    }
  }

  async createCheckoutSession(args: {
    kanzleiId: string;
    kanzleiName: string;
    tier: SubscriptionTier;
    successUrl: string;
    cancelUrl: string;
  }): Promise<CheckoutSessionResult> {
     
    const Stripe = require('stripe') as new (key: string, opts: unknown) => {
      checkout: { sessions: { create: (params: unknown) => Promise<unknown> } };
    };
    const stripe = new Stripe(this.configService.get<string>('STRIPE_SECRET_KEY') ?? '', {
      apiVersion: '2024-11-20.acacia',
    });
    // BEFUND 2026-10-22 (Nachtrag 85): Der Preis kam aus einer Konstante mit
    // **Platzhalter-Defaults** ("price_premium_149eur"). Die Placeholder sehen
    // wie echte Stripe-IDs aus — und mit einem echten Key, aber ohne
    // gesetzte `STRIPE_PRICE_*`, schickte der Checkout sie an Stripe. Die
    // Antwort lautete dann "No such price": ein Stripe-Fehler, der nach
    // einem Konfigurationsproblem aussieht, aber nach einem Account-Problem.
    //
    // Der Preis wird jetzt aus der Konfiguration gelesen; fehlt er, gibt es
    // eine Meldung, die die Ursache nennt. Die Platzhalter-Konstante ist
    // damit ueberfluessig (und entfernt).
    const preisKey = `STRIPE_PRICE_${args.tier.toUpperCase()}`;
    const preisId = this.configService.get<string>(preisKey);
    if (!preisId) {
      throw new ServiceUnavailableException(
        `${preisKey} ist nicht gesetzt — der Checkout kann nicht erstellt werden. ` +
          'Die Price-ID wird im Stripe-Dashboard hinterlegt und hier als ' +
          'Umgebungsvariable eingetragen.',
      );
    }
    const session = (await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: preisId, quantity: 1 }],
      success_url: args.successUrl,
      cancel_url: args.cancelUrl,
      client_reference_id: args.kanzleiId,
      metadata: { kanzleiId: args.kanzleiId, tier: args.tier },
    })) as { id: string; url: string };
    return { url: session.url, sessionId: session.id };
  }

  async createCustomerPortalSession(args: {
    providerCustomerId: string;
    returnUrl: string;
  }): Promise<{ url: string }> {
     
    const Stripe = require('stripe') as new (key: string, opts: unknown) => {
      billingPortal: { sessions: { create: (params: unknown) => Promise<unknown> } };
    };
    const stripe = new Stripe(this.configService.get<string>('STRIPE_SECRET_KEY') ?? '', {
      apiVersion: '2024-11-20.acacia',
    });
    const session = (await stripe.billingPortal.sessions.create({
      customer: args.providerCustomerId,
      return_url: args.returnUrl,
    })) as { url: string };
    return { url: session.url };
  }

  async handleWebhook(rawBody: Buffer, signature: string | null): Promise<BillingEvent | null> {
     
    const Stripe = require('stripe') as new (key: string, opts: unknown) => {
      webhooks: { constructEvent: (body: Buffer, sig: string, secret: string) => unknown };
    };
    const stripe = new Stripe(this.configService.get<string>('STRIPE_SECRET_KEY') ?? '', {
      apiVersion: '2024-11-20.acacia',
    });
    const webhookSecret = this.configService.get<string>('STRIPE_WEBHOOK_SECRET') ?? '';
    // BEFUND 2026-10-19 (Nachtrag 46): Fail-closed. Ohne Secret waere der
    // HMAC-Schluessel der leere String — **jeder koennte ihn sich
    // selbst berechnen** und eine vollstaendig gefaelschte Nutzlast
    // mit gueltiger Signatur schicken, die dann `applyTierChange()` mit
    // einem beliebigen Tarif ausloest.
    //
    // Das Projekt behandelt jeden anderen Schalter so: `BILLING_MOCK_ENABLED`
    // ist `?? 'false'`, `SIGNATURE_ALLOW_SELF_SIGNED` ebenfalls. Hier war
    // die Voreinstellung das Gegenteil.
    if (!webhookSecret) {
      throw new Error(
        'STRIPE_WEBHOOK_SECRET ist nicht gesetzt — Webhooks werden ohne ' +
          'konfiguriertes Secret angenommen, weil sonst jeder einen gueltigen ' +
          'HMAC mit dem leeren Schluessel berechnen koennte.',
      );
    }
    if (!signature) {
      throw new Error('Stripe-Webhook-Signature fehlt');
    }
     
    const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret) as any;
    return mapStripeEventToBillingEvent(event);
  }

  async cancelSubscription(providerSubscriptionId: string): Promise<void> {
     
    const Stripe = require('stripe') as new (key: string, opts: unknown) => {
      subscriptions: { cancel: (id: string) => Promise<unknown> };
    };
    const stripe = new Stripe(this.configService.get<string>('STRIPE_SECRET_KEY') ?? '', {
      apiVersion: '2024-11-20.acacia',
    });
    await stripe.subscriptions.cancel(providerSubscriptionId);
  }

  private logger = new Logger(StripeProvider.name);
}

 
function mapStripeEventToBillingEvent(event: any): BillingEvent | null {
  const obj = event.data?.object;
  if (!obj) return null;
  const meta = obj.metadata ?? {};
  const tier = meta.tier as SubscriptionTier | undefined;
  const kanzleiId = meta.kanzleiId ?? obj.client_reference_id;
  if (!tier || !kanzleiId) return null;

  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      return {
        type: 'subscription.updated',
        kanzleiId,
        providerSubscriptionId: obj.id,
        tier,
        status: obj.status as SubscriptionStatus,
        rawEvent: event,
      };
    case 'customer.subscription.deleted':
      return {
        type: 'subscription.canceled',
        kanzleiId,
        providerSubscriptionId: obj.id,
        tier,
        status: 'CANCELED',
        rawEvent: event,
      };
    case 'invoice.payment_succeeded':
      return {
        type: 'payment.succeeded',
        kanzleiId,
        providerSubscriptionId: obj.subscription ?? '',
        tier,
        status: 'ACTIVE',
        rawEvent: event,
      };
    case 'invoice.payment_failed':
      return {
        type: 'payment.failed',
        kanzleiId,
        providerSubscriptionId: obj.subscription ?? '',
        tier,
        status: 'PAST_DUE',
        rawEvent: event,
      };
    default:
      return null;
  }
}