import { Module } from '@nestjs/common';
import { CommonModule } from '../common.module';
import { BilanzRepository } from './bilanz.repository';
import { GuVRepository } from './guv.repository';
import { AnhangRepository } from './anhang.repository';
import { SignatureRepository } from './signature.repository';
import { KonsolidierungRepository } from './konsolidierung.repository';
import { KanzleiRepository } from './kanzlei.repository';
import { MandantRepository } from './mandant.repository';

/**
 * Globale Bereitstellung der Repositories für Bilanz/GuV/Anhang/Signature,
 * Konsolidierung, Kanzlei/Branding und den Archivzustand eines Mandanten.
 *
 * Wird vom BilanzModule, GuVModule, AnhangModule, SignaturModule,
 * KonsolidierungModule und BrandingModule importiert. PrismaModule ist
 * global verfügbar, daher reicht hier ein einfaches providers-Array.
 */
@Module({
  imports: [CommonModule],
  providers: [
    BilanzRepository,
    GuVRepository,
    AnhangRepository,
    SignatureRepository,
    KonsolidierungRepository,
    KanzleiRepository,
    MandantRepository,
  ],
  exports: [
    BilanzRepository,
    GuVRepository,
    AnhangRepository,
    SignatureRepository,
    KonsolidierungRepository,
    KanzleiRepository,
    MandantRepository,
  ],
})
export class CommonRepositoriesModule {}