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
import { Public } from '../../auth/decorators/public.decorator';
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
// BEFUND 2026-10-19 (Nachtrag 46): Der Kommentar oben sagt „Endpoint ist
// @Public()" — der Dekorator stand aber **nirgends**. Da `JwtAuthGuard` als
// globaler `APP_GUARD` laeuft, wurde jeder Aufruf abgewiesen, BEVOR der
// Controller erreicht wurde. Gemessen, vier Formen:
//
//     POST /api/subscription/webhook  (mit Signatur)   -> 401
//     POST /api/subscription/webhook  (ohne Signatur)  -> 401
//     POST /api/subscription/webhook  (Roh-Body, gefaelschte Signatur)
//                                                           -> 401
//
// **Folge: Stripe konnte nie ein Webhook zustellen.** Checkout-Abschluss,
// Tarifwechsel und Kuendigung haetten die Entitlements nie aktualisiert —
// der komplette Zahlungslebenszyklus waere im Produktivbetrieb tot.
//
// Der `@Public()`-Pfad macht die Signaturpruefung zur einzigen
// Authentifizierung. Sie ist echt (Stripe `constructEvent`), und
// `STRIPE_WEBHOOK_SECRET` wird jetzt fail-closed behandelt — siehe
// `billing-provider.service.ts`.
@Public()
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