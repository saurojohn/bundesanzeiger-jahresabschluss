import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CommonRepositoriesModule } from '../../common/repositories/common-repositories.module';
import { GuVController } from './controllers/guv.controller';
import { GuVService } from './services/guv.service';

/**
 * Modul für GuV (§ 275 HGB).
 */
@Module({
  imports: [AuditModule, CommonRepositoriesModule],
  controllers: [GuVController],
  providers: [GuVService],
  exports: [GuVService],
})
export class GuVModule {}