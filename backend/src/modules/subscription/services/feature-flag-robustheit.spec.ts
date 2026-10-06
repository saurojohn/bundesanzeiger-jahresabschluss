/**
 * Regressionstest: unplausible Abo-Werte dürfen keinen 500 erzeugen.
 *
 * Bugfix 2026-10-07. `loadSubscriptionFromDb()` machte
 *
 *   const tier = (k.subscriptionTier ?? 'PILOT') as SubscriptionTier;
 *
 * — ein reiner Typ-Cast ohne Prüfung gegen die Whitelist. Der Wert
 * stammt aus der Datenbank, ursprünglich aus Stripe-Metadaten, die
 * niemand validiert.
 *
 * Ein unbekannter Tier ließ `getTierConfig()` `undefined` liefern;
 * der Aufrufer griff ungeschützt auf `tierConfig.maxMandanten` zu:
 * TypeError, HTTP 500 für `GET /api/subscription/:kanzleiId`.
 *
 * Ein einzelner unplausibler Datenbankwert hatte damit einen
 * DoS-ähnlichen Effekt auf die betroffene Kanzlei.
 */

import { describe, it, expect, vi } from 'vitest';
import { FeatureFlagService } from './feature-flag.service';
import {
  SUBSCRIPTION_TIERS,
  SUBSCRIPTION_STATUSES,
} from '../constants/subscription-tier.constants';

describe('FeatureFlagService: fail-closed bei unbekanntem Tier', () => {
  const service = new FeatureFlagService();

  it('liefert für einen unbekannten Tier eine Config statt undefined', () => {
    // Das war der Auslöser: `undefined` → `tierConfig.maxMandanten`
    // → TypeError → HTTP 500.
    const config = service.getTierConfig('GIBT-ES-NICHT' as never);
    expect(config).toBeDefined();
    expect(config.tier).toBe('PILOT');
    expect(config.maxMandanten).toBeDefined();
  });

  it('fällt auf den am wenigsten berechtigenden Tier zurück', () => {
    // PILOT hat nicht alle Features — der Rücksprung darf kein
    // unbeabsichtigtes Premium-Freischalten sein.
    expect(service.has('GIBT-ES-NICHT' as never, 'public-api')).toBe(false);
  });

  it('gibt es für alle bekannten Tiers zurück', () => {
    for (const t of SUBSCRIPTION_TIERS) {
      expect(service.getTierConfig(t).tier).toBe(t);
    }
  });

  it('getFeatures liefert für einen unbekannten Tier eine leere Liste', () => {
    expect(service.getFeatures('QUATSCH' as never)).toEqual([]);
  });

  it('isWithinLimit verweigert bei unbekanntem Tier', () => {
    expect(
      service.isWithinLimit('QUATSCH' as never, 'maxMandanten', 1),
    ).toBe(false);
  });
});

describe('Abo-Werte: Whitelist', () => {
  const service = new FeatureFlagService();
  it('die tatsächlich vorhandenen Tier sind bekannt', () => {
    // Schützt davor, dass jemand `SUBSCRIPTION_TIERS` erweitert und
    // dabei die Validierung vergisst.
    expect([...SUBSCRIPTION_TIERS]).toEqual(['PILOT', 'STANDARD', 'PREMIUM']);
  });

  it('die Status-Whitelist ist nicht leer und eindeutig', () => {
    expect(SUBSCRIPTION_STATUSES.length).toBeGreaterThan(0);
    expect(new Set(SUBSCRIPTION_STATUSES).size).toBe(
      SUBSCRIPTION_STATUSES.length,
    );
  });

  it('ein normalisierter Tier ist immer ein echter Tier', () => {
    // bildet die Normalisierung im Service nach
    const normalisiere = (roh: string | null): string => {
      const wert = roh ?? 'PILOT';
      return (SUBSCRIPTION_TIERS as readonly string[]).includes(wert)
        ? wert
        : 'PILOT';
    };
    expect(normalisiere('PREMIUM')).toBe('PREMIUM');
    expect(normalisiere('STANDARD')).toBe('STANDARD');
    expect(normalisiere(null)).toBe('PILOT');
    expect(normalisiere('GOLD')).toBe('PILOT');
    expect(normalisiere('')).toBe('PILOT');
    // Und der Rückfallwert existiert wirklich.
    expect(SUBSCRIPTION_TIERS).toContain(normalisiere('GOLD'));
  });

  it('ein normalisierter Status ist immer ein echter Status', () => {
    const normalisiere = (roh: string | null): string => {
      const wert = roh ?? 'TRIALING';
      return (SUBSCRIPTION_STATUSES as readonly string[]).includes(wert)
        ? wert
        : 'TRIALING';
    };
    expect(normalisiere('ACTIVE')).toBe('ACTIVE');
    expect(normalisiere('ERFUNDEN')).toBe('TRIALING');
    expect(SUBSCRIPTION_STATUSES).toContain(normalisiere('ERFUNDEN'));
  });

  it('der Logger meldet den Rückfall, statt ihn zu schlucken', () => {
    const spy = vi.spyOn(
      (service as unknown as { logger: { warn: (m: string) => void } }).logger,
      'warn',
    );
    service.getTierConfig('GIBT-ES-NICHT' as never);
    expect(spy).toHaveBeenCalled();
    expect(String(spy.mock.calls[0][0])).toMatch(/Unbekannter Tier/);
  });
});