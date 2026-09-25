/**
 * Subscription-Tiers (M4 Sprint 3).
 *
 * Drei Stufen mit unterschiedlichen Feature-Sets und Limits:
 *
 *   - PILOT    (kostenlos): 3 Mandanten, alle Basis-Features
 *   - STANDARD (€49/Monat): 25 Mandanten, +DATEV-Import, +Konzernabschluss
 *   - PREMIUM  (€149/Monat): unlimited, +Custom-Domain, +Public-API, +White-Label
 *
 * Feature-Flags werden in `feature-flag.service.ts` ausgewertet.
 */
export const SUBSCRIPTION_TIERS = ['PILOT', 'STANDARD', 'PREMIUM'] as const;
export type SubscriptionTier = (typeof SUBSCRIPTION_TIERS)[number];

/**
 * Tier-Limits und Features als Single-Source-of-Truth.
 */
export interface TierConfig {
  readonly tier: SubscriptionTier;
  readonly displayName: string;
  readonly description: string;
  readonly pricePerMonthEur: number;
  readonly maxMandanten: number;
  readonly features: ReadonlySet<FeatureFlag>;
}

export const FEATURE_FLAGS = [
  // Basis-Features (alle Tiers)
  'bilanz-erfassung',
  'guv-erfassung',
  'anhang-erfassung',
  'pdf-generation',
  'worm-archivierung',
  // Standard-Features
  'datev-export',
  'datev-import',
  'konzernabschluss',
  'wirtschaftspruefer',
  // Premium-Features
  'custom-domain',
  'public-api',
  'white-label-branding',
  'priority-support',
] as const;
export type FeatureFlag = (typeof FEATURE_FLAGS)[number];

export const TIER_CONFIGS: Readonly<Record<SubscriptionTier, TierConfig>> = {
  PILOT: {
    tier: 'PILOT',
    displayName: 'Pilot',
    description: 'Kostenlos für Pilot-Kanzleien (3 Mandanten, alle Basis-Features)',
    pricePerMonthEur: 0,
    maxMandanten: 3,
    features: new Set<FeatureFlag>([
      'bilanz-erfassung',
      'guv-erfassung',
      'anhang-erfassung',
      'pdf-generation',
      'worm-archivierung',
    ]),
  },
  STANDARD: {
    tier: 'STANDARD',
    displayName: 'Standard',
    description: 'Für aktive Steuerberatungs-Kanzleien (25 Mandanten, DATEV-Suite)',
    pricePerMonthEur: 49,
    maxMandanten: 25,
    features: new Set<FeatureFlag>([
      'bilanz-erfassung',
      'guv-erfassung',
      'anhang-erfassung',
      'pdf-generation',
      'worm-archivierung',
      'datev-export',
      'datev-import',
      'konzernabschluss',
      'wirtschaftspruefer',
    ]),
  },
  PREMIUM: {
    tier: 'PREMIUM',
    displayName: 'Premium',
    description: 'White-Label + Custom-Domain + Public-API + Priority-Support',
    pricePerMonthEur: 149,
    maxMandanten: Number.POSITIVE_INFINITY,
    features: new Set<FeatureFlag>(FEATURE_FLAGS),
  },
};

/**
 * Stripe-Price-IDs (in Stripe-Dashboard hinterlegt).
 * ENV-Variablen überschreiben diese Defaults zur Laufzeit.
 */
export const STRIPE_PRICE_IDS: Readonly<Record<SubscriptionTier, string>> = {
  PILOT: process.env.STRIPE_PRICE_PILOT ?? 'price_pilot_free',
  STANDARD: process.env.STRIPE_PRICE_STANDARD ?? 'price_standard_49eur',
  PREMIUM: process.env.STRIPE_PRICE_PREMIUM ?? 'price_premium_149eur',
};

/**
 * Subscription-Status (Stripe-konform).
 */
export const SUBSCRIPTION_STATUSES = [
  'TRIALING',
  'ACTIVE',
  'PAST_DUE',
  'CANCELED',
  'INCOMPLETE',
  'INCOMPLETE_EXPIRED',
  'UNPAID',
  'PAUSED',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/**
 * Welche Statuses gewähren Feature-Zugriff?
 */
export const ACTIVE_STATUSES = new Set<SubscriptionStatus>([
  'TRIALING',
  'ACTIVE',
]);