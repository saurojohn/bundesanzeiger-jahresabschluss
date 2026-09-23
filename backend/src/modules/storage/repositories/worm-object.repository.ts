import { Injectable } from '@nestjs/common';
import { Prisma, type WormObject } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Typen für WORM-Manifest-Einträge.
 */
export type WormObjectEntity = WormObject;

export interface CreateWormObjectInput {
  objectKey: string;
  entityType: string;
  entityId: string;
  mandantId: string;
  sha256Hash: string;
  sizeBytes: number;
  objectLockMode: string;
  retentionDays: number;
  retentionExpiresAt: Date;
  uploadedById: string | null;
  legalHold: boolean;
}

/**
 * Repository für `WormObject` — das Manifest aller im Object-Lock-Storage
 * abgelegten Dokumente.
 *
 * WORM-Objekte sind append-only: Es gibt bewusst keinen `update()` oder
 * `delete()`. Eine Korrektur erfolgt durch ein NEUES Objekt (mit neuem
 * Key) plus AuditLog-Eintrag — niemals durch Manipulation am Original.
 *
 * Direkter Prisma-Zugriff in `src/modules/...` ist via ESLint verboten —
 * Ausnahme: `*Repository*.ts` (siehe `eslint.config.mjs`).
 */
@Injectable()
export class WormObjectRepository {
  constructor(private readonly prismaService: PrismaService) {}

  /** Menschenlesbarer Entity-Name (für Logs / Audit). */
  static readonly entityName = 'WormObject';

  /**
   * Schreibt einen neuen Manifest-Eintrag. Wird nach erfolgreichem
   * S3-Upload aufgerufen — fehlgeschlagene Uploads dürfen KEIN
   * Manifest erzeugen.
   */
  async create(input: CreateWormObjectInput): Promise<WormObjectEntity> {
    return this.prismaService.wormObject.create({
      data: {
        objectKey: input.objectKey,
        entityType: input.entityType,
        entityId: input.entityId,
        mandantId: input.mandantId,
        sha256Hash: input.sha256Hash,
        sizeBytes: input.sizeBytes,
        objectLockMode: input.objectLockMode,
        retentionDays: input.retentionDays,
        retentionExpiresAt: input.retentionExpiresAt,
        uploadedById: input.uploadedById,
        legalHold: input.legalHold,
      },
    });
  }

  /**
   * Findet ein Manifest per S3-Key (z.B. um Existenz vor Re-Upload zu prüfen).
   */
  async findByObjectKey(objectKey: string): Promise<WormObjectEntity | null> {
    return this.prismaService.wormObject.findUnique({ where: { objectKey } });
  }

  /**
   * Findet alle Manifest-Einträge zu einer Entity (z.B. alle PDFs einer
   * Bilanz — alte + neue).
   */
  async findByEntity(
    entityType: string,
    entityId: string,
  ): Promise<WormObjectEntity[]> {
    return this.prismaService.wormObject.findMany({
      where: { entityType, entityId },
      orderBy: { uploadedAt: 'desc' },
    });
  }

  /**
   * Findet alle Manifest-Einträge eines Mandanten (für Audit/Reports).
   */
  async findByMandant(mandantId: string): Promise<WormObjectEntity[]> {
    return this.prismaService.wormObject.findMany({
      where: { mandantId },
      orderBy: { uploadedAt: 'desc' },
    });
  }

  /**
   * Liefert den neuesten aktiven Eintrag zu einer Entity — das ist
   * das, was der Download-Endpoint ausliefern soll.
   */
  async findActiveByEntity(
    entityType: string,
    entityId: string,
  ): Promise<WormObjectEntity | null> {
    return this.prismaService.wormObject.findFirst({
      where: { entityType, entityId },
      orderBy: { uploadedAt: 'desc' },
    });
  }

  /**
   * Berechnet den SHA-256-Hash eines Buffers (Helper).
   *
   * Wird auch vom Service genutzt; hier als statische Methode
   * exponiert, damit Tests sie direkt prüfen können.
   */
  static sha256Of(buffer: Buffer): string {
    // Node crypto ist verfügbar; wir nutzen es bewusst ohne extra
    // Dependency (kein Grund `crypto-js` o.ä. einzuziehen).
    const nodeCrypto = require('node:crypto') as typeof import('node:crypto');
    return nodeCrypto.createHash('sha256').update(buffer).digest('hex');
  }
}

/**
 * Re-Export des `WormObject`-Prisma-Typs (für Konsumenten).
 */
export type { WormObject };
// Hinweis: `Prisma`-Import wird für künftige Where-Inputs gehalten
// (z.B. wenn findByMandant erweitert wird).
export type WormObjectWhereInput = Prisma.WormObjectWhereInput;