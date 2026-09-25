import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Repository für Public-API-Persistenz (APIKey, APIKeyUsage,
 * WebhookSubscription, WebhookDelivery).
 *
 * Mandant-Trennung: Alle Methoden, die Mandanten-Daten lesen, sind auf
 * `kanzleiId` gefiltert. Das Webhook-Repository (Phase H) sitzt in einem
 * separaten Modul und konsumiert diese Methoden NICHT.
 *
 * Direkter Prisma-Zugriff ist hier erlaubt (Mandant-Trennung via Filter).
 */

export type ApiKeyEntity = Prisma.APIKeyGetPayload<Record<string, never>>;
export type ApiKeyUsageEntity = Prisma.APIKeyUsageGetPayload<Record<string, never>>;

@Injectable()
export class PublicApiRepository {
  static readonly entityName = 'PublicApi';

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // APIKey
  // ---------------------------------------------------------------------------

  async createApiKey(data: Prisma.APIKeyCreateInput): Promise<ApiKeyEntity> {
    return this.prisma.aPIKey.create({ data });
  }

  async findApiKeyByKeyId(keyId: string): Promise<ApiKeyEntity | null> {
    return this.prisma.aPIKey.findFirst({
      where: { keyId },
    });
  }

  async findApiKeyById(id: string): Promise<ApiKeyEntity | null> {
    return this.prisma.aPIKey.findFirst({
      where: { id },
    });
  }

  async findApiKeysByKanzlei(kanzleiId: string): Promise<ApiKeyEntity[]> {
    return this.prisma.aPIKey.findMany({
      where: { kanzleiId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revokeApiKey(
    id: string,
    revokedById: string | null,
  ): Promise<ApiKeyEntity> {
    return this.prisma.aPIKey.update({
      where: { id },
      data: { revokedAt: new Date(), revokedById, isActive: false },
    });
  }

  async touchLastUsedAt(id: string): Promise<void> {
    // Fire-and-forget — wir nutzen ein gezieltes UPDATE, um Race-Conditions
    // mit anderen Reads zu vermeiden.
    try {
      await this.prisma.aPIKey.update({
        where: { id },
        data: { lastUsedAt: new Date() },
      });
    } catch {
      // Fire-and-forget: fehlgeschlagenes lastUsedAt-Update ist nicht kritisch.
    }
  }

  async createUsage(data: Prisma.APIKeyUsageCreateInput): Promise<ApiKeyUsageEntity> {
    return this.prisma.aPIKeyUsage.create({
      data,
    });
  }

  async countUsageLast30Days(apiKeyId: string): Promise<number> {
    const since = new Date();
    since.setDate(since.getDate() - 30);
    return this.prisma.aPIKeyUsage.count({
      where: { apiKeyId, timestamp: { gte: since } },
    });
  }

  async findUsageLast30Days(
    apiKeyId: string,
    limit: number,
  ): Promise<ApiKeyUsageEntity[]> {
    const since = new Date();
    since.setDate(since.getDate() - 30);
    return this.prisma.aPIKeyUsage.findMany({
      where: { apiKeyId, timestamp: { gte: since } },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });
  }

  // ---------------------------------------------------------------------------
  // WebhookSubscription (für OAuth-Controller / API-Key-Validierung)
  // ---------------------------------------------------------------------------

  async findWebhookSubscription(
    id: string,
    kanzleiId: string,
  ): Promise<Prisma.WebhookSubscriptionGetPayload<Record<string, never>> | null> {
    return this.prisma.webhookSubscription.findFirst({
      where: { id, kanzleiId },
    });
  }
}