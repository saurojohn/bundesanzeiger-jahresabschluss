import { Module } from '@nestjs/common';
import { CommonModule } from '../../common/common.module';
import { AuditController } from './controllers/audit.controller';
import { AuditService } from './services/audit.service';
import { AuditIntegrityService } from './services/audit-integrity.service';
import { AuditInterceptor } from './interceptors/audit.interceptor';

@Module({
  imports: [CommonModule],
  // Der Interceptor war bis 2026-09-30 NUR im Quellcode vorhanden und
  // nirgends registriert — er lief nie. Damit war auch die Umstellung auf
  // den blockierenden Audit-Pfad (Runde-2-Commit) wirkungslos; tatsaechlich
  // auditierte weiterhin nur die 48 fire-and-forget-Aufrufstellen.
  // Jetzt als Provider registriert.
  providers: [AuditService, AuditIntegrityService, AuditInterceptor],
  controllers: [AuditController],
  exports: [AuditService, AuditIntegrityService],
})
export class AuditModule {}