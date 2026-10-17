import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/services/audit.service';
import { assertMandantNichtArchiviert } from '../../../common/utils/mandant-archivierung';
import { CreateJahresabschlussDto } from '../dto/create-jahresabschluss.dto';
import type { AuthUser } from '../../auth/types/auth-user.types';

/**
 * Jahresabschluss — das Aggregat nach § 314 HGB.
 *
 * BEFUND 2026-10-17 (Nachtrag 27): Zu diesem Objekt gab es überhaupt keinen
 * Schreibpfad — keine Route, keinen Service, 0 Datensätze nach dem Seed.
 * Damit waren `signatur.signAbschluss()` und `pdf/abschluss/:id/generate`
 * vorhandener, aber unerreichbarer Code.
 *
 * Dieser Service baut **nur die Anlage und das Lesen**. Das Abschließen
 * (`finalize`) ist bewusst NICHT enthalten: Es braucht die Entscheidung, ob
 * eine Abweichung zwischen Bilanz-`A.V.` und GuV-Ergebnis sperrt oder nur
 * warnt (Nachtrag 22). `A.V.` ist nicht zwangsläufig das Jahresergebnis —
 * Kapitalerhöhungen und Entnahmen verschieben den Saldo, ohne in der GuV zu
 * erscheinen, und das Produkt modelliert solche Bewegungen nicht.
 *
 * Die Bestandteile werden hier **ermittelt, nicht entgegengenommen** — siehe
 * `CreateJahresabschlussDto`.
 */
@Injectable()
export class AbschlussService {
  private readonly logger = new Logger(AbschlussService.name);

  static readonly entityName = 'Jahresabschluss';

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Legt den Jahresabschluss für Mandant + Jahr an.
   *
   * Fehlende Bestandteile sind ein **409**, kein 400: Die Anfrage war
   * richtig, der Zustand ist es nicht — §314 HGB verlangt alle drei.
   */
  async create(
    dto: CreateJahresabschlussDto,
    user: AuthUser,
    context: { ip?: string | null; userAgent?: string | null },
  ) {
    this.assertMandantAccess(dto.mandantId, user);

    const mandant = await this.prisma.mandant.findUnique({
      where: { id: dto.mandantId },
      select: { id: true, archiviertAt: true, firmenname: true },
    });
    if (!mandant) throw new NotFoundException('Mandant nicht gefunden');

    // Entscheidung 2026-10-14: archivierte Mandanten werden nicht
    // fortgeschrieben. Ein Jahresabschluss ist die Fortschreibung schlechthin.
    assertMandantNichtArchiviert(mandant.archiviertAt, 'Jahresabschluss anlegen');

    const [bilanz, guv, anhang] = await Promise.all([
      this.prisma.bilanz.findFirst({
        where: { mandantId: dto.mandantId, geschaeftsjahr: dto.geschaeftsjahr },
        select: { id: true },
      }),
      this.prisma.guV.findFirst({
        where: { mandantId: dto.mandantId, geschaeftsjahr: dto.geschaeftsjahr },
        select: { id: true },
      }),
      this.prisma.anhang.findFirst({
        where: { mandantId: dto.mandantId, geschaeftsjahr: dto.geschaeftsjahr },
        select: { id: true },
      }),
    ]);

    const fehlend = [
      !bilanz ? 'Bilanz' : null,
      !guv ? 'GuV' : null,
      !anhang ? 'Anhang' : null,
    ].filter((x): x is string => x !== null);

    if (fehlend.length > 0) {
      throw new ConflictException(
        `Für das Geschäftsjahr ${dto.geschaeftsjahr} fehlt${fehlend.length > 1 ? 'en' : ''} ` +
          `${fehlend.join(' und ')} (${mandant.firmenname}). ` +
          '§ 314 HGB verlangt für den Jahresabschluss alle drei Bestandteile.',
      );
    }

    let abschluss;
    try {
      abschluss = await this.prisma.jahresabschluss.create({
        data: {
          mandantId: dto.mandantId,
          geschaeftsjahr: dto.geschaeftsjahr,
          bilanzId: bilanz!.id,
          guvId: guv!.id,
          anhangId: anhang!.id,
          status: 'DRAFT',
          createdById: user.id,
        },
        include: { bilanz: true, guv: true, anhang: true },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          `Für ${mandant.firmenname} existiert für das Geschäftsjahr ` +
            `${dto.geschaeftsjahr} bereits ein Jahresabschluss.`,
        );
      }
      throw err;
    }

    void this.auditService.record({
      userId: user.id,
      mandantId: dto.mandantId,
      action: 'CREATE',
      entityType: AbschlussService.entityName,
      entityId: abschluss.id,
      newState: {
        geschaeftsjahr: abschluss.geschaeftsjahr,
        status: abschluss.status,
        bilanzId: abschluss.bilanzId,
        guvId: abschluss.guvId,
        anhangId: abschluss.anhangId,
      } as unknown as Prisma.JsonValue,
      ipAddress: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    this.logger.log(
      `Jahresabschluss angelegt: ${mandant.firmenname} GJ ${dto.geschaeftsjahr} → ${abschluss.id}`,
    );
    return this.toResponse(abschluss);
  }

  /**
   * Liste der Jahresabschlüsse eines Mandanten, neueste zuerst.
   *
   * Der Context-Mandant kommt aus dem `MandantGuard` (Header/Query/Body),
   * nicht aus einem freien Parameter.
   */
  async findAll(mandantId: string, user: AuthUser) {
    this.assertMandantAccess(mandantId, user);
    const eintraege = await this.prisma.jahresabschluss.findMany({
      where: { mandantId },
      orderBy: [{ geschaeftsjahr: 'desc' }],
      include: { bilanz: true, guv: true, anhang: true },
    });
    return eintraege.map((a) => this.toResponse(a));
  }

  async findOne(id: string, mandantId: string, user: AuthUser) {
    this.assertMandantAccess(mandantId, user);
    const abschluss = await this.prisma.jahresabschluss.findFirst({
      where: { id, mandantId },
      include: { bilanz: true, guv: true, anhang: true },
    });
    if (!abschluss) throw new NotFoundException('Jahresabschluss nicht gefunden');
    return this.toResponse(abschluss);
  }

  private toResponse(a: {
    id: string;
    mandantId: string;
    geschaeftsjahr: number;
    bilanzId: string;
    guvId: string;
    anhangId: string;
    status: string;
    finalisiertAm: Date | null;
    signiertAm: Date | null;
    eingereichtAm: Date | null;
    veroeffentlichtAm: Date | null;
    banzBestellnummer: string | null;
    createdAt: Date;
  }) {
    return {
      id: a.id,
      mandantId: a.mandantId,
      geschaeftsjahr: a.geschaeftsjahr,
      bilanzId: a.bilanzId,
      guvId: a.guvId,
      anhangId: a.anhangId,
      status: a.status,
      finalisiertAm: a.finalisiertAm?.toISOString() ?? null,
      signiertAm: a.signiertAm?.toISOString() ?? null,
      eingereichtAm: a.eingereichtAm?.toISOString() ?? null,
      veroeffentlichtAm: a.veroeffentlichtAm?.toISOString() ?? null,
      banzBestellnummer: a.banzBestellnummer,
      createdAt: a.createdAt.toISOString(),
    };
  }

  private assertMandantAccess(mandantId: string, user: AuthUser): void {
    const zugreifbar = (user.mandanten ?? []).some((m) => m.id === mandantId);
    if (zugreifbar) return;
    if (user.globalRole === 'SYSTEM_ADMIN') return;
    throw new BadRequestException('Kein Zugriff auf diesen Mandanten');
  }
}
