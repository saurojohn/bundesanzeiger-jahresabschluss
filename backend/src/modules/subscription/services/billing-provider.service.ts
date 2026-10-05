import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  SubscriptionTier,
  SubscriptionStatus,
} from '../constants/subscription-tier.constants';
import { STRIPE_PRICE_IDS } from '../constants/subscription-tier.constants';

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
    const stripeKey = this.configService.get<string>('STRIPE_SECRET_KEY');
    if (stripeKey) {
      // Production: StripeProvider
      this.provider = new StripeProvider(this.configService);
      this.logger.log('Billing-Provider: STRIPE (Live-Mode)');
    } else {
      // Dev/Pilot: MockProvider
      this.provider = new MockProvider();
      this.logger.log('Billing-Provider: MOCK (Dev/Pilot) — STRIPE_SECRET_KEY nicht gesetzt');
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
class StripeProvider implements BillingProvider {
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
    const session = (await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: STRIPE_PRICE_IDS[args.tier], quantity: 1 }],
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