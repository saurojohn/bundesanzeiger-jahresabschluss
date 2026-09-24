import { Injectable } from '@nestjs/common';
import { Prisma, type Signature } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Typen für Signature-Records.
 *
 * Bewusst lokal definiert (analog Bilanz/GuV-Repositories) — die
 * DTOs wandeln Domain-Werte (z.B. `signatureType`) in den
 * Schema-String (`signaturTyp`) um.
 */
export type SignatureEntity = Signature;

export interface CreateSignatureInput {
  jahresabschlussId: string;
  userId: string;
  rolle: string;
  signaturTyp: string;
  zertifikatSubject?: string | null;
  zertifikatIssuer?: string | null;
  zertifikatSeriennummer?: string | null;
  zertifikatGueltigAb?: Date | null;
  zertifikatGueltigBis?: Date | null;
  zeitstempel: Date;
  zeitstempelIssuer?: string | null;
  hashVorher: string;
  hashNachher: string;
  signaturDaten: Buffer;
  signaturFormat?: string;
}

/**
 * Mandant-isoliertes Repository für Signature-Records.
 *
 * Wird vom SignaturService verwendet, um nach erfolgreicher Signatur
 * einen Signature-Datensatz zu persistieren. Der `jahresabschlussId`-
 * Filter wird vom Service übergeben — direkter Aufruf ohne
 * Mandant-Kontext ist im Service NICHT erlaubt.
 */
@Injectable()
export class SignatureRepository {
  constructor(private readonly prismaService: PrismaService) {}

  /** Menschenlesbarer Entity-Name (für Logs / Audit). */
  static readonly entityName = 'Signature';

  /**
   * Erstellt einen neuen Signature-Record. Wird nach erfolgreicher
   * P12-Signatur + WORM-Upload aufgerufen.
   */
  async create(input: CreateSignatureInput): Promise<SignatureEntity> {
    return this.prismaService.signature.create({
      data: {
        jahresabschlussId: input.jahresabschlussId,
        userId: input.userId,
        rolle: input.rolle,
        signaturTyp: input.signaturTyp,
        zertifikatSubject: input.zertifikatSubject ?? null,
        zertifikatIssuer: input.zertifikatIssuer ?? null,
        zertifikatSeriennummer: input.zertifikatSeriennummer ?? null,
        zertifikatGueltigAb: input.zertifikatGueltigAb ?? null,
        zertifikatGueltigBis: input.zertifikatGueltigBis ?? null,
        zeitstempel: input.zeitstempel,
        zeitstempelIssuer: input.zeitstempelIssuer ?? null,
        hashVorher: input.hashVorher,
        hashNachher: input.hashNachher,
        signaturDaten: input.signaturDaten,
        signaturFormat: input.signaturFormat ?? 'PKCS7',
      },
    });
  }

  /**
   * Findet alle Signature-Records für einen Jahresabschluss.
   */
  async findByJahresabschluss(
    jahresabschlussId: string,
  ): Promise<SignatureEntity[]> {
    return this.prismaService.signature.findMany({
      where: { jahresabschlussId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Findet einen Signature-Record per ID.
   */
  async findById(id: string): Promise<SignatureEntity | null> {
    return this.prismaService.signature.findUnique({ where: { id } });
  }

  /**
   * Findet den neuesten Signature-Record für einen Jahresabschluss.
   */
  async findLatestByJahresabschluss(
    jahresabschlussId: string,
  ): Promise<SignatureEntity | null> {
    return this.prismaService.signature.findFirst({
      where: { jahresabschlussId },
      orderBy: { createdAt: 'desc' },
    });
  }
}

// Hinweis: Prisma-Import wird für künftige Where-Inputs gehalten.
export type SignatureWhereInput = Prisma.SignatureWhereInput;