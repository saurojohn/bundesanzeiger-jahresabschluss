import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { MandantController } from './controllers/mandant.controller';
import { MandantService } from './services/mandant.service';

@Module({
  imports: [AuditModule],
  controllers: [MandantController],
  providers: [MandantService],
  exports: [MandantService],
})
export class MandantModule {}
