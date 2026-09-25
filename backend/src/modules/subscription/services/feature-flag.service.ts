import { Injectable, Logger } from '@nestjs/common';
import type { SubscriptionTier, FeatureFlag } from '../constants/subscription-tier.constants';
import { TIER_CONFIGS } from '../constants/subscription-tier.constants';

/**
 * Feature-Flag-Service (M4 Sprint 3).
 *
 * Single-Point-of-Truth für "darf Kanzlei X Feature Y nutzen?".
 * Basiert rein auf dem Tier — keine User-Overrides im Pilot.
 *
 * Verwendung überall im Code:
 *   if (!featureFlags.has(kanzleiTier, 'public-api')) throw 403;
 *
 * Im Controller:
 *   @FeatureFlag('custom-domain')
 *   async setCustomDomain() { ... }  // → 403 wenn Tier < PREMIUM
 *
 * Backwards-Compat:
 *   - Wenn Kanzlei keinen Tier gesetzt hat → PILOT (kostenlos, restriktiv)
 *   - Verhindert versehentliche Feature-Freischaltung bei Migration
 */
@Injectable()
export class FeatureFlagService {
  private readonly logger = new Logger(FeatureFlagService.name);

  /**
   * Prüft ob ein Tier ein bestimmtes Feature hat.
   *
   * @param tier — aktueller Tier der Kanzlei (oder 'PILOT' als Default)
   * @param feature — zu prüfendes Feature
   * @returns true wenn erlaubt
   */
  has(tier: SubscriptionTier, feature: FeatureFlag): boolean {
    const tierConfig = TIER_CONFIGS[tier];
    if (!tierConfig) {
      this.logger.warn(`Unbekannter Tier: '${tier}' — Default-Verhalten: Feature verweigert`);
      return false;
    }
    return tierConfig.features.has(feature);
  }

  /**
   * Liefert alle Features eines Tiers.
   */
  getFeatures(tier: SubscriptionTier): readonly FeatureFlag[] {
    const tierConfig = TIER_CONFIGS[tier];
    if (!tierConfig) return [];
    return Array.from(tierConfig.features);
  }

  /**
   * Liefert die Tier-Config (für UI-Anzeige: Preis, Limits, Features).
   */
  getTierConfig(tier: SubscriptionTier) {
    return TIER_CONFIGS[tier];
  }

  /**
   * Liefert alle Tier-Configs (für Pricing-Page).
   */
  getAllTierConfigs() {
    return Object.values(TIER_CONFIGS);
  }

  /**
   * Prüft Tier-Limit (z.B. maxMandanten).
   *
   * @returns true wenn innerhalb des Limits oder Limit = unendlich
   */
  isWithinLimit(tier: SubscriptionTier, feature: 'maxMandanten', currentCount: number): boolean {
    const config = TIER_CONFIGS[tier];
    if (!config) return false;
    const limit = config[feature];
    if (!Number.isFinite(limit)) return true; // unendlich
    return currentCount < limit;
  }
}