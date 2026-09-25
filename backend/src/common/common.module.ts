import { Module } from '@nestjs/common';
import { PaginationService } from './services/pagination.service';
import { CacheModule } from './cache/cache.module';

/**
 * Globale Common-Dienste: Pagination + Cache.
 *
 * Wird vom MandantModule, BilanzModule, GuVModule, AnhangModule,
 * AuditModule und WPModule importiert.
 *
 * M4-Migration: `InMemoryCacheService` wurde durch den
 * `CacheManagerService` (Strategy + Fallback) ersetzt. Das CacheModule
 * ist `@Global()` — der CacheManagerService ist also ohne expliziten
 * Import verfügbar. Bestehende Imports via `InMemoryCacheService`-
 * Token werden automatisch auf den CacheManagerService umgeleitet
 * (siehe cache.module.ts → InMemoryCacheServiceToken).
 *
 * @deprecated Importiere `CacheManagerService` direkt. Der
 * `InMemoryCacheService` bleibt als Backwards-Compat-Brücke aktiv.
 */
@Module({
  imports: [CacheModule],
  providers: [PaginationService],
  exports: [PaginationService, CacheModule],
})
export class CommonModule {}