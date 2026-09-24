import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CommonRepositoriesModule } from '../../common/repositories/common-repositories.module';
import { DatevController } from './controllers/datev.controller';
import { DatevExportService } from './services/datev-export.service';

/**
 * Modul für DATEV-Buchungsstapel-Export.
 *
 * - Endpoints: POST /generate-buchungsstapel, POST /generate-sachkonten,
 *              GET /preview/:guvId
 * - DATEV-Format Version 12, EXTF-Buchungsstapel (UTF-8, Semikolon-getrennt)
 * - SKR04 als Default-Kontenplan, SKR03 optional
 * - RBAC: STEUERBERATER / WIRTSCHAFTSPRUEFER / KANZLEI_ADMIN
 * - Audit-Trail via AuditService
 */
@Module({
  imports: [AuditModule, CommonRepositoriesModule],
  controllers: [DatevController],
  providers: [DatevExportService],
  exports: [DatevExportService],
})
export class DatevModule {}