import { Module } from '@nestjs/common';
import { CommonRepositoriesModule } from '../../common/repositories/common-repositories.module';
import { AuditModule } from '../audit/audit.module';
import { BrandingController } from './controllers/branding.controller';
import { BrandingService } from './services/branding.service';

/**
 * Branding-Modul (White-Label).
 *
 * Verantwortlich für:
 *   - Kanzlei-Branding-Lesen (Cache 1h TTL)
 *   - Branding-Mutation (Farben, Custom-Domain)
 *   - Logo-Upload (Base64 → S3/WORM)
 *
 * Abhängigkeiten:
 *   - AuditModule        — AuditTrail
 *   - CommonRepositoriesModule — KanzleiRepository
 *
 * StorageModule ist global, muss NICHT explizit importiert werden.
 *
 * RBAC:
 *   - GET branding/logo: alle authentifizierten User der Kanzlei
 *   - PATCH/POST/DELETE: nur KANZLEI_ADMIN oder SYSTEM_ADMIN
 */
@Module({
  imports: [AuditModule, CommonRepositoriesModule],
  controllers: [BrandingController],
  providers: [BrandingService],
  exports: [BrandingService],
})
export class BrandingModule {}