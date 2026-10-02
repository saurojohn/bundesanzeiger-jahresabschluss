import { describe, it, expect } from 'vitest';
import { FeatureFlagService } from './feature-flag.service';
import { TIER_CONFIGS } from '../constants/subscription-tier.constants';

/**
 * Regressionstest für die Serialierbarkeit der Tier-Configs (2026-10-03).
 *
 * `TierConfig.features` ist intern ein `ReadonlySet`. `Set` hat keine
 * enumerable eigenen Properties und wird von `JSON.stringify` zu `{}`
 * serialisiert. Der `/subscription/tiers`-Endpoint gab deshalb
 * `features: {}` an den Client — die Pricing-Seite zeigte keine einzige
 * Feature-Zeile, ohne dass ein Fehler auftrat. Ebenso wurde
 * `maxMandanten: Infinity` zu `null`.
 *
 * Der Test prüft die JSON-Rundefahrt, weil genau dort der Informations-
 * verlust passiert — ein Typ-Interface allein hätte es nicht gezeigt.
 */
describe('Tier-Configs — JSON-Serialisierung', () => {
  const service = new FeatureFlagService();

  it('verliert die Features nicht bei der JSON-Serialisierung', () => {
    const payload = {
      tiers: service.getAllTierConfigs().map((t) => ({
        tier: t.tier,
        displayName: t.displayName,
        description: t.description,
        pricePerMonthEur: t.pricePerMonthEur,
        maxMandanten: Number.isFinite(t.maxMandanten) ? t.maxMandanten : -1,
        features: Array.from(t.features),
      })),
    };
    const roundTrip = JSON.parse(JSON.stringify(payload)) as typeof payload;

    for (const tier of roundTrip.tiers) {
      expect(
        Array.isArray(tier.features),
        `${tier.tier}: features ist kein Array (${JSON.stringify(tier.features)})`,
      ).toBe(true);
      expect(
        tier.features.length,
        `${tier.tier}: features ist leer — die Pricing-Seite zeigt nichts`,
      ).toBeGreaterThan(0);
      for (const f of tier.features) {
        expect(typeof f, `${tier.tier}: Feature ist kein String`).toBe('string');
      }
    }
  });

  it('verliert die Features bei DIREKTER Serialisierung (der alte Fehler)', () => {
    // Ohne das Mapping: genau das, was der Endpoint vorher tat.
    const direkt = JSON.parse(
      JSON.stringify({ tiers: service.getAllTierConfigs() }),
    ) as { tiers: Array<{ tier: string; features: unknown; maxMandanten: unknown }> };

    for (const tier of direkt.tiers) {
      // Das ist der Beweis, dass die Abbildung im Controller nötig ist.
      expect(tier.features).toEqual({});
    }
  });

  it('bildet das Premium-Tier nicht als null maxMandanten ab', () => {
    const premium = TIER_CONFIGS.PREMIUM;
    expect(Number.isFinite(premium.maxMandanten)).toBe(false);

    const payload = {
      maxMandanten: Number.isFinite(premium.maxMandanten)
        ? premium.maxMandanten
        : -1,
    };
    // Ohne das Mapping wäre Infinity → null geworden.
    expect(JSON.parse(JSON.stringify(payload)).maxMandanten).toBe(-1);
  });

  it('enthält im Premium-Tier die erwarteten Features', () => {
    const features = Array.from(TIER_CONFIGS.PREMIUM.features);
    expect(features).toContain('custom-domain');
    expect(features).toContain('public-api');
    expect(features).toContain('white-label-branding');
  });
});
