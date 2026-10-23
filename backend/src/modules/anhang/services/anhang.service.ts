import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AnhangRepository,
  type AnhangEntity,
  type AnhangListEntry,
} from '../../../common/repositories/anhang.repository';
import { PaginationService } from '../../../common/services/pagination.service';
import {
  type LegacyPaginatedResult,
  type PaginatedResult,
} from '../../../common/dto/pagination.dto';
import { AuditService } from '../../audit/services/audit.service';
import type { AuthUser } from '../../auth/types/auth-user.types';
import {
  ANHANG_TEMPLATE_ABSCHNITTE,
  ANHANG_VORLAGEN_PLATZHALTER,
} from '../constants/anhang.constants';
import { CreateAnhangDto } from '../dto/create-anhang.dto';
import { UpdateAnhangDto } from '../dto/update-anhang.dto';
import {
  assertFreigabemarkerUnveraendert,
  assertKeinZuruecksetzenInBearbeitung,
} from '../../../common/utils/status-transition';
import { assertMandantNichtArchiviert } from '../../../common/utils/mandant-archivierung';
import { MandantRepository } from '../../../common/repositories/mandant.repository';
import { assertMandantAccess } from '../../../common/utils/mandant-zugriff';

/**
 * Listenansicht: alle Skalarfelder, die Anzahl der Abschnitte (`_count`) und
 * der WORM-ObjectKey. Die Abschnittsinhalte sind bewusst NICHT enthalten —
 * die Liste zeigt nur "N Abschnitte".
 */
