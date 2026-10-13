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
  /**
   * Die ID, unter der der Datensatz gespeichert wird.
   *
   * BEFUND 2026-10-13: Dieses Feld fehlte. `create()` gab kein `id` an
   * Prisma, also vergab Prisma ueber `@default(uuid())` eine EIGENE UUID.
   * Die `signatureId` aus der API-Antwort war damit auch beim
   * Jahresabschluss — wo der Datensatz sehr wohl existierte — eine andere
   * als die gespeicherte. Gemessen: Antwort-ID nicht auffindbar, Tabelle
   * enthaelt genau eine Zeile mit abweichender UUID.
   *
   * Der SignaturService erzeugt die ID bewusst VOR der Transaktion, damit
   * Manifest, Record und Audit-Eintrag dieselbe bezeichnen.
   */
  id: string;
  /**
   * GENAU EINE der beiden Bezugsachsen muss belegt sein.
   *
   *   * Jahresabschluss-Signatur: `jahresabschlussId`
   *   * Entitaeten-Signatur:       `entityType` + `entityId`
   *
   * `jahresabschlussId` ist optional, weil eine signierte Bilanz/GuV/Anhang
   * an keinen Abschluss gebunden ist. Bis 2026-10-13 war das Feld NOT NULL —
   * deshalb wurde der Datensatz in diesem Fall uebersprungen und die API
   * lieferte eine `signatureId`, die nirgends auffindbar war.
   */
  jahresabschlussId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
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
  async create(
    input: CreateSignatureInput,
    /**
     * Bestehender Transaktionsclient — siehe `worm-object.repository.ts`.
     * Ohne ihn konnte das WORM-Manifest persistiert sein, während der
     * Signatur-Datensatz fehlt.
     */
    tx?: Prisma.TransactionClient,
  ): Promise<SignatureEntity> {
    // Fail-closed statt stillem Datenverlust: ein Record ohne Bezugsachse
    // waere unauffindbar — genau der Zustand, den die Entitaeten-Signatur
    // bis 2026-10-13 erzeugt hat (ID in der Antwort, nichts in der Tabelle).
    const hatAbschluss = Boolean(input.jahresabschlussId);
    const hatEntitaet = Boolean(input.entityType && input.entityId);
    if (!hatAbschluss && !hatEntitaet) {
      throw new Error(
        'Signature braucht genau eine Bezugsachse: jahresabschlussId ODER entityType+entityId',
      );
    }

    return (tx ?? this.prismaService).signature.create({
      data: {
        id: input.id,
        jahresabschlussId: input.jahresabschlussId ?? null,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
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
   * Findet alle Signature-Records fuer eine signierte Entitaet
   * (Bilanz/GuV/Anhang), neueste zuerst.
   */
  async findByEntity(
    entityType: string,
    entityId: string,
  ): Promise<SignatureEntity[]> {
    return this.prismaService.signature.findMany({
      where: { entityType, entityId },
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