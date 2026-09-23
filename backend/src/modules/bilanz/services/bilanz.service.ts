import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BilanzRepository, type BilanzEntity } from '../../../common/repositories/bilanz.repository';
import { AuditService } from '../../audit/services/audit.service';
import type { AuthUser } from '../../auth/types/auth-user.types';
import {
  HGB_BILANZ_SCHEMA,
  type HgbBilanzPosition,
} from '../constants/hgb-bilanz.constants';
import { CreateBilanzDto } from '../dto/create-bilanz.dto';
import { UpdateBilanzDto } from '../dto/update-bilanz.dto';
import {
  BilanzValidierungDto,
  CreateBilanzResponse,
} from '../dto/bilanz-validierung.dto';

export interface BilanzServiceContext {
  ip?: string | null;
  userAgent?: string | null;
}

const SALDO_TOLERANZ_CENTS = 1; // 0.01€ Toleranz für Rundungsdifferenzen.

/**
 * Service für Bilanz-Operationen.
 *
 * Erzwingt Mandant-Trennung (über Repository-Filter), Audit-Trail
 * (über AuditService.record), und Saldo-Validierung
 * (Aktiva == Passiva).
 *
 * RBAC (im Controller umgesetzt): STEUERBERATER + KANZLEI_ADMIN dürfen
 * CREATE/UPDATE, GF/WP nur READ.
 */
@Injectable()
export class BilanzService {
  private readonly logger = new Logger(BilanzService.name);

