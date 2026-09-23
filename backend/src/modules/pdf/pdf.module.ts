import { Module } from '@nestjs/common';
import { CommonRepositoriesModule } from '../../common/repositories/common-repositories.module';
import { AuditModule } from '../audit/audit.module';
import { PdfController } from './controllers/pdf.controller';
import { PdfService } from './services/pdf.service';

/**
 * PDF-Modul: Generierung + WORM-Storage + Download.
 *
 * Abhängigkeiten:
 *   - AuditModule        — AuditTrail
 *   - CommonRepositoriesModule — BilanzRepository, GuVRepository, AnhangRepository
 *
 * StorageModule ist global, muss NICHT explizit importiert werden.
 */
@Module({
  imports: [AuditModule, CommonRepositoriesModule],
  controllers: [PdfController],
  providers: [PdfService],
  exports: [PdfService],
})
export class PdfModule {}