import { Global, Module } from '@nestjs/common';
import { StorageService } from './services/storage.service';
import { WormObjectRepository } from './repositories/worm-object.repository';

/**
 * Storage-Modul: WORM-Storage + Manifest-Repository.
 *
 * Global, damit PDF-Service + (spätere) Submission-Service ohne
 * expliziten Import Zugriff haben.
 */
@Global()
@Module({
  providers: [StorageService, WormObjectRepository],
  exports: [StorageService, WormObjectRepository],
})
export class StorageModule {}