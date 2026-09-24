import { Injectable, Logger } from '@nestjs/common';

/**
 * In-Memory Cache-Layer für Performance-kritische Lookups.
 *
 * Anwendungsfälle:
 * - Mandant-Config (5min TTL) — wird auf jeder Bilanz-Liste angefragt
 * - AuditLog-Counts (30s TTL) — für Dashboard-Übersichten
 *
 * Einschränkungen:
 * - Single-Process (kein Cluster-Sharing)
 * - Kein LRU-Eviction — wächst unbegrenzt. Für Pilot akzeptabel;
 *   für M4 (Multi-Instance + Redis) wird der Service gegen einen
 *   Redis-Adapter ausgetauscht (gleiches Interface).
 *
 * Thread-Safety: Node ist single-threaded — keine Locks nötig.
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

@Injectable()
export class InMemoryCacheService {
  private readonly logger = new Logger(InMemoryCacheService.name);
  private readonly cache = new Map<string, CacheEntry<unknown>>();

  /**
   * Liefert einen Wert aus dem Cache. Null wenn abgelaufen oder nicht vorhanden.
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.value as T;
  }

  /**
   * Speichert einen Wert mit TTL in Millisekunden.
   */
  set<T>(key: string, value: T, ttlMs: number): void {
    this.cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  /**
   * Invalidiert alle Keys mit gegebenem Prefix (z.B. 'mandant:abc123:*').
   *
   * Globale Invalidation bei Mutations (CREATE/UPDATE/DELETE) auf einer
   * Entität — typischerweise pro Mandant granular.
   */
  invalidate(prefix: string): number {
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
    return count;
  }

  /**
   * Memoize-Pattern: Hole Wert aus Cache oder berechne ihn.
   *
   * Concurrent-Safety: Bei zwei parallelen Calls mit gleichem Key wird
   * die Factory 2x ausgeführt (kein dedup). Für read-heavy Paths
   * ist das akzeptabel.
   */
  async memoize<T>(
    key: string,
    ttlMs: number,
    factory: () => Promise<T>,
  ): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== null) return cached;
    const value = await factory();
    this.set(key, value, ttlMs);
    return value;
  }

  /**
   * Diagnose: aktuelle Cache-Statistik.
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