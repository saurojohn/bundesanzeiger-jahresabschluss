import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { ApiModule } from '../api/api.module';
import { CommonRepositoriesModule } from '../../common/repositories/common-repositories.module';
import { WebhookService } from './services/webhook.service';
import { WebhookRepository } from './webhook.repository';
import { WebhookController } from './controllers/webhook.controller';

/**
 * Webhook-Modul (M4 Sprint 1).
 *
 * Endpoints:
 *   POST   /api/webhook-subscriptions            — erstellen (KANZLEI_ADMIN)
 *   GET    /api/webhook-subscriptions            — listen (alle User der Kanzlei)
 *   GET    /api/webhook-subscriptions/:id/deliveries
 *   DELETE /api/webhook-subscriptions/:id        — löschen (KANZLEI_ADMIN)
 *   POST   /api/webhook-subscriptions/:id/test   — Test-Delivery (KANZLEI_ADMIN)
 *
 * Outgoing-Delivery: `WebhookService.emit()` und `WebhookService.deliver()`
 * werden vom Domain-Code aufgerufen (z.B. nach BAnz-Submission-Update).
 *
 * Abhängigkeiten:
 *   - AuthModule             — JWT-Auth-Guard + JwtService
 *   - ApiModule              — ApiKeyService.signWebhookPayload (HMAC)
 *   - AuditModule            — Audit-Trail für Subscription-Mutationen
 *   - CommonRepositoriesModule — KanzleiRepository (für resolveKanzleiId)
 */
@Module({
  imports: [AuthModule, AuditModule, ApiModule, CommonRepositoriesModule],
  controllers: [WebhookController],
  providers: [WebhookService, WebhookRepository],
  exports: [WebhookService, WebhookRepository],
})
export class WebhookModule {}