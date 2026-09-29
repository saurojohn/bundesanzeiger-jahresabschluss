import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import axios, { AxiosError } from 'axios';
import { assertResolvesToPublicAddress } from '../../../common/security/ssrf-guard';
import { AuditService } from '../../audit/services/audit.service';
import { ApiKeyService } from '../../api/services/api-key.service';
import {
  WEBHOOK_DELIVERY_TIMEOUT_MS,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_RETRY_DELAYS_MS,
  isWebhookEvent,
  type WebhookEvent,
} from '../constants/webhook-events.constants';
import { WebhookRepository } from '../webhook.repository';
import {
  CreateWebhookSubscriptionDto,
  CreateWebhookSubscriptionResponseDto,
  WebhookDeliveryDto,
  WebhookSubscriptionDto,
} from '../dto/webhook-subscription.dto';
import type { AuthUser } from '../../auth/types/auth-user.types';

/**
 * Kontext für Webhook-Mutationen (Audit).
 */
export interface WebhookContext {
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Service für Webhook-Subscription-Management + Delivery (M4 Sprint 1).
 *
 * Verantwortlich für:
 *   - Subscription-CRUD (Create / List / Delete / Test)
 *   - Outgoing-Webhook-Delivery mit HMAC-SHA256-Signatur
 *   - Exponential-Backoff-Retry (1s, 5s, 30s → DEAD_LETTER nach 3 Versuchen)
 *   - Audit-Trail (CREATE / DELETE / DELIVERED / FAILED)
 *
 * HMAC-Format: `sha256=<hex>` über `timestamp.body` (verhindert Replay).
 *
 * Mandant-Trennung: jede Subscription bound an genau 1 Kanzlei.
 */
@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly repository: WebhookRepository,
    private readonly auditService: AuditService,
    private readonly apiKeyService: ApiKeyService,
  ) {}

  // ===========================================================================
  // Subscription CRUD
  // ===========================================================================

  /**
   * Erstellt eine neue Webhook-Subscription. Plaintext-Secret wird EINMAL
   * zurückgegeben — der Client muss es für HMAC-Verifikation speichern.
   */
  async createSubscription(
    args: CreateWebhookSubscriptionDto & { kanzleiId: string },
    user: AuthUser,
    context: WebhookContext,
  ): Promise<CreateWebhookSubscriptionResponseDto> {
    this.assertKanzleiAdminAccess(args.kanzleiId, user);

    // Event-Validierung
    for (const e of args.events) {
      if (!isWebhookEvent(e)) {
        throw new BadRequestException(`Unbekannter Event-Typ: ${e}`);
      }
    }

    const plaintextSecret =
      args.secret ?? randomBytes(24).toString('base64url');

    const created = await this.repository.createSubscription({
      kanzlei: { connect: { id: args.kanzleiId } },
      url: args.url,
      events: args.events as string[],
      secret: plaintextSecret,
      isActive: true,
      createdBy: user.id ? { connect: { id: user.id } } : undefined,
    });

    void this.auditService.record({
      userId: user.id,
      kanzleiId: args.kanzleiId,
      action: 'CREATE',
      entityType: 'WebhookSubscription',
      entityId: created.id,
      newState: {
        url: created.url,
        events: created.events,
        isActive: created.isActive,
      } as Prisma.JsonValue,
      ipAddress: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return {
      subscription: this.toSubscriptionDto(created),
      plaintextSecret,
    };
  }

  /**
   * Liste Subscriptions einer Kanzlei (OHNE Secret).
   */
  async listSubscriptions(
    kanzleiId: string,
    user: AuthUser,
  ): Promise<WebhookSubscriptionDto[]> {
    this.assertKanzleiAccess(kanzleiId, user);
    const subs = await this.repository.findSubscriptionsByKanzlei(kanzleiId);
    return subs.map((s) => this.toSubscriptionDto(s));
  }

  /**
   * Löscht eine Subscription (KANZLEI_ADMIN).
   */
  async deleteSubscription(
    id: string,
    kanzleiId: string,
    user: AuthUser,
    context: WebhookContext,
  ): Promise<void> {
    this.assertKanzleiAdminAccess(kanzleiId, user);

    const before = await this.repository.findSubscriptionById(id, kanzleiId);
    if (!before) throw new NotFoundException('Subscription nicht gefunden');

    await this.repository.deleteSubscription(id, kanzleiId);

    void this.auditService.record({
      userId: user.id,
      kanzleiId,
      action: 'DELETE',
      entityType: 'WebhookSubscription',
      entityId: id,
      previousState: {
        url: before.url,
        events: before.events,
        isActive: before.isActive,
      } as Prisma.JsonValue,
      ipAddress: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });
  }

  /**
   * Liefert die letzten N Deliveries einer Subscription.
   */
  async listDeliveries(
    subscriptionId: string,
    kanzleiId: string,
    user: AuthUser,
    limit: number = 50,
  ): Promise<WebhookDeliveryDto[]> {
    // Verify Subscription gehört zur Kanzlei
    const sub = await this.repository.findSubscriptionById(
      subscriptionId,
      kanzleiId,
    );
    if (!sub) throw new NotFoundException('Subscription nicht gefunden');
    this.assertKanzleiAccess(kanzleiId, user);

    const deliveries = await this.repository.findDeliveriesBySubscription(
      subscriptionId,
      limit,
    );
    return deliveries.map((d) => this.toDeliveryDto(d));
  }

  /**
   * Test-Delivery: sendet ein "ping"-Webhook aus und gibt die Delivery-ID zurück.
   */
  async testDelivery(
    subscriptionId: string,
    kanzleiId: string,
    user: AuthUser,
  ): Promise<{ deliveryId: string }> {
    this.assertKanzleiAdminAccess(kanzleiId, user);

    const sub = await this.repository.findSubscriptionById(
      subscriptionId,
      kanzleiId,
    );
    if (!sub) throw new NotFoundException('Subscription nicht gefunden');

    const payload: WebhookEventPayload = {
      test: true,
      message: 'Test-Webhook von Bundesanzeiger-Jahresabschluss',
      subscriptionId: sub.id,
      kanzleiId: sub.kanzleiId,
    };

    const delivery = await this.repository.createDelivery({
      subscription: { connect: { id: sub.id } },
      event: 'banz.submission.published',
      payload: payload as unknown as Prisma.InputJsonValue,
      attemptCount: 0,
      maxAttempts: WEBHOOK_MAX_ATTEMPTS,
      status: 'PENDING',
      scheduledAt: new Date(),
    });

    // Sofortige Delivery (fire-and-forget, aber wir geben die ID zurück)
    void this.deliver(delivery.id);

    return { deliveryId: delivery.id };
  }

  // ===========================================================================
  // Event Emitting (von Domain-Services aufzurufen)
  // ===========================================================================

  /**
   * Emittiert ein Event an alle aktiven Subscriptions.
   *
   * Erstellt je Subscription einen WebhookDelivery-Eintrag mit status=PENDING.
   * Die Delivery wird per setImmediate / await gestartet (fire-and-forget).
   */
  async emit(
    event: WebhookEvent,
    payload: WebhookEventPayload,
    kanzleiId: string,
  ): Promise<void> {
    if (!isWebhookEvent(event)) {
      this.logger.warn(`emit: unbekannter Event-Typ ${event}`);
      return;
    }

    const subs = await this.repository.findActiveSubscriptionsForEvent(
      kanzleiId,
      event,
    );
    for (const sub of subs) {
      const delivery = await this.repository.createDelivery({
        subscription: { connect: { id: sub.id } },
        event,
        payload: payload as unknown as Prisma.InputJsonValue,
        attemptCount: 0,
        maxAttempts: WEBHOOK_MAX_ATTEMPTS,
        status: 'PENDING',
        scheduledAt: new Date(),
      });

      // Delivery starten — fire-and-forget
      void this.deliver(delivery.id);
    }
  }

  // ===========================================================================
  // Outgoing Delivery
  // ===========================================================================

  /**
   * Liefert ein einzelnes Webhook-Delivery aus.
   *
   * Ablauf:
   *   1. Hole WebhookDelivery + Subscription
   *   2. Build HMAC-SHA256-Signatur über `timestamp.body`
   *   3. HTTP-POST mit Headern + Body
   *   4. Response 2xx → status=SUCCESS
   *   5. Response non-2xx oder Fehler → status=FAILED + retry (1s, 5s, 30s)
   *   6. Nach 3 Fehlversuchen → DEAD_LETTER
   */
  async deliver(deliveryId: string): Promise<void> {
    const delivery = await this.repository.findDeliveryById(deliveryId);
    if (!delivery) {
      this.logger.warn(`Delivery ${deliveryId} nicht gefunden`);
      return;
    }
    if (!delivery.subscription) {
      this.logger.warn(
        `Delivery ${deliveryId} ohne Subscription (Cascade-Delete?)`,
      );
      return;
    }
    if (delivery.status === 'SUCCESS' || delivery.status === 'DEAD_LETTER') {
      return; // bereits abgeschlossen
    }

    const sub = delivery.subscription;
    const attemptCount = delivery.attemptCount + 1;
    const timestamp = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({
      id: delivery.id,
      type: delivery.event,
      data: delivery.payload,
      kanzleiId: sub.kanzleiId,
      timestamp: new Date(timestamp * 1000).toISOString(),
    });

    const signature = this.apiKeyService.signWebhookPayload(
      sub.secret,
      timestamp,
      body,
    );

    let responseCode: number | null = null;
    let responseBody: string | null = null;
    let errorMessage: string | null = null;
    let success = false;

    try {
      // Schicht 2 des SSRF-Schutzes: unmittelbar VOR dem Request aufloesen und
      // pruefen, dass KEIN A-Record auf einen internen Bereich zeigt. Die
      // DTO-Pruefung beim Speichern greift nicht bei DNS-Rebinding — ein Host
      // kann zwischen Registrierung und Zustellung auf 127.0.0.1 wechseln.
      await assertResolvesToPublicAddress(sub.url);

      const response = await axios.post(sub.url, body, {
        timeout: WEBHOOK_DELIVERY_TIMEOUT_MS,
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Event': delivery.event,
          'X-Webhook-Id': delivery.id,
          'X-Webhook-Timestamp': String(timestamp),
          'X-Webhook-Signature': `sha256=${signature}`,
          'X-Webhook-Attempt': String(attemptCount),
        },
        validateStatus: () => true, // Wir werten 4xx/5xx selbst aus
      });

      responseCode = response.status;

      // Bugfix 2026-09-28 (Audit): Der Antwortkoerper des Ziels wurde
      // gespeichert und ueber `GET /api/webhook-subscriptions/:id/deliveries`
      // ausgegeben. Zusammen mit der fehlenden Adresspruefung ergab das ein
      // SSRF-Primitive MIT Reading: interne Dienste (Metadaten-Endpoint,
      // Datenbank, RFC1918) lieferten Statuscode + Koerper an den Aufrufer
      // zurueck. Der Koerper wird nicht mehr persistiert — Statuscode und
      // Fehlerklasse genuegen fuer die Zustell-Diagnose; was das Ziel
      // zurueckgibt, gehoert in das Log des Empfaengers.
      responseBody = null;

      if (response.status >= 200 && response.status < 300) {
        success = true;
      } else {
        errorMessage = `HTTP ${String(response.status)}`;
      }
    } catch (err) {
      errorMessage =
        err instanceof AxiosError
          ? `${err.code ?? 'ERR'}: ${err.message}`
          : (err as Error).message;
      this.logger.warn(
        `Webhook delivery ${deliveryId} failed (attempt ${String(attemptCount)}): ${errorMessage}`,
      );
    }

    if (success) {
      await this.repository.updateDelivery(deliveryId, {
        status: 'SUCCESS',
        attemptCount,
        responseCode,
        responseBody,
        completedAt: new Date(),
        nextRetryAt: null,
      });
      void this.repository.updateSubscriptionDeliveryStatus(
        sub.id,
        responseCode,
        new Date(),
      );

      void this.auditService.record({
        userId: null,
        kanzleiId: sub.kanzleiId,
        action: 'CREATE',
        entityType: 'WebhookDelivery',
        entityId: deliveryId,
        newState: {
          event: delivery.event,
          subscriptionId: sub.id,
          attemptCount,
          responseCode,
          status: 'SUCCESS',
        } as Prisma.JsonValue,
      });
      return;
    }

    // Failure → Retry oder DEAD_LETTER
    if (attemptCount >= delivery.maxAttempts) {
      await this.repository.updateDelivery(deliveryId, {
        status: 'DEAD_LETTER',
        attemptCount,
        responseCode,
        responseBody,
        errorMessage,
        completedAt: new Date(),
        nextRetryAt: null,
      });
      void this.repository.updateSubscriptionDeliveryStatus(
        sub.id,
        responseCode,
        new Date(),
      );

      void this.auditService.record({
        userId: null,
        kanzleiId: sub.kanzleiId,
        action: 'UPDATE',
        entityType: 'WebhookDelivery',
        entityId: deliveryId,
        newState: {
          event: delivery.event,
          subscriptionId: sub.id,
          attemptCount,
          status: 'DEAD_LETTER',
          errorMessage,
        } as Prisma.JsonValue,
      });
      return;
    }

    // Schedule next retry
    const delayIndex = Math.min(
      attemptCount,
      WEBHOOK_RETRY_DELAYS_MS.length - 1,
    );
    const delayMs = WEBHOOK_RETRY_DELAYS_MS[delayIndex] ?? 30_000;
    const nextRetryAt = new Date(Date.now() + delayMs);

    await this.repository.updateDelivery(deliveryId, {
      status: 'FAILED',
      attemptCount,
      responseCode,
      responseBody,
      errorMessage,
      nextRetryAt,
    });
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  /**
   * KANZLEI_ADMIN-/SYSTEM_ADMIN-Check (für Mutation).
   */
  private assertKanzleiAdminAccess(kanzleiId: string, user: AuthUser): void {
    if (user.globalRole === 'SYSTEM_ADMIN') return;
    const isKanzleiAdmin = user.mandanten.some(
      (m) => m.rolle === 'KANZLEI_ADMIN',
    );
    if (!isKanzleiAdmin) {
      throw new ForbiddenException(
        'Nur KANZLEI_ADMIN oder SYSTEM_ADMIN darf Webhooks verwalten',
      );
    }
    void kanzleiId;
  }

  /**
   * Read-Check: Jeder User der Kanzlei darf Subscriptions lesen.
   */
  private assertKanzleiAccess(kanzleiId: string, user: AuthUser): void {
    if (user.globalRole === 'SYSTEM_ADMIN') return;
    const hasAccess = user.mandanten.some((m) => m.rolle !== undefined);
    if (!hasAccess) {
      throw new ForbiddenException('Kein Zugriff auf diese Kanzlei');
    }
    void kanzleiId;
  }

  private toSubscriptionDto(entity: {
    id: string;
    kanzleiId: string;
    url: string;
    events: string[];
    isActive: boolean;
    createdAt: Date;
    lastDeliveryAt: Date | null;
    lastDeliveryStatus: number | null;
  }): WebhookSubscriptionDto {
    return {
      id: entity.id,
      kanzleiId: entity.kanzleiId,
      url: entity.url,
      events: entity.events,
      isActive: entity.isActive,
      createdAt: entity.createdAt,
      lastDeliveryAt: entity.lastDeliveryAt,
      lastDeliveryStatus: entity.lastDeliveryStatus,
    };
  }

  private toDeliveryDto(entity: {
    id: string;
    subscriptionId: string;
    event: string;
    attemptCount: number;
    maxAttempts: number;
    status: string;
    responseCode: number | null;
    responseBody: string | null;
    errorMessage: string | null;
    scheduledAt: Date;
    completedAt: Date | null;
    nextRetryAt: Date | null;
  }): WebhookDeliveryDto {
    return {
      id: entity.id,
      subscriptionId: entity.subscriptionId,
      event: entity.event,
      attemptCount: entity.attemptCount,
      maxAttempts: entity.maxAttempts,
      status: entity.status,
      responseCode: entity.responseCode,
      responseBody: entity.responseBody,
      errorMessage: entity.errorMessage,
      scheduledAt: entity.scheduledAt,
      completedAt: entity.completedAt,
      nextRetryAt: entity.nextRetryAt,
    };
  }
}

/**
 * Standard-Payload für Webhook-Events.
 */
export interface WebhookEventPayload {
  test?: boolean;
  message?: string;
  subscriptionId?: string;
  kanzleiId?: string;
  [key: string]: unknown;
}