import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  ObjectLockMode,
} from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';
import { WormObjectRepository } from '../repositories/worm-object.repository';
import type {
  ObjectLockStatus,
  WormObjectMetadata,
  WormStorageOptions,
} from '../interfaces/storage.interface';

/**
 * Standard-Retention: 10 Jahre (GoBD § 147 AO).
 */
const DEFAULT_RETENTION_DAYS = 3650;

/**
 * Standard-Object-Lock-Modus: COMPLIANCE.
 *
 * COMPLIANCE: weder Überschreiben noch Löschen möglich — auch nicht
 *            durch den Root-User (sicherste Form).
 * GOVERNANCE: nur mit expliziter Berechtigung überschreibbar.
 *
 * Wir wählen COMPLIANCE, weil die GoBD-Anforderung "unveränderlich" ist.
 */
const DEFAULT_LOCK_MODE: ObjectLockMode = 'COMPLIANCE';

/**
 * Storage-Service für WORM-Storage (Write-Once-Read-Many).
 *
 * Setzt S3 Object Lock mit COMPLIANCE-Modus und 10-Jahres-Retention um.
 * Kompatibel mit:
 *   - AWS S3 (nativ)
 *   - MinIO (lokal/Dev, mit `MINIO_OBJECT_LOCK_ENABLED`)
 *   - Hetzner Storage Box (S3-kompatibel, Pilot)
 *
 * WORM-Semantik (GoBD § 147 AO):
 *   - Upload: immer mit ObjectLockMode=COMPLIANCE + LegalHold=ON
 *   - Re-Upload mit gleichem Key: idempotent (Existenz-Check)
 *   - Delete: refuses wenn Object-Lock aktiv
 *
 * Hash: SHA-256 wird im Manifest persistiert + in jeden AuditLog
 *       geschrieben — damit ist die Integrität zu jedem Zeitpunkt
 *       nachweisbar.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly defaultRetentionDays: number;
  private readonly defaultLockMode: ObjectLockMode;

  constructor(
    private readonly configService: ConfigService,
    private readonly wormObjectRepository: WormObjectRepository,
  ) {
    const endpoint = this.configService.get<string>('S3_ENDPOINT');
    const region = this.configService.get<string>('S3_REGION', 'eu-central-1');
    const accessKeyId = this.configService.get<string>('S3_ACCESS_KEY');
    const secretAccessKey = this.configService.get<string>('S3_SECRET_KEY');
    const bucket = this.configService.get<string>('S3_BUCKET');

    if (!bucket) {
      throw new Error(
        'S3_BUCKET nicht konfiguriert. Setze S3_BUCKET in .env (z.B. "banz-worm").',
      );
    }
    this.bucket = bucket;

    // MinIO / Hetzner brauchen `forcePathStyle: true` — AWS native nutzt
    // virtual-hosted-style. Wir gehen auf Nummer sicher und forcen
    // Path-Style (MinIO-Compat).
    this.s3 = new S3Client({
      region,
      ...(endpoint ? { endpoint, forcePathStyle: true } : { forcePathStyle: true }),
      credentials:
        accessKeyId && secretAccessKey
          ? { accessKeyId, secretAccessKey }
          : // Fallback: EC2 Instance Profile / env. Wird vom SDK
            // automatisch aufgelöst.
            undefined,
    });

    this.defaultRetentionDays = Number.parseInt(
      this.configService.get<string>(
        'S3_OBJECT_LOCK_RETENTION_DAYS',
        String(DEFAULT_RETENTION_DAYS),
      ),
      10,
    );

    const lockModeConfig = this.configService.get<string>(
      'S3_OBJECT_LOCK_MODE',
      DEFAULT_LOCK_MODE,
    );
    this.defaultLockMode = this.parseLockMode(lockModeConfig);

    this.logger.log(
      `StorageService initialisiert: bucket=${this.bucket} endpoint=${endpoint ?? '(default AWS)'} retention=${this.defaultRetentionDays}d mode=${this.defaultLockMode}`,
    );
  }

  /**
   * Lädt einen Buffer in den WORM-Storage.
   *
   * Schritte:
   *   1. SHA-256 berechnen (Deterministische Integrität).
   *   2. HeadObject — existiert der Key bereits? Wenn ja:
   *      - gleicher Hash → idempotent OK
   *      - anderer Hash → ConflictException (WORM: kein Überschreiben)
   *   3. PutObject mit Object-Lock-Headern + Legal-Hold.
   *   4. Metadata zurückgeben (WORM-Manifest wird separat geschrieben).
   */
  async uploadToWorm(options: WormStorageOptions): Promise<WormObjectMetadata> {
    const sha256Hash = WormObjectRepository.sha256Of(options.data);
    const sizeBytes = options.data.length;
    const uploadedAt = new Date();
    const retentionDays = options.retentionDays ?? this.defaultRetentionDays;
    const retentionExpiresAt = new Date(uploadedAt);
    retentionExpiresAt.setUTCDate(retentionExpiresAt.getUTCDate() + retentionDays);

    // 1. Existenz-Check via HeadObject.
    let exists = false;
    let existingHash: string | undefined;
    try {
      const head = await this.s3.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: options.objectKey }),
      );
      exists = true;
      const meta = head.Metadata?.['sha256'];
      if (typeof meta === 'string') existingHash = meta;
    } catch (err: unknown) {
      // 404 = not found = OK; andere Errors durchreichen.
      const error = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      const isNotFound =
        error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404;
      if (!isNotFound) {
        throw err;
      }
    }

    if (exists) {
      if (existingHash === sha256Hash) {
        // Idempotenter Re-Upload (gleicher Inhalt). Kein Konflikt.
        this.logger.warn(
          `WORM: Objekt ${options.objectKey} existiert bereits mit identischem Hash — kein Re-Upload.`,
        );
      } else {
        throw new ConflictException(
          `WORM-Objekt ${options.objectKey} existiert bereits mit abweichendem Hash. WORM-Storage erlaubt kein Überschreiben.`,
        );
      }
    } else {
      // 2. PutObject mit Lock-Headern.
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: options.objectKey,
          Body: options.data,
          ContentType: options.contentType ?? 'application/pdf',
          ObjectLockMode: this.defaultLockMode,
          ObjectLockRetainUntilDate: retentionExpiresAt,
          ObjectLockLegalHoldStatus: 'ON',
          Metadata: {
            sha256: sha256Hash,
            entityType: options.entityType,
            entityId: options.entityId,
            mandantId: options.mandantId,
          },
        }),
      );

      this.logger.log(
        `WORM-Upload OK: key=${options.objectKey} size=${sizeBytes}B hash=${sha256Hash.slice(0, 12)}… retention=${retentionDays}d`,
      );
    }

    return {
      objectKey: options.objectKey,
      sha256Hash,
      sizeBytes,
      uploadedAt,
      retentionExpiresAt,
    };
  }

  /**
   * Lädt ein Objekt aus dem WORM-Storage.
   *
   * Wirft `NotFoundException`, wenn das Objekt nicht existiert.
   * Der Buffer wird vollständig in den Speicher geladen — WORM-Objekte
   * sind klein (PDF ~50-500 KB), also OK.
   */
  async downloadFromWorm(objectKey: string): Promise<Buffer> {
    try {
      const res = await this.s3.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }),
      );
      const body = res.Body as Readable | undefined;
      if (!body) {
        throw new NotFoundException(`WORM-Objekt ${objectKey}: leerer Body`);
      }
      const chunks: Buffer[] = [];
      for await (const chunk of body) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    } catch (err: unknown) {
      const error = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      const isNotFound =
        error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404;
      if (isNotFound) {
        throw new NotFoundException(`WORM-Objekt nicht gefunden: ${objectKey}`);
      }
      throw err;
    }
  }

  /**
   * Versucht, ein WORM-Objekt zu löschen — schlägt fehl, wenn Object-Lock
   * aktiv ist (GoBD: WORM ist WORM).
   *
   * Hintergrund: AWS S3 wirft einen `AccessDenied` (oder bei MinIO
   * `MethodNotAllowed`), wenn Object-Lock aktiv ist. Wir geben diesen
   * Fehler als ConflictException an den Aufrufer weiter.
   */
  async deleteFromWorm(objectKey: string): Promise<void> {
    try {
      await this.s3.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }),
      );
      this.logger.warn(
        `WORM-Delete OK: ${objectKey} (Object-Lock war NICHT aktiv — prüfen!)`,
      );
    } catch (err: unknown) {
      const error = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      const isLockViolation =
        error.name === 'AccessDenied' || error.$metadata?.httpStatusCode === 403;
      if (isLockViolation) {
        throw new ConflictException(
          `WORM-Objekt ${objectKey} ist durch Object-Lock geschützt und kann nicht gelöscht werden (GoBD § 147 AO).`,
        );
      }
      throw err;
    }
  }

  /**
   * Prüft den Object-Lock-Status eines Objekts.
   *
   * Nutzt HeadObject — billig, kein Download.
   */
  async checkObjectLock(objectKey: string): Promise<ObjectLockStatus> {
    try {
      const head = await this.s3.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }),
      );
      const retention = head.ObjectLockRetainUntilDate;
      const mode = head.ObjectLockMode;
      const legalHold = head.ObjectLockLegalHoldStatus;
      return {
        locked: Boolean(mode) || legalHold === 'ON',
        legalHold: legalHold === 'ON',
        retentionUntil: retention,
        mode: mode ?? undefined,
      };
    } catch (err: unknown) {
      const error = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      const isNotFound =
        error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404;
      if (isNotFound) {
        return { locked: false };
      }
      throw err;
    }
  }

  /**
   * Liefert die Konfiguration für Audit/Logs.
   */
  getConfig(): {
    bucket: string;
    retentionDays: number;
    lockMode: ObjectLockMode;
  } {
    return {
      bucket: this.bucket,
      retentionDays: this.defaultRetentionDays,
      lockMode: this.defaultLockMode,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private parseLockMode(value: string): ObjectLockMode {
    if (value === 'GOVERNANCE' || value === 'COMPLIANCE') {
      return value;
    }
    this.logger.warn(
      `Unbekannter S3_OBJECT_LOCK_MODE="${value}", fallback auf COMPLIANCE`,
    );
    return DEFAULT_LOCK_MODE;
  }
}