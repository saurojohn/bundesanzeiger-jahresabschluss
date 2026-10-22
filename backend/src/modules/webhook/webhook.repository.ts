import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Repository für Webhook-Persistenz.
 *
 * Mandant-Trennung: alle Lese-Queries sind auf `kanzleiId` gefiltert.
 * Direkter Prisma-Zugriff ist hier erlaubt (Mandant-Trennung via Filter).
 */

type WebhookPrismaClient = Pick<
  PrismaService,
  'webhookSubscription' | 'webhookDelivery'
>;

export type WebhookSubscriptionEntity =
  Prisma.WebhookSubscriptionGetPayload<Record<string, never>>;
export type WebhookDeliveryEntity =
  Prisma.WebhookDeliveryGetPayload<Record<string, never>>;
export type WebhookDeliveryWithSubscriptionEntity =
  Prisma.WebhookDeliveryGetPayload<{ include: { subscription: true } }>;

@Injectable()
export class WebhookRepository {
  static readonly entityName = 'Webhook';

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // WebhookSubscription
  // ---------------------------------------------------------------------------

  async createSubscription(
    data: Prisma.WebhookSubscriptionCreateInput,
  ): Promise<WebhookSubscriptionEntity> {
    return (
      this.prisma as unknown as WebhookPrismaClient
    ).webhookSubscription.create({ data });
  }

  async findSubscriptionById(
    id: string,
    kanzleiId: string,
  ): Promise<WebhookSubscriptionEntity | null> {
    return (
      this.prisma as unknown as WebhookPrismaClient
    ).webhookSubscription.findFirst({
      where: { id, kanzleiId },
    });
  }

  async findSubscriptionsByKanzlei(
    kanzleiId: string,
  ): Promise<WebhookSubscriptionEntity[]> {
    return (
      this.prisma as unknown as WebhookPrismaClient
    ).webhookSubscription.findMany({
      where: { kanzleiId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findActiveSubscriptionsForEvent(
    kanzleiId: string,
    event: string,
  ): Promise<WebhookSubscriptionEntity[]> {
    return (
      this.prisma as unknown as WebhookPrismaClient
    ).webhookSubscription.findMany({
      where: {
        kanzleiId,
        isActive: true,
        events: { has: event },
      },
    });
  }

  async deleteSubscription(id: string, kanzleiId: string): Promise<void> {
    await (
      this.prisma as unknown as WebhookPrismaClient
    ).webhookSubscription.deleteMany({
      where: { id, kanzleiId },
    });
  }

  /**
   * Schreibt das (verschluesselte) Secret einer Subscription.
   *
   * Nachtrag 2026-10-22: wird von der Selbstheilung benutzt — eine
   * Altzeile, deren Secret noch im Klartext liegt, wird beim ersten
   * Zugriff verschluesselt nachgeschrieben. `updateMany` mit `kanzleiId`
   * im Filter (statt `update` mit `where: { id }`) haelt die
   * Mandant-Trennung: eine fremde Kanzlei kann die Zeile nicht treffen.
   */
  async updateSubscriptionSecret(
    id: string,
    kanzleiId: string,
    secret: string,
  ): Promise<void> {
    await (
      this.prisma as unknown as WebhookPrismaClient
    ).webhookSubscription.updateMany({
      where: { id, kanzleiId },
      data: { secret },
    });
  }

  async updateSubscriptionDeliveryStatus(
    id: string,
    status: number | null,
    timestamp: Date,
  ): Promise<void> {
    try {
      await (
        this.prisma as unknown as WebhookPrismaClient
      ).webhookSubscription.update({
        where: { id },
        data: { lastDeliveryStatus: status, lastDeliveryAt: timestamp },
      });
    } catch {
      // Fire-and-forget
    }
  }

  // ---------------------------------------------------------------------------
  // WebhookDelivery
  // ---------------------------------------------------------------------------

  async createDelivery(
    data: Prisma.WebhookDeliveryCreateInput,
  ): Promise<WebhookDeliveryEntity> {
    return (
      this.prisma as unknown as WebhookPrismaClient
    ).webhookDelivery.create({ data });
  }

  async findDeliveryById(
    id: string,
  ): Promise<WebhookDeliveryWithSubscriptionEntity | null> {
    return (
      this.prisma as unknown as WebhookPrismaClient
    ).webhookDelivery.findFirst({
      where: { id },
      include: { subscription: true },
    });
  }

  async findDeliveriesBySubscription(
    subscriptionId: string,
    limit: number,
  ): Promise<WebhookDeliveryEntity[]> {
    return (
      this.prisma as unknown as WebhookPrismaClient
    ).webhookDelivery.findMany({
      where: { subscriptionId },
      orderBy: { scheduledAt: 'desc' },
      take: limit,
    });
  }

  async updateDelivery(
    id: string,
    data: Prisma.WebhookDeliveryUpdateInput,
  ): Promise<WebhookDeliveryEntity> {
    return (
      this.prisma as unknown as WebhookPrismaClient
    ).webhookDelivery.update({
      where: { id },
      data,
    });
  }

  async findPendingDeliveries(
    limit: number,
  ): Promise<WebhookDeliveryEntity[]> {
    return (
      this.prisma as unknown as WebhookPrismaClient
    ).webhookDelivery.findMany({
      where: {
        status: 'PENDING',
        OR: [
          { nextRetryAt: null },
          { nextRetryAt: { lte: new Date() } },
        ],
      },
      take: limit,
      orderBy: { scheduledAt: 'asc' },
    });
  }
}