import { Module } from '@nestjs/common';
import { CommonModule } from '../../common/common.module';
import { AuditModule } from '../audit/audit.module';
import { MandantController } from './controllers/mandant.controller';
import { MandantService } from './services/mandant.service';

@Module({
  imports: [CommonModule, AuditModule],
  controllers: [MandantController],
  providers: [MandantService],
  exports: [MandantService],
})
export class MandantModule {}
