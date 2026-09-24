import { Module } from '@nestjs/common';
import { CommonModule } from '../common.module';
import { BilanzRepository } from './bilanz.repository';
import { GuVRepository } from './guv.repository';
import { AnhangRepository } from './anhang.repository';
import { SignatureRepository } from './signature.repository';
import { KonsolidierungRepository } from './konsolidierung.repository';

/**
 * Globale Bereitstellung der Repositories für Bilanz/GuV/Anhang/Signature
 * und Konsolidierung.
 *
 * Wird vom BilanzModule, GuVModule, AnhangModule, SignaturModule und
 * KonsolidierungModule importiert. PrismaModule ist global verfügbar,
 * daher reicht hier ein einfaches providers-Array.
 */
@Module({
  imports: [CommonModule],
  providers: [
    BilanzRepository,
    GuVRepository,
    AnhangRepository,
    SignatureRepository,
    KonsolidierungRepository,
  ],
  exports: [
    BilanzRepository,
    GuVRepository,
    AnhangRepository,
    SignatureRepository,
    KonsolidierungRepository,
  ],
})
export class CommonRepositoriesModule {}