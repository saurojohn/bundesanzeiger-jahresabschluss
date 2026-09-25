import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { MandantModule } from '../mandant/mandant.module';
import { CommonRepositoriesModule } from '../../common/repositories/common-repositories.module';
import { CommonModule } from '../../common/common.module';
import { ApiKeyService } from './services/api-key.service';
import { ApiKeyThrottlerService } from './services/api-key-throttler.service';
import { PublicApiReadService } from './services/public-api-read.service';
import { PublicApiRepository } from './api.repository';
import { ApiKeysController } from './controllers/api-keys.controller';
import { OAuthController } from './controllers/oauth.controller';
import { ApiV1Controller } from './controllers/v1/api-v1.controller';

/**
 * Public-API-Modul (M4 Sprint 1).
 *
 * Endpoints:
 *   POST  /oauth/token                    — OAuth2-Token-Ausstellung (client_credentials)
 *   POST  /api/api-keys                   — API-Key erstellen (KANZLEI_ADMIN)
 *   GET   /api/api-keys                   — API-Keys auflisten (KANZLEI_ADMIN)
 *   DELETE /api/api-keys/:id              — API-Key widerrufen (KANZLEI_ADMIN)
 *   GET   /api/v1/mandanten               — Mandanten der Kanzlei (mandant:read)
 *   GET   /api/v1/mandanten/:id           — Einzelner Mandant
 *   GET   /api/v1/mandanten/:id/bilanzen  — Bilanzen (bilanz:read)
 *   GET   /api/v1/mandanten/:id/guv       — GuV (guv:read)
 *   GET   /api/v1/mandanten/:id/anhang    — Anhang (anhang:read)
 *   GET   /api/v1/mandanten/:id/jahresabschluesse
 *   GET   /api/v1/mandanten/:id/banz-submissions
 *   POST  /api/v1/banz-submissions        — Neue BAnz-Submission (banz-submission:write)
 *
 * Abhängigkeiten:
 *   - AuthModule                    — JWT-Auth-Guard für /api/api-keys (User-Auth) +
 *                                     JwtModule (OAuth2-JWT-Signing via JWT_SECRET)
 *   - MandantModule                 — Mandant-Reads (Public-API-Reuse)
 *   - AuditModule                   — Audit-Trail für API-Key-Create/Revoke
 *   - CommonRepositoriesModule      — Bilanz/GuV/Anhang/Konsolidierung-Repositories
 *   - CommonModule                  — CacheManagerService (für Rate-Limiting)
 *
 * Wichtig: Webhook-Verwaltung (POST /api/webhook-subscriptions) liegt im
 * separaten WebhookModule — JWT-authentifiziert, NICHT via API-Key.
 *
 * Backwards-Compat: Bestehende /api/auth/login etc. bleiben unverändert.
 */
@Module({
  imports: [
    AuthModule,
    AuditModule,
    MandantModule,
    CommonRepositoriesModule,
    CommonModule,
  ],
  controllers: [
    ApiKeysController,
    OAuthController,
    ApiV1Controller,
  ],
  providers: [
    PublicApiRepository,
    ApiKeyService,
    ApiKeyThrottlerService,
    PublicApiReadService,
  ],
  exports: [
    ApiKeyService,
    ApiKeyThrottlerService,
    PublicApiReadService,
    PublicApiRepository,
  ],
})
export class ApiModule {}