import { Module } from '@nestjs/common';
import { CommonModule } from '../../common/common.module';
import { AuditController } from './controllers/audit.controller';
import { AuditService } from './services/audit.service';

@Module({
  imports: [CommonModule],
  providers: [AuditService],
  controllers: [AuditController],
  exports: [AuditService],
})
export class AuditModule {}
