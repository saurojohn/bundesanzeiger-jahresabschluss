import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { CommonRepositoriesModule } from '../../common/repositories/common-repositories.module';
import { AuditModule } from '../audit/audit.module';
import { SubscriptionController } from './controllers/subscription.controller';
import { BillingWebhookController } from './controllers/billing-webhook.controller';
import { SubscriptionService } from './services/subscription.service';
import { BillingProviderService } from './services/billing-provider.service';
import { FeatureFlagService } from './services/feature-flag.service';
import { BillingWebhookService } from './services/billing-webhook.service';

/**
 * Subscription-Modul (M4 Sprint 3).
 *
 * Verantwortlich für:
 *   - Tier-Management (Pilot / Standard / Premium)
 *   - Billing-Provider-Abstraktion (Strategy-Pattern: Stripe / Mock / etc.)
 *   - Feature-Flags pro Tier
 *   - Webhook-Verarbeitung von Billing-Events
 *
 * Mandant-Trennung: Subscription-Status ist an KANZLEI gebunden, nicht
 * an einzelne Mandanten. Eine Kanzlei hat genau 1 aktive Subscription.
 *
 * RBAC:
 *   - GET /subscription: alle User der Kanzlei
 *   - PATCH/POST/DELETE: nur KANZLEI_ADMIN oder SYSTEM_ADMIN
 *
 * Setup:
 *   - Provider 'mock' aktiv wenn STRIPE_SECRET_KEY nicht gesetzt (Dev/Pilot)
 *   - Provider 'stripe' aktiv wenn STRIPE_SECRET_KEY vorhanden
 */
@Module({
  imports: [ConfigModule, ScheduleModule.forRoot(), AuditModule, CommonRepositoriesModule],
  controllers: [SubscriptionController, BillingWebhookController],
  providers: [SubscriptionService, BillingProviderService, FeatureFlagService, BillingWebhookService],
  exports: [SubscriptionService, FeatureFlagService],
})
export class SubscriptionModule {}