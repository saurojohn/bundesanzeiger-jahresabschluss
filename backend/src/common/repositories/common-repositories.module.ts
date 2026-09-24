import { Module } from '@nestjs/common';
import { BilanzRepository } from './bilanz.repository';
import { GuVRepository } from './guv.repository';
import { AnhangRepository } from './anhang.repository';
import { SignatureRepository } from './signature.repository';

/**
 * Globale Bereitstellung der Repositories für Bilanz/GuV/Anhang/Signature.
 *
 * Wird vom BilanzModule, GuVModule, AnhangModule und SignaturModule
 * importiert. PrismaModule ist global verfügbar, daher reicht hier
 * ein einfaches providers-Array.
 */
@Module({
  providers: [
    BilanzRepository,
    GuVRepository,
    AnhangRepository,
    SignatureRepository,
  ],
  exports: [
    BilanzRepository,
    GuVRepository,
    AnhangRepository,
    SignatureRepository,
  ],
})
export class CommonRepositoriesModule {}