import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CommonRepositoriesModule } from '../../common/repositories/common-repositories.module';
import { KonsolidierungController } from './controllers/konsolidierung.controller';
import { KonsolidierungService } from './services/konsolidierung.service';

/**
 * Modul für Konzern-Konsolidierung (PublG §11, HGB §§ 301–306).
 *
 * - Endpoints: Erstellen, Liste, Calculate, Apply, Finalize, Salden
 * - HGB-Referenz: §§ 301–306 HGB
 * - Pilot-Scope: 1 Mutter + 1 Tochter (keine komplexen Topologien)
 * - RBAC: WIRTSCHAFTSPRUEFER + KANZLEI_ADMIN
 */
@Module({
  imports: [AuditModule, CommonRepositoriesModule],
  controllers: [KonsolidierungController],
  providers: [KonsolidierungService],
  exports: [KonsolidierungService],
})
export class KonsolidierungModule {}