import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { WPController } from './controllers/wp.controller';
import { IdwPruefungService } from './services/idw-pruefung.service';
import { WPNotizService } from './services/wp-notiz.service';
import { WPPruefungService } from './services/wp-pruefung.service';
import { WPRepository } from './wp.repository';

/**
 * Modul für Wirtschaftsprüfung (IDW PS 880).
 *
 *   - 5 IDW-Standard-Plausi-Regeln
 *   - WP-Notizen mit 4-Augen-Acknowledgement (Self-Ack-Schutz)
 *   - WP-Prüfungs-Vorgang mit Finalize (Bilanz → APPROVED)
 *   - Markdown-Bericht (GoBD-konform)
 *
 * Abhängigkeiten:
 *   - AuditModule (für AuditService)
 *   - PrismaModule (global)
 */
@Module({
  imports: [AuditModule, PrismaModule],
  controllers: [WPController],
  providers: [WPRepository, IdwPruefungService, WPNotizService, WPPruefungService],
  exports: [WPRepository, IdwPruefungService, WPNotizService, WPPruefungService],
})
export class WPModule {}