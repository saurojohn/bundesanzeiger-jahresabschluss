import {
  Global,
  Module,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CacheManagerService } from './cache-manager.service';
import { MemoryCacheProvider } from './memory-cache-provider';
import { RedisCacheProvider } from './redis-cache-provider';

/**
 * Symbolischer Token, der den historischen `InMemoryCacheService`
 * ersetzt. Alle bestehenden `InMemoryCacheService`-Imports erhalten
 * den CacheManagerService — gleiches API (memoize, invalidate, get, set).
 *
 * Naming: identisch zur historischen Klasse, damit die Suche nach
 * `InMemoryCacheService` weiterhin alle Referenzen findet.
 */
export const InMemoryCacheServiceToken = 'InMemoryCacheService';

/**
 * Cache-Modul (M4 Sprint 0).
 *
 * Strategie:
 *   - MemoryCacheProvider: immer aktiv (Single-VM, kein Netzwerk).
 *   - RedisCacheProvider: nur aktiv, wenn REDIS_URL gesetzt und
 *     CACHE_PROVIDER=redis. Wird per `@Optional()` injiziert.
 *
 * CacheManagerService: wählt anhand Config + Health den Primary- und
 * Fallback-Provider. Sein API ist kompatibel zum historischen
 * InMemoryCacheService — bestehende Calls funktionieren ohne Änderung.
 *
 * Backwards-Compat-Aliase:
 *   - 'CacheProvider' (string token) → CacheManagerService
 *   - InMemoryCacheServiceToken → CacheManagerService
 *     Damit können bestehende Module `InMemoryCacheService`-artige
 *     Aufrufe weiter nutzen — NestJS resolvet den Token automatisch.
 *
 * Global: Das Modul ist global, damit alle Module (Mandant, Audit,
 * Branding, Bilanz, GuV, Anhang) ohne expliziten Import Zugriff haben.
 */
@Global()
@Module({
  providers: [
    MemoryCacheProvider,
    RedisCacheProvider,
    CacheManagerService,
    {
      provide: 'CacheProvider',
      useExisting: CacheManagerService,
    },
    {
      // Backwards-Compat-Brücke: alle bestehenden Imports via
      // InMemoryCacheService-Token erhalten den CacheManagerService.
      // Der API-Vertrag ist identisch (memoize, invalidate, get, set).
      provide: InMemoryCacheServiceToken,
      useExisting: CacheManagerService,
    },
  ],
  exports: [
    CacheManagerService,
    MemoryCacheProvider,
    'CacheProvider',
    InMemoryCacheServiceToken,
  ],
})
export class CacheModule implements OnApplicationBootstrap {
  constructor(
    private readonly cacheManager: CacheManagerService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Lifecycle-Hook: nach Modul-Bootstrap einmal den aktiven Provider
   * loggen. Das ist das primäre Diagnose-Signal beim Production-Start.
   */
  onApplicationBootstrap(): void {
    const type = this.cacheManager.getPrimaryType();
    const hasFallback = this.cacheManager.hasFallback();
    console.log(
      `[CacheModule] Cache bereit: primary=${type}, fallback=${hasFallback ? 'memory' : 'none'}`,
    );
  }
}