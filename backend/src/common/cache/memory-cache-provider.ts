import { Injectable, Logger } from '@nestjs/common';
import type { CacheProvider } from './cache-provider.interface';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * In-Memory-Provider für die CacheProvider-Abstraktion (M4 Sprint 0).
 *
 * Wird vom CacheManagerService als Standard- oder Fallback-Provider
 * verwendet. Implementiert die gleiche Logik wie der historische
 * InMemoryCacheService — gleicher API-Vertrag, aber jetzt `async`.
 *
 * Eigenschaften:
 *   - Single-Process (kein Cluster-Sharing)
 *   - Kein LRU-Eviction — wächst unbegrenzt (akzeptabel für Pilot/M3)
 *   - Persistiert nicht über Restarts
 *
 * Multi-VM-Setups MÜSSEN den RedisCacheProvider als Primary nutzen;
 * dieser Provider dient dann als lokaler Fallback, falls Redis ausfällt.
 */
@Injectable()
export class MemoryCacheProvider implements CacheProvider {
  private readonly logger = new Logger(MemoryCacheProvider.name);
  private readonly cache = new Map<string, CacheEntry<unknown>>();

  async get<T>(key: string): Promise<T | null> {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    this.cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  async invalidate(prefix: string): Promise<void> {
    let count = 0;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        count += 1;
      }
    }
    if (count > 0) {
      this.logger.debug(`Cache invalidate: prefix="${prefix}", ${count} Einträge`);
    }
  }

  async has(key: string): Promise<boolean> {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  async isHealthy(): Promise<boolean> {
    // In-Memory ist immer "healthy" — keine externe Abhängigkeit.
    return true;
  }

  getType(): 'memory' | 'redis' {
    return 'memory';
  }

  /**
   * Diagnose: aktuelle Cache-Statistik (nicht Teil der Interface).
   */
  stats(): { size: number } {
    return { size: this.cache.size };
  }

  /**
   * Vollständige Cache-Löschung (für Tests).
   */
  clear(): void {
    this.cache.clear();
  }
}