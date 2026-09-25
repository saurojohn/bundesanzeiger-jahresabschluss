import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MemoryCacheProvider } from './memory-cache-provider';
import { RedisCacheProvider } from './redis-cache-provider';

/**
 * Cache-Manager (M4 Sprint 0) — Strategy + Fallback.
 *
 * Wählt anhand der Konfiguration (CACHE_PROVIDER) + initialem
 * Health-Check den Primary-Provider. Bei Ausfall des Primary wird
 * automatisch auf den Fallback gewechselt (write-through).
 *
 * Health-Check läuft periodisch alle 30s — bei Recovery schaltet
 * der Manager zurück auf den ursprünglichen Provider.
 *
 * Backwards-Compat: Alle bestehenden `cache.memoize()` /
 * `cache.invalidate()`-Calls funktionieren ohne Änderung — das
 * Service-Signature ist kompatibel mit InMemoryCacheService.
 *
 * Audit-Trail: KEIN AuditLog für Cache-Operationen (Performance-Grund
 * — Cache-Calls können 100+/Sekunde auftreten, das würde den
 * AuditTrail fluten).
 */
@Injectable()
export class CacheManagerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheManagerService.name);
  private primary: MemoryCacheProvider | RedisCacheProvider | null = null;
  private fallback: MemoryCacheProvider | RedisCacheProvider | null = null;
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly memoryProvider: MemoryCacheProvider,
    @Optional() private readonly redisProvider?: RedisCacheProvider,
  ) {}

  async onModuleInit(): Promise<void> {
    const cacheType = this.configService.get<string>('CACHE_PROVIDER', 'memory');

    if (cacheType === 'redis' && this.redisProvider) {
      const healthy = await this.redisProvider.isHealthy();
      if (healthy) {
        this.primary = this.redisProvider;
        this.fallback = this.memoryProvider;
        this.logger.log(
          'Cache-Provider: Redis (primary) + Memory (write-through-Fallback)',
        );
      } else {
        this.primary = this.memoryProvider;
        this.fallback = null;
        this.logger.warn(
          'Cache-Provider: Redis konfiguriert aber nicht erreichbar — fallback auf Memory',
        );
      }
    } else {
      this.primary = this.memoryProvider;
      this.fallback = null;
      this.logger.log('Cache-Provider: Memory (Single-VM-Modus)');
    }

    // Periodischer Health-Check alle 30s — prüft Failover-Recovery.
    // Unref'd, damit der Interval das Test-Shutdown nicht blockiert.
    this.healthCheckInterval = setInterval(() => {
      void this.checkHealthAndFailover();
    }, 30_000);
    if (typeof this.healthCheckInterval.unref === 'function') {
      this.healthCheckInterval.unref();
    }
  }

  onModuleDestroy(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * Liefert einen Wert aus dem Cache. `null` bei Miss oder Fehler.
   *
   * Bei Fehler des Primary wird automatisch der Fallback konsultiert.
   * Der Fehler wird geloggt (warn), aber NICHT geworfen — Cache-Fehler
   * dürfen den Haupt-Flow nicht crashen.
   */
  async get<T>(key: string): Promise<T | null> {
    if (!this.primary) return null;
    try {
      return await this.primary.get<T>(key);
    } catch (err) {
      this.logger.warn(
        `Cache-Get fehlgeschlagen (Primary=${this.primary.getType()}): ${(err as Error).message}`,
      );
      if (this.fallback) {
        try {
          return await this.fallback.get<T>(key);
        } catch (fallbackErr) {
          this.logger.warn(
            `Cache-Get auch im Fallback fehlgeschlagen: ${(fallbackErr as Error).message}`,
          );
        }
      }
      return null;
    }
  }

  /**
   * Speichert einen Wert mit TTL. Write-Through: Bei vorhandenem
   * Fallback wird in BEIDE Caches geschrieben — das hält beide
   * synchron, falls später der Primary ausfällt.
   */
  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    if (!this.primary) return;
    try {
      await this.primary.set(key, value, ttlMs);
    } catch (err) {
      this.logger.warn(
        `Cache-Set fehlgeschlagen (Primary=${this.primary.getType()}): ${(err as Error).message}`,
      );
    }
    if (this.fallback) {
      try {
        await this.fallback.set(key, value, ttlMs);
      } catch (err) {
        this.logger.warn(
          `Cache-Set im Fallback fehlgeschlagen: ${(err as Error).message}`,
        );
      }
    }
  }

  /**
   * Invalidiert alle Keys mit Prefix in beiden Caches.
   *
   * Wichtig: Errors werden geloggt aber nicht geworfen — eine fehl-
   * geschlagene Invalidation führt idealerweise zu stale Data, nicht
   * zu einem Service-Crash.
   */
  async invalidate(prefix: string): Promise<void> {
    if (this.primary) {
      try {
        await this.primary.invalidate(prefix);
      } catch (err) {
        this.logger.warn(
          `Cache-Invalidate fehlgeschlagen (Primary=${this.primary.getType()}): ${(err as Error).message}`,
        );
      }
    }
    if (this.fallback) {
      try {
        await this.fallback.invalidate(prefix);
      } catch (err) {
        this.logger.warn(
          `Cache-Invalidate im Fallback fehlgeschlagen: ${(err as Error).message}`,
        );
      }
    }
  }

  /**
   * Memoize-Pattern: Hole Wert aus Cache oder berechne ihn via Factory.
   *
   * Concurrent-Safety: Bei zwei parallelen Calls mit gleichem Key wird
   * die Factory 2x ausgeführt (kein dedup). Für read-heavy Paths ist
   * das akzeptabel; für write-heavy gibt es bei Bedarf eine
   * Lock-Variante in einer späteren Iteration.
   */
  async memoize<T>(
    key: string,
    ttlMs: number,
    factory: () => Promise<T>,
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;
    const value = await factory();
    await this.set(key, value, ttlMs);
    return value;
  }

  /**
   * Diagnose: aktueller Primary-Provider-Type.
   *
   * 'none' = kein Provider aktiv (z.B. während Boot fehlgeschlagen).
   */
  getPrimaryType(): 'memory' | 'redis' | 'none' {
    return this.primary?.getType() ?? 'none';
  }

  /**
   * Diagnose: ist ein Fallback-Provider aktiv?
   */
  hasFallback(): boolean {
    return this.fallback !== null;
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  /**
   * Periodischer Health-Check: Erkennt Redis-Recovery und schaltet
   * automatisch zurück, wenn die Verbindung wieder steht.
   */
  private async checkHealthAndFailover(): Promise<void> {
    if (!this.redisProvider) return;

    const wasRedisPrimary = this.primary === this.redisProvider;
    const healthy = await this.redisProvider.isHealthy();

    if (!healthy && wasRedisPrimary) {
      // Redis ist ausgefallen — auf Memory wechseln.
      this.logger.warn(
        'Redis-Provider nicht erreichbar — Failover auf Memory-Provider',
      );
      this.fallback = null;
      this.primary = this.memoryProvider;
    } else if (healthy && !wasRedisPrimary && this.fallback === null) {
      // Redis ist wieder da — zurück auf Redis + Memory als Fallback.
      this.logger.log('Redis-Provider wieder erreichbar — Failback auf Redis');
      this.primary = this.redisProvider;
      this.fallback = this.memoryProvider;
    }
  }
}