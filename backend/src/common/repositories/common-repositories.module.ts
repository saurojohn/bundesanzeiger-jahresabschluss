import { Module } from '@nestjs/common';
import { BilanzRepository } from './bilanz.repository';
import { GuVRepository } from './guv.repository';
import { AnhangRepository } from './anhang.repository';

/**
 * Globale Bereitstellung der Repositories für Bilanz/GuV/Anhang.
 *
 * Wird vom BilanzModule, GuVModule und AnhangModule importiert.
 * PrismaModule ist global verfügbar, daher reicht hier ein einfaches
 * providers-Array.
 */
@Module({
  providers: [BilanzRepository, GuVRepository, AnhangRepository],
  exports: [BilanzRepository, GuVRepository, AnhangRepository],
})
export class CommonRepositoriesModule {}