import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CommonRepositoriesModule } from '../../common/repositories/common-repositories.module';
import { DatevImportController } from './controllers/datev-import.controller';
import { DatevImportService } from './services/datev-import.service';

/**
 * Modul für DATEV-Import (Reverse — CSV → Bilanz/GuV).
 *
 * - Endpoints: POST /preview, POST /execute
 * - CSV-Parser für EXTF_Buchungsstapel.csv
 * - Reverse-Mapping SKR04 → HGB (§266 Bilanz / §275 GuV)
 * - Saldovortrag-Berechnung
 * - Auto-Mapping + User-Override für unmapped Konten
 * - Audit-Trail via AuditService
 *
 * RBAC: STEUERBERATER / KANZLEI_ADMIN
 */
@Module({
  imports: [AuditModule, CommonRepositoriesModule],
  controllers: [DatevImportController],
  providers: [DatevImportService],
  exports: [DatevImportService],
})
export class DatevImportModule {}