import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CommonRepositoriesModule } from '../../common/repositories/common-repositories.module';
import { EbilanzController } from './controllers/ebilanz.controller';
import { XbrlGeneratorService } from './services/xbrl-generator.service';
import { XbrlValidatorService } from './services/xbrl-validator.service';

/**
 * Modul für E-Bilanz-XBRL-Generierung und -Validierung.
 *
 * - Endpoints: POST /generate, POST /validate, GET /preview/...
 * - HGB-Kerntaxonomie v6 (2025-04-01)
 * - Sign-Convention: Aufwände positiv
 * - RBAC: STEUERBERATER / WIRTSCHAFTSPRUEFER / KANZLEI_ADMIN
 */
@Module({
  imports: [AuditModule, CommonRepositoriesModule],
  controllers: [EbilanzController],
  providers: [XbrlGeneratorService, XbrlValidatorService],
  exports: [XbrlGeneratorService, XbrlValidatorService],
})
export class EbilanzModule {}