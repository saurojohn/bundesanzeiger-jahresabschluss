import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { BillingWebhookService } from '../services/billing-webhook.service';

/**
 * Billing-Webhook-Controller (M4 Sprint 3).
 *
 * Empfängt Webhooks von Billing-Providern (Stripe).
 *
 * WICHTIG:
 *   - Body wird als raw Buffer erwartet (NICHT als JSON geparst) — die
 *     Stripe-Signatur-Verifikation benötigt den exakten Original-Body.
 *   - Express-Setup in main.ts muss `bodyParser: { raw: true }` für
 *     diese Route aktivieren (siehe main.ts).
 *   - Endpoint ist @Public() (keine Auth) — Webhooks werden via
 *     Signatur (Stripe-Signature-Header) authentifiziert.
 *   - Throttling ist deaktiviert (Webhooks kommen von Stripe-Servern).
 *
 * Aufruf:
 *   POST /api/subscription/webhook
 *   Headers: stripe-signature: t=...,v1=...
 *   Body: roher Stripe-Webhook-Payload
 */
@Controller('subscription/webhook')
@SkipThrottle()
export class BillingWebhookController {
  constructor(private readonly webhookService: BillingWebhookService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async handleStripeWebhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('stripe-signature') signature: string | undefined,
  ): Promise<{ received: boolean }> {
    // Express muss uns den rohen Body liefern (nicht JSON-geparst).
    // Falls main.ts das nicht konfiguriert hat, ist req.rawBody undefined.
    const rawBody = req.rawBody ?? (req.body as Buffer);
    if (!Buffer.isBuffer(rawBody)) {
      throw new BadRequestException(
        'Webhook-Body muss als roher Buffer ankommen — Express-Konfiguration prüfen',
      );
    }

    const processed = await this.webhookService.process(rawBody, signature ?? null);
    return { received: processed };
  }
}