import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { BilanzModule } from '../bilanz/bilanz.module';
import { GuVModule } from '../guv/guv.module';
import { AnhangModule } from '../anhang/anhang.module';
import { StorageModule } from '../storage/storage.module';
import { AbschlussController } from './controllers/abschluss.controller';
import { AbschlussService } from './services/abschluss.service';

/**
 * Jahresabschluss (§ 314 HGB) — Verknüpfung von Bilanz, GuV und Anhang.
 *
 * Bis 2026-10-17 existierte dieses Modul nicht; die geplante Struktur nannte
 * es unter `abschluss/`. Siehe Nachtrag 27 des GoBD-Audit-Reports.
 */
@Module({
  imports: [AuditModule, BilanzModule, GuVModule, AnhangModule, StorageModule],
  controllers: [AbschlussController],
  providers: [AbschlussService],
  exports: [AbschlussService],
})
export class AbschlussModule {}
