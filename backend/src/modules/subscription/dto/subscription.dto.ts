import { IsEnum, IsString, IsUrl } from 'class-validator';
import type {
  SubscriptionTier,
  SubscriptionStatus,
} from '../constants/subscription-tier.constants';
import { SUBSCRIPTION_TIERS } from '../constants/subscription-tier.constants';

/**
 * DTO für Subscription-Status einer Kanzlei (Response).
 */
export class SubscriptionResponseDto {
  kanzleiId!: string;
  tier!: SubscriptionTier;
  status!: SubscriptionStatus;
  providerName!: 'stripe' | 'mock';
  providerSubscriptionId!: string | null;
  currentPeriodEnd!: Date | null;
  cancelAtPeriodEnd!: boolean;
  maxMandanten!: number;
  features!: readonly string[];
  updatedAt!: Date;
}

/**
 * DTO für Upgrade/Downgrade-Request.
 *
 * Frontend ruft diesen Endpoint auf mit gewünschtem Tier + success/cancel-URL.
 * Backend erstellt Stripe-Checkout-Session (oder Mock-URL) und gibt sie zurück.
 */
export class CreateCheckoutDto {
  @IsEnum(SUBSCRIPTION_TIERS, { message: 'Tier muss PILOT, STANDARD oder PREMIUM sein' })
  tier!: SubscriptionTier;

  @IsUrl({ require_tld: false })
  successUrl!: string;

  @IsUrl({ require_tld: false })
  cancelUrl!: string;
}

export class CheckoutResponseDto {
  url!: string;
  sessionId!: string;
  providerName!: 'stripe' | 'mock';
}

/**
 * DTO für Mock-Mode-Direkt-Activation (Dev/Pilot only).
 *
 * Im echten Stripe-Mode wird die Subscription via Webhook gesetzt.
 * Im Mock-Mode (Dev) kann der Frontend-Wizard den Tier direkt aktivieren.
 */
export class MockActivateDto {
  @IsEnum(SUBSCRIPTION_TIERS)
  tier!: SubscriptionTier;

  @IsString()
  mockSession!: string;
}

export class PortalResponseDto {
  url!: string;
}
export class CancelResponseDto {
  canceled!: boolean;
  effectiveAt!: Date;
}