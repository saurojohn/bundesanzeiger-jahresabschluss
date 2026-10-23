import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  GuVRepository,
  type GuVEntity,
  type GuVWithoutPositionen,
} from '../../../common/repositories/guv.repository';
import { PaginationService } from '../../../common/services/pagination.service';
import {
  type LegacyPaginatedResult,
  type PaginatedResult,
} from '../../../common/dto/pagination.dto';
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
import {
  assertFreigabemarkerUnveraendert,
  assertKeinZuruecksetzenInBearbeitung,
} from '../../../common/utils/status-transition';
import {
  eingereichtSperrtext,
  istEingereicht,
} from '../../../common/utils/einreichung-sperre';
import { assertMandantNichtArchiviert } from '../../../common/utils/mandant-archivierung';
import { MandantRepository } from '../../../common/repositories/mandant.repository';
import { assertMandantAccess } from '../../../common/utils/mandant-zugriff';

export type GuVSummaryWithWorm = GuVWithoutPositionen & {
  wormObjectKey: string | null;
  /**
   * Ist das PDF ein Entwurf (Arbeitsstand) oder ein Beweisobjekt?
   *
   * BEFUND 2026-10-20 (Nachtrag 61, TODO-8.9): Entwuerfe liegen nicht im
   * Beweis-Archiv, sondern unter eigenem EntityType und eigenem Praefix.
   * Die Liste muss das unterscheiden — sonst waere der WORM-Hinweis in der
   * Oberflaeche fuer einen Entwurf eine falsche Aussage.
   */
  pdfIstEntwurf: boolean;
};

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
    private readonly mandantRepository: MandantRepository,
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
    assertMandantAccess(dto.mandantId, user);
    await this.assertMandantBearbeitbar(dto.mandantId, 'GuV anlegen');

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
        throw new ConflictException(
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

    await this.auditService.record({
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

  async findAll(
    mandantId: string,
    user: AuthUser,
    jahr?: number,
    pagination?: {
      cursor?: string;
      pageSize?: number;
      page?: number;
    },
  ): Promise<
    | Array<GuVSummaryWithWorm>
    | PaginatedResult<GuVSummaryWithWorm>
    | LegacyPaginatedResult<GuVSummaryWithWorm>
  > {
    assertMandantAccess(mandantId, user);

    if (pagination?.page !== undefined && pagination?.cursor === undefined) {
      return this.findAllLegacy({
        mandantId,
        user,
        jahr,
        page: pagination.page,
        pageSize: pagination.pageSize,
      });
    }

    if (pagination?.cursor !== undefined || pagination?.pageSize !== undefined) {
      return this.findAllPaginated({
        mandantId,
        user,
        jahr,
        cursor: pagination.cursor,
        pageSize: pagination.pageSize,
      });
    }

    return this.guvRepository.findByMandantAndJahrWithWorm(mandantId, jahr);
  }

  /**
   * Cursor-paginierte GuV-Liste (M3+ Performance).
   */
  async findAllPaginated(args: {
    mandantId: string;
    user: AuthUser;
    jahr?: number;
    cursor?: string;
    pageSize?: number;
  }): Promise<PaginatedResult<GuVSummaryWithWorm>> {
    assertMandantAccess(args.mandantId, args.user);
    const pageSize = Math.min(args.pageSize ?? 20, 100);
    const [items, total] = await Promise.all([
      this.guvRepository.findByMandantPaginated({
        mandantId: args.mandantId,
        cursor: args.cursor,
        pageSize,
        jahr: args.jahr,
      }),
      this.guvRepository.countByMandant({
        mandantId: args.mandantId,
        jahr: args.jahr,
      }),
    ]);
    return PaginationService.buildResponse(
      items,
      total,
      pageSize,
      (item) => item.updatedAt.toISOString(),
    );
  }

  /**
   * Legacy Offset-Pagination (Backwards-Compat).
   */
  async findAllLegacy(args: {
    mandantId: string;
    user: AuthUser;
    jahr?: number;
    page: number;
    pageSize?: number;
  }): Promise<LegacyPaginatedResult<GuVSummaryWithWorm>> {
    assertMandantAccess(args.mandantId, args.user);
    const pageSize = Math.min(args.pageSize ?? 20, 100);
    const offset = (args.page - 1) * pageSize;
    const [items, total] = await Promise.all([
      this.guvRepository.findByMandantAndJahrWithWorm(args.mandantId, args.jahr),
      this.guvRepository.countByMandant({
        mandantId: args.mandantId,
        jahr: args.jahr,
      }),
    ]);
    const sliced = items.slice(offset, offset + pageSize);
    return PaginationService.buildLegacyResponse(sliced, total, args.page, pageSize);
  }

  async findOne(id: string, mandantId: string, user: AuthUser): Promise<GuVEntity> {
    assertMandantAccess(mandantId, user);
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
    assertMandantAccess(mandantId, user);
    await this.assertMandantBearbeitbar(mandantId, 'GuV ändern');

    const previous = await this.guvRepository.findWithPositionen(id, mandantId);
    if (!previous) throw new NotFoundException('GuV nicht gefunden');
    // Status kommt aus dem Request — ohne diese Pruefung war die
    // DRAFT-Sperre unten mit einem PATCH aufzuheben (Befund 2026-10-09).
    assertKeinZuruecksetzenInBearbeitung(previous.status, dto.status, 'GuV');
    // BEFUND 2026-10-22 (Nachtrag 81): der Vier-Augen-Freigabemarker
    // (APPROVED) darf nicht weggeraeumt werden — er steht im signierten
    // Dokument.
    assertFreigabemarkerUnveraendert(previous.status, dto.status, 'GuV');
    if (previous.status !== 'DRAFT' && dto.positionen !== undefined) {
      throw new BadRequestException(
        'Positionen können nur in DRAFT-Phase geändert werden',
      );
    }

    // BEFUND 2026-10-24 (Nachtrag 95): Nach der Einreichung beim
    // Bundesanzeiger wird der Datenbestand nicht mehr fortgeschrieben —
    // die `hinweise` der GuV stehen im PDF und waren auch danach
    // aenderbar (siehe die Begruendung im Bilanz-Service).
    const abschlussStatus =
      await this.guvRepository.findJahresabschlussStatusByGuVId(id);
    if (
      istEingereicht(abschlussStatus) &&
      (dto.positionen !== undefined || dto.hinweise !== undefined)
    ) {
      throw new ConflictException(eingereichtSperrtext(abschlussStatus!));
    }

    // Re-berechne Jahresergebnis wenn Positionen sich ändern.
    //
    // BEFUND 2026-10-11: stand hier `let ergebnis = dto.ergebnis`. Das Feld
    // stand im UpdateGuVDto und wurde ungeprueft uebernommen, wenn keine
    // Positionen mitgeschickt wurden. Live: PATCH { ergebnis: 999999.99 }
    // -> HTTP 200, DB 999999.99 — und der Wert landete in GuV-PDF,
    // Abschluss-PDF und E-Bilanz-XBRL (`netIncome`).
    //
    // `ergebnis` ist ABGELEITET. Ohne Positionsaenderung wird es nicht neu
    // berechnet und der bestehende Datenbankwert bleibt unberuehrt; das
    // Feld ist jetzt auch aus dem DTO entfernt, sodass ein Versuch ueber
    // `forbidNonWhitelisted` mit 400 endet.
    let ergebnis: number | undefined = undefined;
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

    await this.auditService.record({
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
    assertMandantAccess(mandantId, user);
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
    assertMandantAccess(mandantId, user);
    await this.assertMandantBearbeitbar(mandantId, 'GuV löschen');

    const existing = await this.guvRepository.findById(id, mandantId);
    if (!existing) throw new NotFoundException('GuV nicht gefunden');
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException(
        'Löschung nur in der DRAFT-Phase erlaubt.',
      );
    }

    const before = await this.guvRepository.findWithPositionen(id, mandantId);
    await this.guvRepository.deleteByMandant(id, mandantId);

    await this.auditService.record({
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
      // Bugfix 2026-10-07: neues Feld aus dem Schema — der Einzelsatz
      // ist ausdruecklich KEIN Konzernsatz.
      konzernEinheitId: null,
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

  /**
   * Der Mandant darf nicht archiviert sein.
   *
   * PRODUKTENTSCHEIDUNG 2026-10-09: „Archivieren statt Loeschen". Ein
   * Mandant, der weg muss, wird archiviert — der Bestand bleibt zur
   * Nachvollziehbarkeit lesbar (§ 147 AO), es entstehen aber keine neuen
   * Belege mehr. Das Loeschen ist fuer Mandanten mit Bestand gesperrt
   * (HTTP 409), damit die Zehnjahresfrist nicht mehr ueber die Anwendung
   * umgangen werden kann.
   *
   * Nur die Schreibpfade (`create`/`update`/`delete`) pruefen das. Lesen
   * bleibt zulaessig: ein archivierter Mandant muss gerade lesbar sein,
   * sonst waere die Nachvollziehbarkeit genau das, was man verliert.
   */
  private async assertMandantBearbeitbar(mandantId: string, aktion: string): Promise<void> {
    const mandant = await this.mandantRepository.findArchivierung(mandantId);
    if (!mandant) throw new NotFoundException('Mandant nicht gefunden');
    assertMandantNichtArchiviert(mandant.archiviertAt, aktion);
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