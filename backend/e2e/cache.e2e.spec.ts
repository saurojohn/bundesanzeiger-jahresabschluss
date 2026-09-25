/// <reference types="vitest/globals" />

/**
 * E2E-Test: Cache-Provider-System (M4 Sprint 0).
 *
 * Tests (8 lt. Sprint-Plan):
 *   1. CacheManager.get mit Memory-Provider → funktioniert
 *   2. CacheManager.get mit nicht-existentem Key → null
 *   3. CacheManager.set + get roundtrip → Wert zurück
 *   4. CacheManager.memoize mit Cache-Miss → factory wird aufgerufen
 *   5. CacheManager.memoize mit Cache-Hit → factory wird NICHT aufgerufen
 *   6. CacheManager.invalidate mit Pattern → löscht alle matched Keys
 *   7. Memory-Provider.isHealthy → true
 *   8. Redis-Provider.isHealthy bei disconnected Redis → false
 *
 * Hinweise:
 *   - Diese Tests laufen OHNE Redis (nur Memory-Provider).
 *   - Redis-Healthcheck wird mit einer bogus-URL getestet (Timeout).
 *   - `npm run test` ist `vitest` — die e2e-Suite wird separat
 *     ausgeführt (`vitest run e2e/`).
 */

import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { CacheManagerService } from '../src/common/cache/cache-manager.service';
import { MemoryCacheProvider } from '../src/common/cache/memory-cache-provider';
import { RedisCacheProvider } from '../src/common/cache/redis-cache-provider';

describe('Cache-Provider (M4 Sprint 0)', () => {
  let moduleRef: TestingModule;
  let cacheManager: CacheManagerService;
  let memoryProvider: MemoryCacheProvider;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              // Default: Memory-Provider für diese Tests
              CACHE_PROVIDER: 'memory',
              REDIS_URL: 'redis://localhost:6379/0',
            }),
          ],
        }),
      ],
      providers: [
        MemoryCacheProvider,
        {
          // Redis-Provider mit Optional, damit Tests ohne Redis laufen
          provide: RedisCacheProvider,
          useFactory: () =>
            new RedisCacheProvider({
              get: () => 'redis://127.0.0.1:1/0', // bogus port für Health-Test
            } as never),
        },
        CacheManagerService,
      ],
    }).compile();

    cacheManager = moduleRef.get(CacheManagerService);
    memoryProvider = moduleRef.get(MemoryCacheProvider);

    await cacheManager.onModuleInit();
  });

  afterAll(async () => {
    if (cacheManager) {
      cacheManager.onModuleDestroy();
    }
    if (memoryProvider) {
      memoryProvider.clear();
    }
    await moduleRef.close();
  });

  // -------------------------------------------------------------------------
  // Test 1: CacheManager.get mit Memory-Provider
  // -------------------------------------------------------------------------
  it('1. CacheManager.get mit Memory-Provider liefert gespeicherten Wert', async () => {
    await cacheManager.set('test:key1', { foo: 'bar' }, 60_000);
    const result = await cacheManager.get<{ foo: string }>('test:key1');
    expect(result).toEqual({ foo: 'bar' });
  });

  // -------------------------------------------------------------------------
  // Test 2: CacheManager.get mit nicht-existentem Key
  // -------------------------------------------------------------------------
  it('2. CacheManager.get mit nicht-existentem Key liefert null', async () => {
    const result = await cacheManager.get<unknown>('test:does-not-exist');
    expect(result).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Test 3: CacheManager.set + get roundtrip
  // -------------------------------------------------------------------------
  it('3. CacheManager.set + get roundtrip liefert exakt den gespeicherten Wert', async () => {
    const complex = {
      id: 'abc',
      nested: { value: 42, list: [1, 2, 3] },
      flag: true,
    };
    await cacheManager.set('test:roundtrip', complex, 60_000);
    const result = await cacheManager.get<typeof complex>('test:roundtrip');
    expect(result).toEqual(complex);
  });

  // -------------------------------------------------------------------------
  // Test 4: CacheManager.memoize mit Cache-Miss
  // -------------------------------------------------------------------------
  it('4. CacheManager.memoize ruft factory bei Cache-Miss auf', async () => {
    let factoryCalls = 0;
    const factory = async () => {
      factoryCalls += 1;
      return 'computed-value';
    };
    const result = await cacheManager.memoize(
      'test:memoize:miss',
      60_000,
      factory,
    );
    expect(result).toBe('computed-value');
    expect(factoryCalls).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Test 5: CacheManager.memoize mit Cache-Hit
  // -------------------------------------------------------------------------
  it('5. CacheManager.memoize ruft factory bei Cache-Hit NICHT erneut auf', async () => {
    let factoryCalls = 0;
    const factory = async () => {
      factoryCalls += 1;
      return 'cached-value';
    };
    // Erster Call: factory wird aufgerufen
    const first = await cacheManager.memoize(
      'test:memoize:hit',
      60_000,
      factory,
    );
    expect(first).toBe('cached-value');
    expect(factoryCalls).toBe(1);
    // Zweiter Call: factory wird NICHT aufgerufen
    const second = await cacheManager.memoize(
      'test:memoize:hit',
      60_000,
      factory,
    );
    expect(second).toBe('cached-value');
    expect(factoryCalls).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Test 6: CacheManager.invalidate mit Pattern
  // -------------------------------------------------------------------------
  it('6. CacheManager.invalidate mit Prefix löscht alle matched Keys', async () => {
    await cacheManager.set('audit-count:kanzlei:k1', 5, 60_000);
    await cacheManager.set('audit-count:kanzlei:k2', 10, 60_000);
    await cacheManager.set('audit-count:mandant:m1', 7, 60_000);

    // Vor Invalidation
    expect(await cacheManager.get('audit-count:kanzlei:k1')).toBe(5);
    expect(await cacheManager.get('audit-count:kanzlei:k2')).toBe(10);
    expect(await cacheManager.get('audit-count:mandant:m1')).toBe(7);

    await cacheManager.invalidate('audit-count:kanzlei');

    // Nach Invalidation: kanzlei-Keys weg, mandant-Key bleibt
    expect(await cacheManager.get('audit-count:kanzlei:k1')).toBeNull();
    expect(await cacheManager.get('audit-count:kanzlei:k2')).toBeNull();
    expect(await cacheManager.get('audit-count:mandant:m1')).toBe(7);
  });

  // -------------------------------------------------------------------------
  // Test 7: Memory-Provider.isHealthy
  // -------------------------------------------------------------------------
  it('7. Memory-Provider.isHealthy liefert true', async () => {
    const healthy = await memoryProvider.isHealthy();
    expect(healthy).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 8: Redis-Provider.isHealthy bei disconnected Redis
  // -------------------------------------------------------------------------
  it('8. Redis-Provider.isHealthy liefert false bei disconnected Redis', async () => {
    // Der bogus-URL (Port 1) führt zu Connection-Refused — isHealthy muss false liefern
    const redisProvider = moduleRef.get(RedisCacheProvider);
    // Kurzer Timeout, damit der Test nicht ewig wartet
    const healthyPromise = redisProvider.isHealthy();
    const timeout = new Promise<boolean>((resolve) =>
      setTimeout(() => resolve(false), 5_000),
    );
    const result = await Promise.race([healthyPromise, timeout]);
    expect(result).toBe(false);
  });
});