import { Module } from '@nestjs/common';
import { CommonModule } from '../../common/common.module';
import { AuditController } from './controllers/audit.controller';
import { AuditService } from './services/audit.service';
import { AuditIntegrityService } from './services/audit-integrity.service';

@Module({
  imports: [CommonModule],
  providers: [AuditService, AuditIntegrityService],
  controllers: [AuditController],
  exports: [AuditService, AuditIntegrityService],
})
export class AuditModule {}