  constructor(
    private readonly bilanzRepository: BilanzRepository,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Liefert das HGB-Bilanzschema (öffentlich für alle authentifizierten
   * User — kein Mandant-Filter, da statisch).
   */
  getHgbSchema(): HgbBilanzPosition[] {
    return HGB_BILANZ_SCHEMA;
  }

  /**
   * Erstellt eine neue Bilanz mit Positionen.
   *
   * Führt Saldo-Validierung durch. Bei ungleichem Saldo wird die
   * Bilanz trotzdem angelegt (DRAFT) und Warnungen in der Response
   * zurückgegeben — der User kann die Daten dann korrigieren.
   */
  async create(
    dto: CreateBilanzDto,
    user: AuthUser,
    context: BilanzServiceContext,
  ): Promise<CreateBilanzResponse> {
    this.assertMandantAccess(dto.mandantId, user);

    // Eindeutigkeit (mandantId, geschaeftsjahr) — Repository wirft
    // einen Prisma-Fehler, das fangen wir hier ab.
    let bilanz: BilanzEntity;
    try {
      bilanz = await this.bilanzRepository.createWithPositionen({
        mandantId: dto.mandantId,
        geschaeftsjahr: dto.geschaeftsjahr,
        hinweise: dto.hinweise ?? null,
        createdById: user.id,
        positionen: dto.positionen.map((p) => ({
          seite: p.seite,
          kontonummer: p.kontonummer,
          bezeichnung: p.bezeichnung,
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
          `Für diesen Mandanten existiert bereits eine Bilanz für das Geschäftsjahr ${dto.geschaeftsjahr}.`,
        );
      }
      throw err;
    }

    const validierung = this.computeValidation(bilanz);
    const warnungen: string[] = [];
    if (!validierung.saldostimmt) {
      warnungen.push(
        `Bilanz ist nicht ausgeglichen: Differenz = ${validierung.differenz.toFixed(2)} EUR`,
      );
    }
    if (validierung.fehlendePflichtfelder.length > 0) {
      warnungen.push(
        `${validierung.fehlendePflichtfelder.length} Pflichtfelder nicht befüllt: ${validierung.fehlendePflichtfelder.join(', ')}`,
      );
    }

    void this.auditService.record({
      userId: user.id,
      mandantId: dto.mandantId,
      action: 'CREATE',
      entityType: 'Bilanz',
      entityId: bilanz.id,
      newState: this.toAuditDto(bilanz),
      ipAddress: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return { bilanz, validierung, warnungen: warnungen.length ? warnungen : undefined };
  }

  /**
   * Liste aller Bilanzen eines Mandanten, optional gefiltert auf Jahr.
   */
  async findAll(mandantId: string, user: AuthUser, jahr?: number) {
    this.assertMandantAccess(mandantId, user);
    return this.bilanzRepository.findByMandantAndJahr(mandantId, jahr);
  }

  /**
   * Einzelne Bilanz mit Positionen, mandant-gefiltert.
   */
  async findOne(
    id: string,
    mandantId: string,
    user: AuthUser,
  ): Promise<BilanzEntity> {
    this.assertMandantAccess(mandantId, user);
    const bilanz = await this.bilanzRepository.findWithPositionen(id, mandantId);
    if (!bilanz) {
      throw new NotFoundException('Bilanz nicht gefunden');
    }
    return bilanz;
  }

  /**
   * Aktualisiert eine Bilanz (Positionen werden ersetzt).
   *
   * Audit: previousState wird vor dem Update, newState nach dem Update
   * persistiert (mit vollen Positionen-Listen für GoBD-Compliance).
   */
  async update(
    id: string,
    mandantId: string,
    dto: UpdateBilanzDto,
    user: AuthUser,
    context: BilanzServiceContext,
  ): Promise<BilanzEntity> {
    this.assertMandantAccess(mandantId, user);

    const previous = await this.bilanzRepository.findWithPositionen(id, mandantId);
    if (!previous) {
      throw new NotFoundException('Bilanz nicht gefunden');
    }
    if (previous.status !== 'DRAFT' && dto.positionen !== undefined) {
      throw new BadRequestException(
        'Positionen können nur in DRAFT-Phase geändert werden',
      );
    }

    const updated = await this.bilanzRepository.updateWithPositionen(
      id,
      mandantId,
      {
        hinweise: dto.hinweise ?? undefined,
        status: dto.status ?? undefined,
        updatedById: user.id,
        positionen: dto.positionen?.map((p) => ({
          seite: p.seite,
          kontonummer: p.kontonummer,
          bezeichnung: p.bezeichnung,
          betragVorjahr: p.betragVorjahr ?? null,
          betragAktuell: p.betragAktuell,
          reihenfolge: p.reihenfolge,
          bemerkung: p.bemerkung ?? null,
        })),
      },
    );

    void this.auditService.record({
      userId: user.id,
      mandantId,
      action: 'UPDATE',
      entityType: 'Bilanz',
      entityId: id,
      previousState: this.toAuditDto(previous),
      newState: this.toAuditDto(updated),
      ipAddress: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return updated;
  }

  /**
   * Validiert eine Bilanz (Saldo-Check, Pflichtfelder).
   *
   * Schreibt KEINEN Audit-Log — Validation ist ein Read-Operation.
   */
  async validate(
    id: string,
    mandantId: string,
    user: AuthUser,
  ): Promise<BilanzValidierungDto> {
    this.assertMandantAccess(mandantId, user);
    const bilanz = await this.bilanzRepository.findWithPositionen(id, mandantId);
    if (!bilanz) {
      throw new NotFoundException('Bilanz nicht gefunden');
    }
    return this.computeValidation(bilanz);
  }

  /**
   * Löscht eine Bilanz (nur in DRAFT-Phase erlaubt).
   */
  async delete(
    id: string,
    mandantId: string,
    user: AuthUser,
    context: BilanzServiceContext,
  ): Promise<void> {
    this.assertMandantAccess(mandantId, user);

    const existing = await this.bilanzRepository.findById(id, mandantId);
    if (!existing) {
      throw new NotFoundException('Bilanz nicht gefunden');
    }
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException(
        'Löschung nur in der DRAFT-Phase erlaubt — VALIDATED/ARCHIVED Bilanzen sind unveränderlich.',
      );
    }

    const before = await this.bilanzRepository.findWithPositionen(id, mandantId);
    await this.bilanzRepository.deleteByMandant(id, mandantId);

    void this.auditService.record({
      userId: user.id,
      mandantId,
      action: 'DELETE',
      entityType: 'Bilanz',
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
   * Erzwingt Mandant-Trennung. SYSTEM_ADMIN umgeht die Prüfung.
   */
  private assertMandantAccess(mandantId: string, user: AuthUser): void {
    if (user.globalRole === 'SYSTEM_ADMIN') return;
    const accessibleMandantIds = user.mandanten.map((m) => m.id);
    if (!accessibleMandantIds.includes(mandantId)) {
      throw new ForbiddenException('Kein Zugriff auf diesen Mandanten');
    }
  }

  /**
   * Berechnet Saldo + Pflichtfeld-Check für eine Bilanz.
   */
  private computeValidation(bilanz: BilanzEntity): BilanzValidierungDto {
    let aktivaSumme = 0;
    let passivaSumme = 0;
    let anzahlAktiva = 0;
    let anzahlPassiva = 0;

    for (const pos of bilanz.positionen) {
      const betrag = Number(pos.betragAktuell);
      if (pos.seite === 'AKTIVA') {
        aktivaSumme += betrag;
        anzahlAktiva += 1;
      } else if (pos.seite === 'PASSIVA') {
        passivaSumme += betrag;
        anzahlPassiva += 1;
      }
    }

    const differenz = Math.abs(aktivaSumme - passivaSumme);
    const saldostimmt = differenz < SALDO_TOLERANZ_CENTS;

    // Pflichtfelder-Check: Schlüsselpositionen aus dem HGB-Schema
    // müssen befüllt sein.
    const pflichtIds = ['B_IV', 'PA_I', 'PA_V']; // Bankguthaben, Gezeichnetes Kapital, Jahresergebnis
    const befuellt = new Set(
      bilanz.positionen
        .filter((p) => Number(p.betragAktuell) !== 0)
        .map((p) => p.kontonummer),
    );

    const fehlendePflichtfelder: string[] = [];
    for (const id of pflichtIds) {
      const schema = HGB_BILANZ_SCHEMA.find((s) => s.id === id);
      if (schema && !befuellt.has(schema.kontonummer)) {
        fehlendePflichtfelder.push(`${schema.kontonummer} ${schema.bezeichnung}`);
      }
    }

    return {
      aktivaSumme: Number(aktivaSumme.toFixed(2)),
      passivaSumme: Number(passivaSumme.toFixed(2)),
      differenz: Number(differenz.toFixed(2)),
      saldostimmt,
      fehlendePflichtfelder,
      anzahlAktivaPositionen: anzahlAktiva,
      anzahlPassivaPositionen: anzahlPassiva,
    };
  }

  /**
   * Konvertiert eine Bilanz in einen GoBD-Audit-DTO (JSON-serializable).
   *
   * Decimal-Werte werden zu String konvertiert (keine Float-Artefakte).
   */
  private toAuditDto(bilanz: BilanzEntity): Prisma.JsonValue {
    return {
      id: bilanz.id,
      mandantId: bilanz.mandantId,
      geschaeftsjahr: bilanz.geschaeftsjahr,
      status: bilanz.status,
      hinweise: bilanz.hinweise,
      createdById: bilanz.createdById,
      updatedById: bilanz.updatedById,
      createdAt: bilanz.createdAt,
      updatedAt: bilanz.updatedAt,
      positionen: bilanz.positionen.map((p) => ({
        id: p.id,
        seite: p.seite,
        kontonummer: p.kontonummer,
        bezeichnung: p.bezeichnung,
        betragVorjahr: p.betragVorjahr?.toString() ?? null,
        betragAktuell: p.betragAktuell.toString(),
        reihenfolge: p.reihenfolge,
        bemerkung: p.bemerkung,
      })),
    } as unknown as Prisma.JsonValue;
  }
}