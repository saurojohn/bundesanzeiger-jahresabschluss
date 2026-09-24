import { Module } from '@nestjs/common';
import { PaginationService } from './services/pagination.service';
import { InMemoryCacheService } from './cache/in-memory-cache.service';

/**
 * Globale Common-Dienste: Pagination + Cache.
 *
 * Wird vom MandantModule, BilanzModule, GuVModule, AnhangModule,
 * AuditModule und WPModule importiert.
 */
@Module({
  providers: [PaginationService, InMemoryCacheService],
  exports: [PaginationService, InMemoryCacheService],
})
export class CommonModule {}