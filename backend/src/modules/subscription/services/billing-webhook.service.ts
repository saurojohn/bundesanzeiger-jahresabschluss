import { Injectable, Logger } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { BillingProviderService } from './billing-provider.service';
import { AuditService } from '../../audit/services/audit.service';

/**
 * Billing-Webhook-Service (M4 Sprint 3).
 *
 * Verarbeitet Webhook-Events von Billing-Providern (Stripe).
 * Normalisiert die Events via BillingProvider.handleWebhook() und
 * wendet sie auf die Kanzlei-Subscription an.
 *
 * Webhook-Endpoint wird im `billing-webhook.controller.ts` exponiert.
 */
@Injectable()
export class BillingWebhookService {
  private readonly logger = new Logger(BillingWebhookService.name);

  constructor(
    private readonly billingProvider: BillingProviderService,
    private readonly subscriptionService: SubscriptionService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Verarbeitet einen rohen Webhook-Body.
   *
   * @returns true wenn Event verarbeitet wurde, false wenn ignoriert
   * @throws Error bei Signatur-Verifikation oder Parsing-Fehler
   */
  async process(rawBody: Buffer, signature: string | null): Promise<boolean> {
    const event = await this.billingProvider.getProvider().handleWebhook(rawBody, signature);
    if (!event) {
      this.logger.debug('Webhook-Event ignoriert (kein Billing-Event)');
      return false;
    }

    await this.subscriptionService.applyTierChange(
      event.kanzleiId,
      event.tier,
      event.status,
      this.billingProvider.getProviderName(),
      event.providerSubscriptionId,
    );

    void this.auditService.record({
      userId: null, // Webhook hat keinen User-Kontext
      kanzleiId: event.kanzleiId,
      action: 'UPDATE',
      entityType: 'SubscriptionWebhook',
      entityId: event.providerSubscriptionId,
      newState: {
        eventType: event.type,
        tier: event.tier,
        status: event.status,
      },
      ipAddress: null,
      userAgent: 'billing-webhook',
    });

    this.logger.log(
      `Webhook verarbeitet: ${event.type} kanzleiId=${event.kanzleiId} tier=${event.tier} status=${event.status}`,
    );
    return true;
  }
}