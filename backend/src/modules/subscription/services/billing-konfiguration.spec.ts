import { describe, it, expect, vi } from 'vitest';
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  BillingProviderService,
  StripeProvider,
} from './billing-provider.service';
import { SubscriptionService } from './subscription.service';
import type { AuthUser } from '../../auth/types/auth-user.types';

/**
 * BEFUND 2026-10-22 (Nachtrag 85): Die Billing-Konfiguration der
 * Produktion war unvollstaendig — und die Luecken fuehrten zu zwei
 * verschiedenen, schwer verstaendlichen Fehlern.
 *
 * **Gemessen** mit der Konfiguration aus `infra/hetzner/.env.prod.example`
 * (dort fehlte der gesamte Billing-Block):
 *
 *     [BillingProviderService] Billing-Provider: MOCK — STRIPE_SECRET_KEY
 *                                             nicht gesetzt
 *     POST /api/subscription/<id>/checkout {tier: 'PREMIUM'}
 *       -> HTTP 200, providerName = 'mock',
 *          url = …&mock_session=mock_…&tier=PREMIUM&kanzlei=…
 *     POST /api/subscription/<id>/mock-activate {mockSession: 'mock_…'}
 *       -> HTTP 404 "Nicht gefunden"
 *     SELECT "subscriptionTier" FROM kanzlei
 *       -> PILOT            (unveraendert)
 *
 * Der Checkout lieferte eine Session, die **ins Leere** fuehrte: die Kanzlei
 * sah "Premium gebucht", der Tarif blieb PILOT. In der Produktion war damit
 * **kein einziger bezahlter Tarifwechsel** moeglich.
 *
 * Zwei Ursachen, eine Familie:
 *   1. Der **Checkout** war nicht von der Mock-Freischaltung abhaengig —
 *      nur die Mock-*Aktivierung* war es (Nachtrag 11). Dieselbe Schranke
 *      muss fuer beide gelten.
 *   2. Die **Provider-Wahl** war eine Nebenwirkung (fehlender Key -> Mock)
 *      statt einer Entscheidung — dieselbe Fehlerklasse wie Nachtrag 11,
 *      eine Ebene darunter.
 *
 * Dazu: die Stripe-Price-IDs standen als Konstante mit **Platzhalter**
 * ("price_premium_149eur"). Mit gesetztem Key, aber ohne gesetzte
 * `STRIPE_PRICE_*`, schickte der Checkout genau diese Zeichenkette an
 * Stripe; die Antwort lautete "No such price" — ein Account-Problem, obwohl
 * es ein Konfigurationsproblem war.
 */
const KANZLEI = '11111111-1111-4111-8111-111111111111';
const MANDANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const admin = {
  id: '33333333-3333-4333-8333-333333333333',
  globalRole: null,
  mandanten: [{ id: MANDANT_ID, firmenname: 'A GmbH', rolle: 'KANZLEI_ADMIN' }],
} as unknown as AuthUser;

/** ConfigService-Stub: liefert nur die gesetzten Schluessel. */
function configMit(werte: Record<string, string | undefined>) {
  return { get: (k: string) => werte[k] } as never;
}

describe('Billing-Provider: die Wahl ist eine Entscheidung, keine Nebenwirkung (Nachtrag 85)', () => {
  it('BILLING_PROVIDER=mock waehlt den Mock ausdruecklich', () => {
    const provider = new BillingProviderService(configMit({ BILLING_PROVIDER: 'mock' }));
    expect(provider.getProviderName()).toBe('mock');
  });

  it('BILLING_PROVIDER=stripe ohne STRIPE_SECRET_KEY startet den Dienst nicht', () => {
    // Fail-closed: ein unbeabsichtigter Mock im Produktivbetrieb ist
    // ausgeschlossen — der Dienst startet gar nicht erst.
    expect(() =>
      new BillingProviderService(configMit({ BILLING_PROVIDER: 'stripe' })),
    ).toThrow(/STRIPE_SECRET_KEY/);
  });

  it('BILLING_PROVIDER=stripe mit Key waehlt Stripe', () => {
    const provider = new BillingProviderService(
      configMit({ BILLING_PROVIDER: 'stripe', STRIPE_SECRET_KEY: 'sk_test_x' }),
    );
    expect(provider.getProviderName()).toBe('stripe');
  });

  it('ohne BILLING_PROVIDER wird abgeleitet — aber laut', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const provider = new BillingProviderService(
        configMit({ STRIPE_SECRET_KEY: 'sk_test_x' }),
      );
      expect(provider.getProviderName()).toBe('stripe');
      expect(warn, 'die Ableitung muss benannt werden').toHaveBeenCalled();
      expect(String(warn.mock.calls[0]?.[0])).toContain('BILLING_PROVIDER');
    } finally {
      warn.mockRestore();
    }
  });

  it('ohne Key und ohne BILLING_PROVIDER: Mock — mit einer Warnung, die den Produktivbetrieb benennt', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const provider = new BillingProviderService(configMit({}));
      expect(provider.getProviderName()).toBe('mock');
      const text = warn.mock.calls.map((c) => String(c[0])).join(' | ');
      expect(text).toContain('BILLING_PROVIDER');
      expect(text).toContain('STRIPE_SECRET_KEY');
    } finally {
      warn.mockRestore();
    }
  });
});

