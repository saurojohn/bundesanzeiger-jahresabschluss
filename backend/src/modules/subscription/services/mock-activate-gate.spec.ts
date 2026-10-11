import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import type { AuthUser } from '../../auth/types/auth-user.types';

/**
 * BEFUND 2026-10-11 — `mockActivate` war nicht gesperrt, sondern nur
 * "wahrscheinlich" gesperrt.
 *
 * Die alte Bedingung war:
 *
 *     if (this.billingProvider.getProviderName() !== 'mock') throw ...
 *
 * Der Provider heisst genau dann 'mock', wenn `STRIPE_SECRET_KEY` nicht
 * gesetzt ist. Das ist eine NEBENWIRKUNG der Konfiguration, keine
 * Entscheidung. Live gegen den laufenden Pilot gemessen:
 *
 *     POST /api/subscription/:id/mock-activate
 *     { tier: 'PREMIUM', mockSession: 'mock_garantiert_erfunden' }
 *     -> HTTP 200, tier PILOT -> PREMIUM, status ACTIVE
 *
 * Der "Token" wurde an `startsWith('mock_')` geprüft — ein sichtbares
 * Praefix, kein Geheimnis. Ergebnis: jeder KANZLEI_ADMIN konnte sich ohne
 * Zahlung PREMIUM geben, und PREMIUM schaltet `custom-domain`,
 * `public-api` und `white-label-branding` frei.
 *
 * Der Test ist bewusst gegen die ERSCHEINUNGSFORM geschrieben, nicht gegen
 * die Implementierung: massgeblich ist, dass `applyTierChange` NICHT
 * aufgerufen wird. Eine Umbenennung der Pruefung aendert daran nichts.
 */

const KANZLEI = '11111111-1111-4111-8111-111111111111';
const USER = '33333333-3333-4333-8333-333333333333';
const MANDANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const admin = {
  id: USER,
  globalRole: null,
  mandanten: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', rolle: 'KANZLEI_ADMIN' }],
} as unknown as AuthUser;

function buildService(opts: { mockFlag?: string; providerName?: string }) {
  const applyTierChange = vi.fn().mockResolvedValue({
    kanzleiId: KANZLEI,
    tier: 'PREMIUM',
    status: 'ACTIVE',
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
    { findById: vi.fn().mockResolvedValue({ id: KANZLEI }) } as never,
    { record: vi.fn().mockResolvedValue(undefined) } as never,
    { getProviderName: () => opts.providerName ?? 'mock' } as never,
    // FeatureFlagService wird nach dem Schreiben des Tiers befragt.
    {
      getTierConfig: vi.fn().mockReturnValue({ features: [] }),
      getFeatures: vi.fn().mockReturnValue([]),
    } as never,
    {
      get: (k: string) => (k === 'BILLING_MOCK_ENABLED' ? opts.mockFlag : undefined),
    } as never,
  );

  // Zugriff auf das private Feld, um den Schreibpfad zu prüfen.
  const intern = service as unknown as { applyTierChange: typeof applyTierChange };
  intern.applyTierChange = applyTierChange;

  return { service, applyTierChange };
}

const ctx = { ip: null, userAgent: null };

describe('mockActivate ist explizit freizuschalten, nicht Nebenwirkung', () => {
  it('ohne BILLING_MOCK_ENABLED geht es nicht — auch nicht bei aktivem Mock-Provider', () => {
    const { service, applyTierChange } = buildService({ mockFlag: undefined, providerName: 'mock' });

    // providerName 'mock' ist exakt die Konfiguration, die vorher
    // genuegte. Sie darf den Weg nicht mehr oeffnen.
    return expect(
      service.mockActivate(KANZLEI, admin, 'PREMIUM' as never, 'mock_egal', ctx),
    ).rejects.toBeInstanceOf(NotFoundException).then(() => {
      expect(applyTierChange).not.toHaveBeenCalled();
    });
  });

  it('BILLING_MOCK_ENABLED=false öffnet ihn ebenfalls nicht', async () => {
    const { service, applyTierChange } = buildService({ mockFlag: 'false' });

    await expect(
      service.mockActivate(KANZLEI, admin, 'PREMIUM' as never, 'mock_egal', ctx),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(applyTierChange).not.toHaveBeenCalled();
  });

  it('mit ausdrücklicher Freischaltung funktioniert es weiter', async () => {
    // Der Weg soll nicht kaputtgemacht werden — der Pilot und die
    // Playwright-Suite brauchen ihn. Gesperrt ist er NUR ohne Entscheidung.
    const { service, applyTierChange } = buildService({ mockFlag: 'true' });

    await service.mockActivate(KANZLEI, admin, 'PREMIUM' as never, 'mock_ok', ctx);

    expect(applyTierChange).toHaveBeenCalledWith(
      KANZLEI,
      'PREMIUM',
      'ACTIVE',
      'mock',
      'mock_ok',
    );
  });

  it('eine gesetzte Freischaltung allein genügt nicht: echter Provider bleibt zu', async () => {
    // Sonst wäre die Freischaltung im Produktivbetrieb mit Stripe aktiv
    // und würde einen zweiten Bypass eröffnen.
    const { service, applyTierChange } = buildService({ mockFlag: 'true', providerName: 'stripe' });

    await expect(
      service.mockActivate(KANZLEI, admin, 'PREMIUM' as never, 'mock_ok', ctx),
    ).rejects.toThrow();
    expect(applyTierChange).not.toHaveBeenCalled();
  });
});