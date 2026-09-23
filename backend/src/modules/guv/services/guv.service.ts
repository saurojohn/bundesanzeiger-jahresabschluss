import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GuVRepository, type GuVEntity } from '../../../common/repositories/guv.repository';
import { AuditService } from '../../audit/services/audit.service';
import type { AuthUser } from '../../auth/types/auth-user.types';
import {
  GUV_VERFAHREN,
  type GuVVerfahren,
  type HgbGuVPosition,
  getGuVSchema,
} from '../constants/hgb-guv.constants';
import { CreateGuVDto } from '../dto/create-guv.dto';
import { UpdateGuVDto } from '../dto/update-guv.dto';
import {
  CreateGuVResponse,
  GuVValidierungDto,
} from '../dto/guv-validierung.dto';

export interface GuVServiceContext {
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Service für GuV-Operationen (§ 275 HGB).
 *
 * Unterstützt beide Verfahren: GKV (§ 275 Abs. 2) und UKV (§ 275 Abs. 1).
 * Validierung: Σ Erlöse - Σ Aufwendungen = Jahresüberschuss/-fehlbetrag.
 */
@Injectable()
export class GuVService {
  private readonly logger = new Logger(GuVService.name);

  constructor(
    private readonly guvRepository: GuVRepository,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Liefert das HGB-GuV-Schema für ein Verfahren.
   */
  getHgbSchema(verfahren: GuVVerfahren): HgbGuVPosition[] {
    return getGuVSchema(verfahren);
  }

  /**
   * Erstellt eine neue GuV mit Positionen.
   */
  async create(
    dto: CreateGuVDto,
    user: AuthUser,
    context: GuVServiceContext,
  ): Promise<CreateGuVResponse> {
    this.assertMandantAccess(dto.mandantId, user);

    // Berechne das Jahresergebnis aus den Positionen.
    const tempGuv = this.buildTempGuV(dto.mandantId, dto.geschaeftsjahr, dto.verfahren, dto.positionen.map((p) => ({
      kontonummer: p.kontonummer,
      bezeichnung: p.bezeichnung,
      kategorie: p.kategorie,
      betragAktuell: p.betragAktuell,
      reihenfolge: p.reihenfolge,
      bemerkung: p.bemerkung,
    })));
    const validierung = this.computeValidation(tempGuv);

    let guv: GuVEntity;
    try {
      guv = await this.guvRepository.createWithPositionen({
        mandantId: dto.mandantId,
        geschaeftsjahr: dto.geschaeftsjahr,
        verfahren: dto.verfahren,
        hinweise: dto.hinweise ?? null,
        ergebnis: validierung.jahresergebnis,
        createdById: user.id,
        positionen: dto.positionen.map((p) => ({
          kontonummer: p.kontonummer,
          bezeichnung: p.bezeichnung,
          kategorie: p.kategorie,
          betragVorjahr: p.betragVorjahr ?? null,
          betragAktuell: p.betragAktuell,
          reihenfolge: p.reihenfolge,
          bemerkung: p.bemerkung ?? null,
        })),
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new BadRequestException(
          `Für diesen Mandanten existiert bereits eine GuV für das Geschäftsjahr ${dto.geschaeftsjahr}.`,
        );
      }
      throw err;
    }

    const warnungen: string[] = [];
    if (validierung.fehlendePflichtfelder.length > 0) {
      warnungen.push(
        `${validierung.fehlendePflichtfelder.length} Pflichtfelder nicht befüllt: ${validierung.fehlendePflichtfelder.join(', ')}`,
      );
    }
    if (!validierung.istUeberschuss && validierung.differenz < 0) {
      warnungen.push(
        `GuV zeigt Jahresfehlbetrag: ${validierung.jahresergebnis.toFixed(2)} EUR`,
      );
    }

    void this.auditService.record({
      userId: user.id,
      mandantId: dto.mandantId,
      action: 'CREATE',
      entityType: 'GuV',
      entityId: guv.id,
      newState: this.toAuditDto(guv),
      ipAddress: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return {
      guv,
      validierung,
      warnungen: warnungen.length ? warnungen : undefined,
    };
  }

  async findAll(mandantId: string, user: AuthUser, jahr?: number) {
    this.assertMandantAccess(mandantId, user);
    return this.guvRepository.findByMandantAndJahr(mandantId, jahr);
  }

  async findOne(id: string, mandantId: string, user: AuthUser): Promise<GuVEntity> {
    this.assertMandantAccess(mandantId, user);
    const guv = await this.guvRepository.findWithPositionen(id, mandantId);
    if (!guv) throw new NotFoundException('GuV nicht gefunden');
    return guv;
  }

  async update(
    id: string,
    mandantId: string,
    dto: UpdateGuVDto,
    user: AuthUser,
    context: GuVServiceContext,
  ): Promise<GuVEntity> {
    this.assertMandantAccess(mandantId, user);

    const previous = await this.guvRepository.findWithPositionen(id, mandantId);
    if (!previous) throw new NotFoundException('GuV nicht gefunden');
    if (previous.status !== 'DRAFT' && dto.positionen !== undefined) {
      throw new BadRequestException(
        'Positionen können nur in DRAFT-Phase geändert werden',
      );
    }

    // Re-berechne Jahresergebnis wenn Positionen sich ändern.
    let ergebnis: number | undefined = dto.ergebnis;
    if (dto.positionen !== undefined) {
      const tempGuv = this.buildTempGuV(
        mandantId,
        previous.geschaeftsjahr,
        (dto.verfahren ?? previous.verfahren) as GuVVerfahren,
        dto.positionen.map((p) => ({
          kontonummer: p.kontonummer,
          bezeichnung: p.bezeichnung,
          kategorie: p.kategorie,
          betragAktuell: p.betragAktuell,
          reihenfolge: p.reihenfolge,
          bemerkung: p.bemerkung,
        })),
      );
      ergebnis = this.computeValidation(tempGuv).jahresergebnis;
    }

    const updated = await this.guvRepository.updateWithPositionen(id, mandantId, {
      hinweise: dto.hinweise ?? undefined,
      status: dto.status ?? undefined,
      verfahren: dto.verfahren ?? undefined,
      ergebnis,
      updatedById: user.id,
      positionen: dto.positionen?.map((p) => ({
        kontonummer: p.kontonummer,
        bezeichnung: p.bezeichnung,
        kategorie: p.kategorie,
        betragVorjahr: p.betragVorjahr ?? null,
        betragAktuell: p.betragAktuell,
        reihenfolge: p.reihenfolge,
        bemerkung: p.bemerkung ?? null,
      })),
    });

    void this.auditService.record({
      userId: user.id,
      mandantId,
      action: 'UPDATE',
      entityType: 'GuV',
      entityId: id,
      previousState: this.toAuditDto(previous),
      newState: this.toAuditDto(updated),
      ipAddress: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return updated;
  }

  async validate(
    id: string,
    mandantId: string,
    user: AuthUser,
  ): Promise<GuVValidierungDto> {
    this.assertMandantAccess(mandantId, user);
    const guv = await this.guvRepository.findWithPositionen(id, mandantId);
    if (!guv) throw new NotFoundException('GuV nicht gefunden');
    return this.computeValidation(guv);
  }

  async delete(
    id: string,
    mandantId: string,
    user: AuthUser,
    context: GuVServiceContext,
  ): Promise<void> {
    this.assertMandantAccess(mandantId, user);

    const existing = await this.guvRepository.findById(id, mandantId);
    if (!existing) throw new NotFoundException('GuV nicht gefunden');
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException(
        'Löschung nur in der DRAFT-Phase erlaubt.',
      );
    }

    const before = await this.guvRepository.findWithPositionen(id, mandantId);
    await this.guvRepository.deleteByMandant(id, mandantId);

    void this.auditService.record({
      userId: user.id,
      mandantId,
      action: 'DELETE',
      entityType: 'GuV',
      entityId: id,
      previousState: before ? this.toAuditDto(before) : null,
      ipAddress: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });
  }

  /** Liste der unterstützten Verfahren — für GET /api/guv/schema ohne Parameter. */
  getVerfahren(): readonly string[] {
    return GUV_VERFAHREN;
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  private assertMandantAccess(mandantId: string, user: AuthUser): void {
    if (user.globalRole === 'SYSTEM_ADMIN') return;
    const accessibleMandantIds = user.mandanten.map((m) => m.id);
    if (!accessibleMandantIds.includes(mandantId)) {
      throw new ForbiddenException('Kein Zugriff auf diesen Mandanten');
    }
  }

  /**
   * Baut ein temporäres GuV-Objekt für die Validierung (ohne DB-Roundtrip).
   */
  private buildTempGuV(
    mandantId: string,
    geschaeftsjahr: number,
    verfahren: string,
    positionen: Array<{
      kontonummer: string;
      bezeichnung: string;
      kategorie: string;
      betragAktuell: number;
      reihenfolge: number;
      bemerkung?: string | null;
    }>,
  ): GuVEntity {
    const now = new Date();
    return {
      id: 'temp',
      mandantId,
      geschaeftsjahr,
      verfahren,
      status: 'DRAFT',
      hinweise: null,
      bilanzId: null,
      ergebnis: new Prisma.Decimal(0),
      createdAt: now,
      updatedAt: now,
      createdById: null,
      updatedById: null,
      positionen: positionen.map((p, idx) => ({
        id: `temp-${idx}`,
        guvId: 'temp',
        kontonummer: p.kontonummer,
        bezeichnung: p.bezeichnung,
        kategorie: p.kategorie,
        betragVorjahr: null,
        betragAktuell: new Prisma.Decimal(p.betragAktuell),
        reihenfolge: p.reihenfolge,
        bemerkung: p.bemerkung ?? null,
        createdAt: now,
        updatedAt: now,
      })),
    };
  }

  /**
   * Berechnet Saldo (Erlöse - Aufwendungen) und Pflichtfeld-Status.
   */
  private computeValidation(guv: GuVEntity): GuVValidierungDto {
    let summeErloese = 0;
    let summeAufwendungen = 0;
    let positionenMitBetrag = 0;

    // Erlöse/Finanzerträge sind positive Werte.
    // Aufwendungen (Material, Personal, Abschreibung, etc.) sind negative Werte.
    for (const pos of guv.positionen) {
      const betrag = Number(pos.betragAktuell);
      if (betrag === 0) continue;
      positionenMitBetrag += 1;
      if (
        pos.kategorie === 'ERLOES' ||
        pos.kategorie === 'FINANZ'
      ) {
        // FINANZ: enthält sowohl Erträge (Positionen 9-11) als auch
        // Aufwendungen (12-13) — wir vereinfachen hier: in der GuV
        // werden FINANZ-Erträge als positiv und FINANZ-Aufwendungen
        // als negativ erfasst. Per Konvention hier: Position mit
        // positivem Betrag = Ertrag.
        if (betrag > 0) {
          summeErloese += betrag;
        } else {
          summeAufwendungen += Math.abs(betrag);
        }
      } else {
        summeAufwendungen += Math.abs(betrag);
      }
    }

    const differenz = summeErloese - summeAufwendungen;
    const jahresergebnis = Number(differenz.toFixed(2));
    const istUeberschuss = jahresergebnis >= 0;

    // Pflichtfelder: Umsatzerlöse, Materialaufwand, Personalaufwand
    const pflichtKontonummern = ['1.', '5.', '6.'];
    const vorhandene = new Set(guv.positionen.map((p) => p.kontonummer));
    const fehlendePflichtfelder: string[] = [];
    for (const k of pflichtKontonummern) {
      if (!vorhandene.has(k)) {
        fehlendePflichtfelder.push(k);
      }
    }

    return {
      summeErloese: Number(summeErloese.toFixed(2)),
      summeAufwendungen: Number(summeAufwendungen.toFixed(2)),
      differenz: jahresergebnis,
      jahresergebnis,
      istUeberschuss,
      positionenMitBetrag,
      fehlendePflichtfelder,
    };
  }

  private toAuditDto(guv: GuVEntity): Prisma.JsonValue {
    return {
      id: guv.id,
      mandantId: guv.mandantId,
      geschaeftsjahr: guv.geschaeftsjahr,
      verfahren: guv.verfahren,
      status: guv.status,
      hinweise: guv.hinweise,
      bilanzId: guv.bilanzId,
      ergebnis: guv.ergebnis.toString(),
      createdById: guv.createdById,
      updatedById: guv.updatedById,
      createdAt: guv.createdAt,
      updatedAt: guv.updatedAt,
      positionen: guv.positionen.map((p) => ({
        id: p.id,
        kontonummer: p.kontonummer,
        bezeichnung: p.bezeichnung,
        kategorie: p.kategorie,
        betragVorjahr: p.betragVorjahr?.toString() ?? null,
        betragAktuell: p.betragAktuell.toString(),
        reihenfolge: p.reihenfolge,
        bemerkung: p.bemerkung,
      })),
    } as unknown as Prisma.JsonValue;
  }
}