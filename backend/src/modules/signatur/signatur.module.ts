import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuditModule } from '../audit/audit.module';
import { PdfModule } from '../pdf/pdf.module';
import { CommonRepositoriesModule } from '../../common/repositories/common-repositories.module';
import { SignaturController } from './controllers/signatur.controller';
import { SignaturService } from './services/signatur.service';
import { P12Service } from './services/p12.service';
import { TsaClientService } from './services/tsa-client.service';

/**
 * Modul für qualifizierte elektronische Signaturen (qeS).
 *
 * Endpoints:
 *   - POST /api/signatur/sign-bilanz
 *   - POST /api/signatur/sign-guv
 *   - POST /api/signatur/sign-anhang
 *   - POST /api/signatur/sign-abschluss
 *   - POST /api/signatur/validate
 *   - POST /api/signatur/inspect-p12
 *
 * Abhängigkeiten:
 *   - PdfModule       (PDF-Generierung als Vorlage für Signatur)
 *   - AuditModule     (Audit-Trail-Eintrag nach Signatur)
 *   - CommonRepositoriesModule (Bilanz/GuV/Anhang + Signature)
 *   - ConfigModule    (TSA_URL, TSA_USER, TSA_PWD)
 *
 * StorageModule ist global verfügbar — muss nicht explizit importiert
 * werden.
 *
 * RBAC:
 *   - WIRTSCHAFTSPRUEFER + STEUERBERATER: sign-bilanz/guv/anhang
 *   - WIRTSCHAFTSPRUEFER:                sign-abschluss (Endabnahme)
 *   - Alle authentifizierten User:       validate
 *   - WIRTSCHAFTSPRUEFER + STEUERBERATER: inspect-p12
 */
@Module({
  imports: [ConfigModule, AuditModule, PdfModule, CommonRepositoriesModule],
  controllers: [SignaturController],
  providers: [SignaturService, P12Service, TsaClientService],
  exports: [SignaturService, P12Service, TsaClientService],
})
export class SignaturModule {}