export type AnhangSummaryWithWorm = AnhangListEntry & {
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

export interface AnhangServiceContext {
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Service für Anhang (§ 284-289 HGB).
 */
@Injectable()
export class AnhangService {
  private readonly logger = new Logger(AnhangService.name);

  constructor(
    private readonly anhangRepository: AnhangRepository,
    private readonly auditService: AuditService,
    private readonly mandantRepository: MandantRepository,
  ) {}

  /**
   * Liefert die Standard-Abschnitts-Templates (für GET /api/anhang/templates).
   */
  getTemplateAbschnitte() {
    return ANHANG_TEMPLATE_ABSCHNITTE;
  }

  async create(
    dto: CreateAnhangDto,
    user: AuthUser,
    context: AnhangServiceContext,
  ): Promise<AnhangEntity> {
    assertMandantAccess(dto.mandantId, user);
    await this.assertMandantBearbeitbar(dto.mandantId, 'Anhang anlegen');

    let anhang: AnhangEntity;
    try {
      anhang = await this.anhangRepository.createWithAbschnitte({
        mandantId: dto.mandantId,
        geschaeftsjahr: dto.geschaeftsjahr,
        bilanzierungsMethoden: dto.bilanzierungsMethoden ?? null,
        bewertungsMethoden: dto.bewertungsMethoden ?? null,
        sonstigePflichtangaben: dto.sonstigePflichtangaben ?? null,
        createdById: user.id,
        abschnitte: dto.abschnitte ?? [],
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          `Für diesen Mandanten existiert bereits ein Anhang für das Geschäftsjahr ${dto.geschaeftsjahr}.`,
        );
      }
      throw err;
    }

    await this.auditService.record({
      userId: user.id,
      mandantId: dto.mandantId,
      action: 'CREATE',
      entityType: 'Anhang',
      entityId: anhang.id,
      newState: this.toAuditDto(anhang),
      ipAddress: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return anhang;
  }

  /**
   * Platzhalter, die in den Abschnitten noch unaufgeloest stehen.
   *
   * BEFUND 2026-10-17: Ein aus der Vorlage angelegter Anhang speichert
   * `[Ort]`, `[Nummer]`, `[Steuernummer]`, `[Name]` und `[Anzahl]`
   * unaufgeloest, und die PDF-Erzeugung liefert trotzdem HTTP 200 — ein
   * veroeffentlichungsfaehiges Dokument mit "[Ort]" darin (§ 264 Abs. 4 HGB
   * verlangt konkrete Angaben). Fuer den Anhang gab es keine
   * Validierungsroute.
   *
   * Bewusst eine **Meldung, keine Sperre**: die Liste enthaelt nur
   * Platzhalter, die das System selbst gesetzt hat, aber es ist nicht das
   * System, das entscheidet, ob eine Angabe noch offen ist. § 284 HGB
   * verlangt den Inhalt, nicht unsere Freigabe. Zusaetzlich ist der
   * Jahresabschluss der Ort, an dem die Vollstaendigkeit geprueft wird —
   * dort waere die Sperre am richtigen Ort.
   */
  /**
   * Die offenen Platzhalter im Anhang — Abschnitte **und** Pflichtangaben.
   *
   * BEFUND 2026-10-24 (Nachtrag 93): Geprüft wurden nur die Abschnitte.
   * Die drei Pflichtangaben (§ 284 Abs. 2 Nr. 1/2, § 285 HGB) stehen
   * genauso im PDF (`anhang.template.ts:78-80`) — ein "[Ort]" dort blieb
   * unentdeckt.
   *
   * GEMESSEN an der laufenden API: Anhang mit
   * `bilanzierungsMethoden = "Lineare Abschreibung, Sitz [Ort]"` und
   * `sonstigePflichtangaben = "Steuernummer [Steuernummer]"` →
   * die Detailantwort meldete `offenePlatzhalter: []`.
   *
   * Dieselben Platzhalter in einem Abschnitt werden gemeldet — die Regel
   * galt also nur für einen Teil des Anhangs.
   */
  offenePlatzhalter(anhang: {
    abschnitte: Array<{ inhalt: string }>;
    bilanzierungsMethoden?: string | null;
    bewertungsMethoden?: string | null;
    sonstigePflichtangaben?: string | null;
  }): string[] {
    const inhalt = [
      ...anhang.abschnitte.map((a) => a.inhalt ?? ''),
      anhang.bilanzierungsMethoden ?? '',
      anhang.bewertungsMethoden ?? '',
      anhang.sonstigePflichtangaben ?? '',
    ].join('\n');
    return ANHANG_VORLAGEN_PLATZHALTER.filter((p) => inhalt.includes(`[${p}]`));
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
    | Array<AnhangSummaryWithWorm>
    | PaginatedResult<AnhangSummaryWithWorm>
    | LegacyPaginatedResult<AnhangSummaryWithWorm>
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

    return this.anhangRepository.findByMandantAndJahrWithWorm(mandantId, jahr);
  }

  /**
   * Cursor-paginierte Anhang-Liste (M3+ Performance).
   */
  async findAllPaginated(args: {
    mandantId: string;
    user: AuthUser;
    jahr?: number;
    cursor?: string;
    pageSize?: number;
  }): Promise<PaginatedResult<AnhangSummaryWithWorm>> {
    assertMandantAccess(args.mandantId, args.user);
    const pageSize = Math.min(args.pageSize ?? 20, 100);
    const [items, total] = await Promise.all([
      this.anhangRepository.findByMandantPaginated({
        mandantId: args.mandantId,
        cursor: args.cursor,
        pageSize,
        jahr: args.jahr,
      }),
      this.anhangRepository.countByMandant({
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
  }): Promise<LegacyPaginatedResult<AnhangSummaryWithWorm>> {
    assertMandantAccess(args.mandantId, args.user);
    const pageSize = Math.min(args.pageSize ?? 20, 100);
    const offset = (args.page - 1) * pageSize;
    const [items, total] = await Promise.all([
      this.anhangRepository.findByMandantAndJahrWithWorm(args.mandantId, args.jahr),
      this.anhangRepository.countByMandant({
        mandantId: args.mandantId,
        jahr: args.jahr,
      }),
    ]);
    const sliced = items.slice(offset, offset + pageSize);
    return PaginationService.buildLegacyResponse(sliced, total, args.page, pageSize);
  }

  async findOne(
    id: string,
    mandantId: string,
    user: AuthUser,
  ): Promise<AnhangEntity & { offenePlatzhalter: string[] }> {
    assertMandantAccess(mandantId, user);
    const anhang = await this.anhangRepository.findWithAbschnitte(id, mandantId);
    if (!anhang) throw new NotFoundException('Anhang nicht gefunden');
    // BEFUND 2026-10-17: Ein aus der Vorlage angelegter Anhang speichert
    // die Platzhalter unaufgeloest und liefert trotzdem ein PDF (HTTP 200).
    // Damit der Anwender das vor der Veroeffentlichung sieht, haengt die
    // Liste an der Detailantwort — dort, wo er ohnehin arbeitet.
    return { ...anhang, offenePlatzhalter: this.offenePlatzhalter(anhang) };
  }

  async update(
    id: string,
    mandantId: string,
    dto: UpdateAnhangDto,
    user: AuthUser,
    context: AnhangServiceContext,
  ): Promise<AnhangEntity> {
    assertMandantAccess(mandantId, user);
    await this.assertMandantBearbeitbar(mandantId, 'Anhang ändern');

    const previous = await this.anhangRepository.findWithAbschnitte(id, mandantId);
    if (!previous) throw new NotFoundException('Anhang nicht gefunden');
    // Status kommt aus dem Request — ohne diese Pruefung war die
    // DRAFT-Sperre unten mit einem PATCH aufzuheben (Befund 2026-10-09).
    assertKeinZuruecksetzenInBearbeitung(previous.status, dto.status, 'Anhang');
    // BEFUND 2026-10-22 (Nachtrag 81): der Vier-Augen-Freigabemarker
    // (APPROVED) darf nicht weggeraeumt werden — er steht im signierten
    // Dokument.
    assertFreigabemarkerUnveraendert(previous.status, dto.status, 'Anhang');
    // BEFUND 2026-10-24 (Nachtrag 93): Die DRAFT-Sperre gilt für die
    // ABSCHNITTE. Für die drei Pflichtangaben gilt sie **nicht** — und das
    // ist so gewollt:
    //
    // Entscheidung der Fachverantwortlichen vom 2026-10-14 (Nachtrag 77):
    // „Soll das Signieren die Bilanz/GuV/Anhang gegen Änderung sperren?"
    // → **Nein**. „Ein Korrekturvorgang erzeugt zwingend eine neue Signatur,
    // und der alte WORM-Satz darf nicht gelöscht werden. Stattdessen muss
    // SICHTBAR sein, wenn die vorgelegten Daten nicht mehr der signierten
    // Fassung entsprechen."
    //
    // Die Positionen der Bilanz und der GuV sind ab VALIDATED eingefroren.
    // Damit sind die drei Pflichtangaben-Felder der **einzige** Weg, einen
    // Korrekturvorgang am signierten Jahresabschluss zu erzeugen
    // (Nachtrag 78: Re-Signatur; der Abweichungsindikator zeigt die
    // Abweichung an, die Einreichung wird gesperrt).
    //
    // GEMESSEN an der laufenden API (Anhang auf VALIDATED):
    //     Abschnitte ändern      -> HTTP 400 (gesperrt)
    //     bilanzierungsMethoden  -> HTTP 200 (änderbar — Korrekturvorgang)
    //
    // Eine Sperre für die drei Felder würde den Korrekturvorgang
    // unmöglich machen. Deshalb bleibt es hier bei der Asymmetrie — sie
    // ist dokumentiert und getestet, nicht vergessen.
    if (previous.status !== 'DRAFT' && dto.abschnitte !== undefined) {
      throw new BadRequestException(
        'Abschnitte können nur in DRAFT-Phase geändert werden',
      );
    }

    const updated = await this.anhangRepository.updateWithAbschnitte(id, mandantId, {
      status: dto.status ?? undefined,
      bilanzierungsMethoden: dto.bilanzierungsMethoden ?? undefined,
      bewertungsMethoden: dto.bewertungsMethoden ?? undefined,
      sonstigePflichtangaben: dto.sonstigePflichtangaben ?? undefined,
      updatedById: user.id,
      abschnitte: dto.abschnitte,
    });

    await this.auditService.record({
      userId: user.id,
      mandantId,
      action: 'UPDATE',
      entityType: 'Anhang',
      entityId: id,
      previousState: this.toAuditDto(previous),
      newState: this.toAuditDto(updated),
      ipAddress: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return updated;
  }

  async delete(
    id: string,
    mandantId: string,
    user: AuthUser,
    context: AnhangServiceContext,
  ): Promise<void> {
    assertMandantAccess(mandantId, user);
    await this.assertMandantBearbeitbar(mandantId, 'Anhang löschen');

    const existing = await this.anhangRepository.findById(id, mandantId);
    if (!existing) throw new NotFoundException('Anhang nicht gefunden');
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException(
        'Löschung nur in der DRAFT-Phase erlaubt.',
      );
    }

    const before = await this.anhangRepository.findWithAbschnitte(id, mandantId);
    await this.anhangRepository.deleteByMandant(id, mandantId);

    await this.auditService.record({
      userId: user.id,
      mandantId,
      action: 'DELETE',
      entityType: 'Anhang',
      entityId: id,
      previousState: before ? this.toAuditDto(before) : null,
      ipAddress: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================


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

  private toAuditDto(anhang: AnhangEntity): Prisma.JsonValue {
    return {
      id: anhang.id,
      mandantId: anhang.mandantId,
      geschaeftsjahr: anhang.geschaeftsjahr,
      status: anhang.status,
      bilanzierungsMethoden: anhang.bilanzierungsMethoden,
      bewertungsMethoden: anhang.bewertungsMethoden,
      sonstigePflichtangaben: anhang.sonstigePflichtangaben,
      createdById: anhang.createdById,
      updatedById: anhang.updatedById,
      createdAt: anhang.createdAt,
      updatedAt: anhang.updatedAt,
      abschnitte: anhang.abschnitte.map((a) => ({
        id: a.id,
        titel: a.titel,
        inhalt: a.inhalt,
        reihenfolge: a.reihenfolge,
      })),
    } as unknown as Prisma.JsonValue;
  }
}