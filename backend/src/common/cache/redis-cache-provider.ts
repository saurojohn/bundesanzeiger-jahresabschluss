import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Keyv from 'keyv';
import KeyvRedis from '@keyv/redis';
import type { CacheProvider } from './cache-provider.interface';

/**
 * Redis-Provider für die CacheProvider-Abstraktion (M4 Sprint 0).
 *
 * Backed by KeyV + @keyv/redis (welches intern ioredis verwendet).
 * Bietet Multi-VM-Cache-Sharing und Persistenz über Restarts.
 *
 * Namespace: Standardmäßig 'banz' — verhindert Kollisionen mit anderen
 * Apps, die dieselbe Redis-Instanz nutzen (z.B. Microservices).
 *
 * Invalidation: KeyV bietet kein natives Prefix-Delete. Wir nutzen
 * den von @keyv/redis bereitgestellten Iterator, der SCAN mit MATCH
 * verwendet (siehe @keyv/redis/src/index.js). Das ist O(N) über alle
 * Keys im Namespace — bei M4-Pilot-Größe (< 1000 Keys) unter 10ms.
 *
 * Failure-Mode: Wenn Redis nicht erreichbar ist, wirft KeyV einen
 * Error. Der CacheManager fängt das ab und fällt auf den Memory-
 * Provider zurück.
 */
@Injectable()
export class RedisCacheProvider implements CacheProvider {
  private readonly logger = new Logger(RedisCacheProvider.name);
  private keyv: Keyv | null = null;
  private readonly namespace = 'banz';
  private connected = false;

  constructor(configService: ConfigService) {
    // Bugfix 2026-09-28: Verbindung wird NUR aufgebaut, wenn Redis wirklich
    // als Cache-Provider konfiguriert ist. Vorher hat der Constructor
    // unabhaengig von CACHE_PROVIDER immer `new KeyvRedis(redisUrl)` erzeugt.
    // Da der Provider per `@Optional()` trotzdem im DI-Container stand, lief
    // im Memory-Modus (CACHE_PROVIDER=memory, Single-VM) dauerhaft ein
    // ioredis-Reconnect-Sturm gegen localhost:6379 — endend in
    // "Reached the max retries per request limit" und, bei genug Anfragen,
    // im Prozessabsturz. Der CacheManager waehlt seinen Primary ohnehin
    // selbst ueber CACHE_PROVIDER + Health-Check.
    if (configService.get<string>('CACHE_PROVIDER', 'memory') !== 'redis') {
      this.logger.log(
        'CACHE_PROVIDER !== "redis" — RedisCacheProvider bleibt inaktiv (kein Connect)',
      );
      return;
    }

    const redisUrl = configService.get<string>('REDIS_URL');
    if (!redisUrl) {
      throw new InternalServerErrorException(
        'REDIS_URL nicht konfiguriert — RedisCacheProvider benötigt REDIS_URL',
      );
    }

    // KeyV wrapt das @keyv/redis-Store-Objekt. Namespace verhindert
    // Kollisionen mit anderen Apps auf derselben Redis-Instanz.
    this.keyv = new Keyv({
      store: new KeyvRedis(redisUrl),
      namespace: this.namespace,
    });

    // KeyV emittiert 'error' bei Verbindungsabbrüchen — wir loggen
    // und markieren `connected = false`, damit isHealthy() das
    // reflektiert. Der CacheManager failt dann auf Memory-Backend.
    this.keyv.on('error', (err: Error) => {
      if (this.connected) {
        this.logger.warn(`Redis-Verbindung verloren: ${err.message}`);
      }
      this.connected = false;
    });

    this.connected = true;
    this.logger.log(`RedisCacheProvider initialisiert (namespace="${this.namespace}")`);
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.keyv) return null;
    const value = await this.keyv.get<T>(key);
    return value ?? null;
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    if (!this.keyv) return;
    await this.keyv.set(key, value, ttlMs);
  }

  /**
   * Invalidate via KeyV-Iterator + delete.
   *
   * KeyV 4.x bietet `iterator(namespace)` — das delegiert an das
   * Backend-Store-Objekt. @keyv/redis implementiert das via Redis-
   * SCAN mit MATCH-Pattern `${namespace}:${prefix}*`.
   *
   * Performance: Bei M4-Pilot-Größe (~1000 Keys) < 10ms. Für M4
   * Sprint 2 (Cloud-Migration, > 10k Keys) kann eine separate
   * Index-Set-Variante implementiert werden — out of scope hier.
   */
  async invalidate(prefix: string): Promise<void> {
    if (!this.keyv) return;
    const iteratorFn = this.keyv.iterator;
    if (!iteratorFn) {
      // Adapter unterstützt keine Iteration — Invalidierung nicht möglich.
      // Bei M4-Pilot-Größe nicht relevant; @keyv/redis bietet immer einen Iterator.
      this.logger.warn(
        `Redis-Adapter bietet keinen Iterator — prefix="${prefix}" kann nicht invalidiert werden`,
      );
      return;
    }
    const iterator = iteratorFn(`${this.namespace}:${prefix}`);
    const keysToDelete: string[] = [];
    for await (const [fullKey] of iterator) {
      // fullKey hat Form `<namespace>:<userKey>` — KeyV entfernt den
      // Namespace-Prefix nicht, deshalb entfernen wir ihn hier explizit,
      // damit das delete() den Key korrekt trifft.
      const unprefixed = this.unprefixKey(String(fullKey));
      if (unprefixed !== null) {
        keysToDelete.push(unprefixed);
      }
    }
    if (keysToDelete.length === 0) return;
    // KeyV's delete akzeptiert einzelne Keys oder Arrays.
    await this.keyv.delete(keysToDelete);
    this.logger.debug(
      `Cache invalidate (Redis): prefix="${prefix}", ${keysToDelete.length} Einträge`,
    );
  }

  async has(key: string): Promise<boolean> {
    if (!this.keyv) return false;
    return this.keyv.has(key);
  }

  async isHealthy(): Promise<boolean> {
    if (!this.keyv) return false;
    try {
      // PING-Equivalent: ein Mini-Get auf einen nicht-existenten Key
      // liefert `undefined`, aber triggert einen Redis-Roundtrip. Wenn
      // die Verbindung unterbrochen ist, wirft KeyV.
      await this.keyv.get('__healthcheck__');
      this.connected = true;
      return true;
    } catch (err) {
      this.connected = false;
      this.logger.warn(`Redis healthcheck fehlgeschlagen: ${(err as Error).message}`);
      return false;
    }
  }

  getType(): 'memory' | 'redis' {
    return this.keyv ? 'redis' : 'memory';
  }

  /**
   * Entfernt den Namespace-Prefix von einem Key, sodass er an
   * `keyv.delete()` weitergegeben werden kann.
   *
   * @keyv/redis liefert die vollen Redis-Keys (inkl. namespace),
   * während `keyv.delete()` den Namespace intern wieder hinzufügt.
   */
  private unprefixKey(fullKey: string): string | null {
    const prefix = `${this.namespace}:`;
    if (fullKey.startsWith(prefix)) {
      return fullKey.slice(prefix.length);
    }
    return null;
  }
}