describe('StripeProvider: die Price-ID kommt aus der Konfiguration (Nachtrag 85)', () => {
  it('ohne STRIPE_PRICE_* bricht der Checkout mit einer klaren Meldung ab', async () => {
    const provider = new StripeProvider(
      configMit({ STRIPE_SECRET_KEY: 'sk_test_x' }),
    );
    await expect(
      provider.createCheckoutSession({
        kanzleiId: KANZLEI,
        kanzleiName: 'A GmbH',
        tier: 'PREMIUM' as never,
        successUrl: 'https://example.com/ok',
        cancelUrl: 'https://example.com/ab',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('die Meldung nennt die konkrete Variable', async () => {
    const provider = new StripeProvider(
      configMit({ STRIPE_SECRET_KEY: 'sk_test_x' }),
    );
    await expect(
      provider.createCheckoutSession({
        kanzleiId: KANZLEI,
        kanzleiName: 'A GmbH',
        tier: 'PREMIUM' as never,
        successUrl: 'https://example.com/ok',
        cancelUrl: 'https://example.com/ab',
      }),
    ).rejects.toThrow(/STRIPE_PRICE_PREMIUM/);
  });
});

describe('Checkout: der Mock-Checkout teilt die Schranke der Mock-Aktivierung (Nachtrag 85)', () => {
  function svc(opts: { mockFlag?: string; providerName?: string }) {
    const createCheckoutSession = vi.fn().mockResolvedValue({
      url: 'https://example.com/checkout',
      sessionId: 'cs_1',
    });
    const service = new SubscriptionService(
      {
        kanzlei: { update: vi.fn().mockResolvedValue({}) },
        mandant: {
          findFirst: vi.fn().mockResolvedValue({ kanzleiId: KANZLEI }),
          findMany: vi.fn().mockResolvedValue([{ id: MANDANT_ID, kanzleiId: KANZLEI }]),
        },
      } as never,
      { invalidate: vi.fn().mockResolvedValue(undefined) } as never,
      { findById: vi.fn().mockResolvedValue({ id: KANZLEI, name: 'A GmbH' }) } as never,
      { record: vi.fn().mockResolvedValue(undefined) } as never,
      {
        getProviderName: () => opts.providerName ?? 'mock',
        getProvider: () => ({ createCheckoutSession }),
      } as never,
      {
        getTierConfig: vi.fn().mockReturnValue({ features: [] }),
        getFeatures: vi.fn().mockReturnValue([]),
      } as never,
      {
        get: (k: string) => (k === 'BILLING_MOCK_ENABLED' ? opts.mockFlag : undefined),
      } as never,
    );
    return { service, createCheckoutSession };
  }

  const ctx = { ip: null, userAgent: null };

  it('ohne BILLING_MOCK_ENABLED gibt es keine Mock-Session (BUG vor dem Fix)', async () => {
    const { service, createCheckoutSession } = svc({ mockFlag: undefined });
    await expect(
      service.createCheckout(
        KANZLEI,
        admin,
        'PREMIUM' as never,
        'https://example.com/ok',
        'https://example.com/ab',
        ctx,
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    // Es darf keine Session erzeugt werden, die ins Leere fuehrt.
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it('BILLING_MOCK_ENABLED=false ebenfalls nicht', async () => {
    const { service, createCheckoutSession } = svc({ mockFlag: 'false' });
    await expect(
      service.createCheckout(
        KANZLEI,
        admin,
        'PREMIUM' as never,
        'https://example.com/ok',
        'https://example.com/ab',
        ctx,
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it('mit ausdruecklicher Freischaltung funktioniert der Mock-Checkout weiter', async () => {
    // Der Weg soll nicht kaputtgemacht werden — der Pilot und die
    // Playwright-Suite brauchen ihn. Gesperrt ist er NUR ohne Entscheidung.
    const { service, createCheckoutSession } = svc({ mockFlag: 'true' });
    const antwort = await service.createCheckout(
      KANZLEI,
      admin,
      'PREMIUM' as never,
      'https://example.com/ok',
      'https://example.com/ab',
      ctx,
    );
    expect(antwort.url).toBe('https://example.com/checkout');
    expect(createCheckoutSession).toHaveBeenCalled();
  });

  it('der echte Provider ist von der Mock-Schranke nicht betroffen (Gegenprobe)', async () => {
    const { service, createCheckoutSession } = svc({
      mockFlag: undefined,
      providerName: 'stripe',
    });
    await service.createCheckout(
      KANZLEI,
      admin,
      'PREMIUM' as never,
      'https://example.com/ok',
      'https://example.com/ab',
      ctx,
    );
    expect(createCheckoutSession).toHaveBeenCalled();
  });
});
