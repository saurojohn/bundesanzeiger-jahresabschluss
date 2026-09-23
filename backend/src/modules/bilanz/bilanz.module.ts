import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CommonRepositoriesModule } from '../../common/repositories/common-repositories.module';
import { BilanzController } from './controllers/bilanz.controller';
import { BilanzService } from './services/bilanz.service';

/**
 * Modul für HGB-Bilanz (Phase 1).
 *
 * - Endpoints: Schema, Liste, CRUD, Validierung
 * - Abhängigkeiten: AuditModule (für AuditTrail), CommonRepositoriesModule
 *   (für BilanzRepository)
 */
@Module({
  imports: [AuditModule, CommonRepositoriesModule],
  controllers: [BilanzController],
  providers: [BilanzService],
  exports: [BilanzService],
})
export class BilanzModule {}