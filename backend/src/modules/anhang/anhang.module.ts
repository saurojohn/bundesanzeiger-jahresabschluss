import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CommonRepositoriesModule } from '../../common/repositories/common-repositories.module';
import { AnhangController } from './controllers/anhang.controller';
import { AnhangService } from './services/anhang.service';

/**
 * Modul für Anhang (§ 284-289 HGB).
 */
@Module({
  imports: [AuditModule, CommonRepositoriesModule],
  controllers: [AnhangController],
  providers: [AnhangService],
  exports: [AnhangService],
})
export class AnhangModule {}