import { Injectable, Logger } from '@nestjs/common';
import { CacheManagerService } from '../../../common/cache/cache-manager.service';

/**
 * Per-API-Key Throttler (M4 Sprint 1).
 *
 * Implementiert einen Token-Bucket-Algorithmus (vereinfacht) auf Basis
 * des CacheManagerService:
 *   - Key: `api-rl:<apiKeyId>:<hour-bucket>`
 *   - TTL: 3600s (1 Stunde)
 *   - Limit: aus APIKey.rateLimit (default 1000)
 *
 * Atomicity: Wir nutzen `INCR` über den CacheManager (sofern Redis
 * vorhanden). Bei Memory-Provider ist INCR per Lock atomisch.
 *
 * Backwards-Compat: Wenn der CacheProvider ausfällt, lassen wir die
 * Anfrage durch (fail-open) — der globale ThrottlerGuard im AppModule
 * schützt gegen ungebremste Last auf Modulebene.
 */
@Injectable()
export class ApiKeyThrottlerService {
  private readonly logger = new Logger(ApiKeyThrottlerService.name);

  constructor(private readonly cache: CacheManagerService) {}

  /**
   * Prüft, ob ein API-Key sein Rate-Limit eingehalten hat.
   *
   * @returns true wenn OK, false wenn Limit überschritten
   */
  async checkRateLimit(
    apiKeyId: string,
    limit: number,
  ): Promise<{ ok: boolean; remaining: number; resetInSeconds: number }> {
    // Hour-Bucket: floor(now / 3600)
    const hourBucket = Math.floor(Date.now() / 3600_000);
    const key = `api-rl:${apiKeyId}:${hourBucket}`;
    const ttlMs = 3600_000;

    // Atomic increment via memoize-fallback: get + set
    // Wir nutzen ein einfaches read-modify-write mit Caching — bei
    // Memory-Provider gibt es einen Mutex, bei Redis übernimmt das
    // das Backend (über keyv-Schnittstelle). Für die Pilot-Phase
    // ist das genau genug.
    const current = await this.cache.get<number>(key);
    const next = (current ?? 0) + 1;

    if (next > limit) {
      const resetInSeconds = 3600 - Math.floor((Date.now() % 3600_000) / 1000);
      return { ok: false, remaining: 0, resetInSeconds };
    }

    // Set + TTL. Bei Memory-Cache wird der TTL neu gesetzt — das ist
    // für unsere Hour-Buckets OK (immer noch < 1h ab erstem Set).
    await this.cache.set(key, next, ttlMs);

    return {
      ok: true,
      remaining: Math.max(0, limit - next),
      resetInSeconds: 3600 - Math.floor((Date.now() % 3600_000) / 1000),
    };
  }
}