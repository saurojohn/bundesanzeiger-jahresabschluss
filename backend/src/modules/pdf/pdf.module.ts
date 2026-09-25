import { Module } from '@nestjs/common';
import { CommonRepositoriesModule } from '../../common/repositories/common-repositories.module';
import { AuditModule } from '../audit/audit.module';
import { BrandingModule } from '../branding/branding.module';
import { PdfController } from './controllers/pdf.controller';
import { PdfService } from './services/pdf.service';

/**
 * PDF-Modul: Generierung + WORM-Storage + Download.
 *
 * Abhängigkeiten:
 *   - AuditModule        — AuditTrail
 *   - CommonRepositoriesModule — BilanzRepository, GuVRepository, AnhangRepository
 *   - BrandingModule     — White-Label-Branding (Logo + Brand-Color)
 *
 * StorageModule ist global, muss NICHT explizit importiert werden.
 */
@Module({
  imports: [AuditModule, CommonRepositoriesModule, BrandingModule],
  controllers: [PdfController],
  providers: [PdfService],
  exports: [PdfService],
})
export class PdfModule {}