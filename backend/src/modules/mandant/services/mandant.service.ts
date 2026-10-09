import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Mandant } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CacheManagerService } from '../../../common/cache/cache-manager.service';
import { PaginationService } from '../../../common/services/pagination.service';
import { CursorCodec, type PaginatedResult } from '../../../common/dto/pagination.dto';
import { AuditService } from '../../audit/services/audit.service';
import { CreateMandantDto } from '../dto/create-mandant.dto';
import { UpdateMandantDto } from '../dto/update-mandant.dto';
import type { AuthUser } from '../../auth/types/auth-user.types';

export interface MandantContext {
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Mandant-Service.
 *
 * Erzwingt Mandant-Trennung: jeder Lesezugriff prüft, ob der User
 * Zugriff auf den Mandanten hat (entweder über UserMandantRole oder
 * SYSTEM_ADMIN-Berechtigung).
 */
@Injectable()
export class MandantService {
  private readonly logger = new Logger(MandantService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly cache: CacheManagerService,
  ) {}

  /**
   * Erstellt einen neuen Mandanten. Der kanzleiId wird aus dem Auth-User
   * gezogen, nicht aus dem DTO (Mandant-Trennung).
   */
  async create(
    dto: CreateMandantDto,
    user: AuthUser,
    context: MandantContext,
  ): Promise<Mandant> {
    if (user.globalRole !== 'SYSTEM_ADMIN' && user.mandanten.length === 0) {
      throw new ForbiddenException(
        'Keine Berechtigung zum Anlegen eines Mandanten',
      );
    }

    const kanzleiId = await this.resolveKanzleiId(user);

    const mandant = await this.prisma.mandant.create({
      data: {
        kanzleiId,
        firmenname: dto.firmenname,
        rechtsform: dto.rechtsform,
        handelsregister: dto.handelsregister ?? null,
        steuernummer: dto.steuernummer ?? null,
        ustId: dto.ustId ?? null,
        adresse: dto.adresse as unknown as Prisma.InputJsonValue,
        geschaeftsfuehrer: dto.geschaeftsfuehrer as unknown as Prisma.InputJsonValue,
        gruendungsdatum: dto.gruendungsdatum ? new Date(dto.gruendungsdatum) : null,
        bilanzsummeVorjahr: dto.bilanzsummeVorjahr ?? null,
        umsatzVorjahr: dto.umsatzVorjahr ?? null,
        mitarbeiterAnzahl: dto.mitarbeiterAnzahl ?? null,
        groessenklasse: dto.groessenklasse,
        publishChannel: dto.publishChannel,
      },
    });

    void this.auditService.record({
      userId: user.id,
      kanzleiId: mandant.kanzleiId,
      mandantId: mandant.id,
      action: 'CREATE',
      entityType: 'Mandant',
      entityId: mandant.id,
      newState: this.toAuditDto(mandant),
      ipAddress: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    // Cache invalidieren: neue Mandant-Config → alle Cache-Keys pro Mandant entfernen.
    void this.cache.invalidate(`mandant:${mandant.id}`);

    return mandant;
  }

  /**
   * Liste aller Mandanten, auf die der User Zugriff hat.
   *
   * SYSTEM_ADMIN sieht alle Mandanten der Kanzlei (eigentlich sogar
   * kanzlei-übergreifend, aber hier auf die Kanlei des ersten
   * Mandanten beschränkt).
   */
  async findAll(
    user: AuthUser,
    pagination?: {
      cursor?: string;
      pageSize?: number;
      kanzleiId?: string;
    },
  ): Promise<PaginatedResult<Mandant> | Mandant[]> {
    const pageSize = Math.min(pagination?.pageSize ?? 100, 100);
    // Bugfix 2026-10-05: Die Liste zeigte nur Mandanten, die dem User
    // ZUGEWIESEN sind. Ein neu angelegter Mandant gehoert zur Kanzlei, ist
    // aber niemandem zugewiesen — der anlegende KANZLEI_ADMIN sah ihn
    // deshalb in seiner eigenen Liste nicht, obwohl die Oberflaeche
    // "Mandant erstellt" meldete. Anlegen schien wirkungslos.
    //
    // Der Rest des Moduls behandelt KANZLEI_ADMIN als kanzleiweite Rolle
    // (assertKanzleiAdminAccess, branding.service, subscription.service,
    // domain-verification.service, api-key.service). Die Liste war die
    // einzige Stelle mit der engeren Regel — sie wird jetzt angeglichen.
    const istKanzleiAdmin =
      user.globalRole === 'SYSTEM_ADMIN' ||
      user.mandanten.some((m) => m.rolle === 'KANZLEI_ADMIN');
    const kanzleiId = istKanzleiAdmin
      ? await this.resolveKanzleiId(user)
      : null;

    const where: Prisma.MandantWhereInput = istKanzleiAdmin
      ? pagination?.kanzleiId || kanzleiId
        ? { kanzleiId: pagination?.kanzleiId ?? kanzleiId! }
        : {}
      : { id: { in: user.mandanten.map((m) => m.id) } };

    // Backwards-Compat (M3-Regression-Fix): Ohne explizite Pagination liefern
    // wir ein flaches Array — so wie vor dem Cursor-Pagination-Rollout. Der
    // Contract steht auch so im Controller-JSDoc ("Array, Backwards-Compat").
    //
    // Vorher galt diese Ausnahme nur fuer SYSTEM_ADMIN. Dadurch bekamen alle
    // anderen Rollen (GF, Steuerberater, Kanzlei-Admin) auch OHNE pageSize
    // die Huelle { items, total, ... } zurueck und alle Clients, die ein
    // flaches Array erwarten, brachen. Jetzt gilt der Vertrag rollenunabhaengig.
    if (!pagination?.cursor && pagination?.pageSize === undefined) {
      return this.prisma.mandant.findMany({
        where,
        orderBy: [{ firmenname: 'asc' }, { id: 'asc' }],
      });
    }

    const cursorWhere: Prisma.MandantWhereInput = {};
    if (pagination?.cursor) {
      const { sortValue } = CursorCodec.decode(pagination.cursor);
      cursorWhere.OR = [{ firmenname: { lt: sortValue } }];
    }

    const [items, total] = await Promise.all([
      this.prisma.mandant.findMany({
        where: { ...where, ...cursorWhere },
        orderBy: [{ firmenname: 'asc' }, { id: 'asc' }],
        take: pageSize + 1,
      }),
      this.prisma.mandant.count({ where }),
    ]);

    return PaginationService.buildResponse(
      items,
      total,
      pageSize,
      (item) => item.firmenname,
    );
  }

  /**
   * Einzelner Mandant mit Zugriffsprüfung.
   *
   * Cached mit TTL 5min (Mandant-Config ändert sich selten). Cache
   * wird bei UPDATE/DELETE invalidiert.
   */
  async findOne(id: string, user: AuthUser): Promise<Mandant> {
    await this.assertMandantAccess(id, user);
    const mandant = await this.cache.memoize(
      `mandant:${id}`,
      5 * 60_000,
      async () => {
        const found = await this.prisma.mandant.findUnique({ where: { id } });
        return found;
      },
    );
    if (!mandant) throw new NotFoundException('Mandant nicht gefunden');
    return mandant;
  }

  /**
   * Aktualisiert einen Mandanten. Schreibt previousState + newState in den
   * AuditTrail.
   */
  async update(
    id: string,
    dto: UpdateMandantDto,
    user: AuthUser,
    context: MandantContext,
  ): Promise<Mandant> {
    await this.assertMandantAccess(id, user);
    const before = await this.prisma.mandant.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Mandant nicht gefunden');

    const updated = await this.prisma.mandant.update({
      where: { id },
      data: {
        firmenname: dto.firmenname ?? undefined,
        rechtsform: dto.rechtsform ?? undefined,
        handelsregister: dto.handelsregister ?? undefined,
        steuernummer: dto.steuernummer ?? undefined,
        ustId: dto.ustId ?? undefined,
        adresse: dto.adresse as Prisma.InputJsonValue | undefined,
        geschaeftsfuehrer: dto.geschaeftsfuehrer as unknown as Prisma.InputJsonValue | undefined,
        gruendungsdatum: dto.gruendungsdatum ? new Date(dto.gruendungsdatum) : undefined,
        bilanzsummeVorjahr: dto.bilanzsummeVorjahr ?? undefined,
        umsatzVorjahr: dto.umsatzVorjahr ?? undefined,
        mitarbeiterAnzahl: dto.mitarbeiterAnzahl ?? undefined,
        groessenklasse: dto.groessenklasse ?? undefined,
        publishChannel: dto.publishChannel ?? undefined,
      },
    });

    void this.auditService.record({
      userId: user.id,
      kanzleiId: updated.kanzleiId,
      mandantId: updated.id,
      action: 'UPDATE',
      entityType: 'Mandant',
      entityId: updated.id,
      previousState: this.toAuditDto(before),
      newState: this.toAuditDto(updated),
      ipAddress: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    // Cache invalidieren: Mandant-Config hat sich geändert.
    void this.cache.invalidate(`mandant:${updated.id}`);

    return updated;
  }

  /**
   * Löscht einen Mandanten. Nur KANZLEI_ADMIN oder SYSTEM_ADMIN.
   *
   * BEFUND 2026-10-09 — `prisma.mandant.delete()` ist ein HARD DELETE, und
   * das Schema haengt per `onDelete: Cascade` an:
   *
   *   Mandant -> Bilanz   -> BilanzPosition, WPNotiz,
   *                          WPPruefungsAbschluss, BilanzPruefungsResult
   *   Mandant -> GuV      -> GuVPosition
   *   Mandant -> Anhang   -> AnhangAbschnitt
   *   Mandant -> Jahresabschluss -> Signature   (qeS-signierte Dokumente!)
   *   Mandant -> BanzSubmission
   *
   * Ein einziger DELETE eines Mandanten mit Bestand vernichtet damit die
   * vollstaendige Buchhaltungshistorie des Mandanten — einschliesslich
   * signierter Abschluesse. § 147 AO / GoBD verlangen aber zehnjaehrige
   * Aufbewahrung und Unveraenderbarkeit. Vorher war das ein freier
   * Ein-Klick-Durchgang fuer KANZLEI_ADMIN.
   *
   * Zusaetzlich wurden zwei weitere Schaeden gemessen:
   *
   *  1. `AuditLog.mandant` ist eine OPTIONALE Relation ohne `onDelete`,
   *     also `SetNull`. Beim Loeschen werden `mandantId` und
   *     `jahresabschlussId` ALLER Audit-Eintraege dieses Mandanten genullt
   *     — die Nachvollziehbarkeit bleibt zwar als Zeile erhalten, verliert
   *     aber ihren Bezug und verschwindet aus jeder mandant-gefilterten
   *     Sicht.
   *  2. Der Audit-Eintrag fuer das DELETE selbst wird NACH dem Loeschen
   *     geschrieben und referenziert `before.id`. Der Fremdschluessel
   *     verletzt, `record()` schluckt den Fehler, `failedWrites` steigt —
   *     `/health/ready` bleibt dauerhaft `degraded`. Jedes erfolgreiche
   *     Mandant-DELETE produzierte also einen kaputten Audit-Pfad.
   *
   * Der Loeschpfad bleibt fuer Mandanten OHNE Buchhaltungsdaten offen
   * (Neuanlage-Korrektur, Testdaten). Sobald aufbewahrungsrelevante Daten
   * existieren, ist er gesperrt.
   *
   * OFFENE PRODUKTFRAGE (Fachfreigabe noetig, hier bewusst NICHT erfunden):
   * was mit einem Mandanten passiert, der weg muss, aber Aufbewahrung hat.
   * Serienreif sind dsfaer nur: (a) Archivieren statt Loeschen,
   * (b) Pseudonymisieren, (c) Aufbewahrung nach Ablauf beenden. Keine
   * dieser drei ist hier implementiert, weil jede eine Rechts-/
   * Fachentscheidung ist.
   */
  async delete(id: string, user: AuthUser, context: MandantContext): Promise<void> {
    await this.assertMandantAccess(id, user);
    if (user.globalRole !== 'SYSTEM_ADMIN') {
      const isKanzleiAdmin = user.mandanten.some((m) => m.rolle === 'KANZLEI_ADMIN');
      if (!isKanzleiAdmin) {
        throw new ForbiddenException('Nur KANZLEI_ADMIN darf Mandanten löschen');
      }
    }
    const before = await this.prisma.mandant.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Mandant nicht gefunden');

    await this.prisma.$transaction(async (tx) => {
      // Zaehlen und loeschen teilen sich eine Transaktion, damit die fuenf
      // Bestandsabfragen und das DELETE nicht auseinanderlaufen.
      //
      // ISOLATION — Serializable wurde hier ausprobiert und wieder verworfen.
      // Postgres SSI bricht genau dieses Muster (count + DELETE) mit P2034
      // ab: live gemessen lieferte das Loeschen eines LEEREN Mandanten
      // HTTP 500 "write conflict or a deadlock" — der Sperrpfad wurde
      // dadurch unbenutzbar.
      //
      // Und es haette das Problem auch nicht geloest: SSI garantiert eine
      // serielle Reihenfolge, aber in dieser Reihenfolge darf der konkurrierende
      // Insert legitim NACH dem Delete liegen — dann greift das Cascade
      // trotzdem. Kosten ohne Nutzen.
      //
      // RESTRISIKO, bewusst so gelassen: ein Abschluss, der exakt zwischen
      // Zaehlen und DELETE entsteht, rutscht durch das Cascade. Das
      // erfordert zwei gleichzeitige Admin-Aktionen auf denselben Mandanten
      // und ist damit ein Fenster von Millisekunden — gegenueber dem
      // vorherigen Verhalten ("immer alles vernichtet") ist das der
      // Unterschied zwischen einem Fehler und einer Katastrophe. Wer es
      // ganz schliessen will, braucht eine DB-Seitige Sperre (Trigger), und
      // nicht noch eine Isolationsstufe.
      const [jahresabschluesse, bilanzen, guvs, anhaenge, submissions] = await Promise.all([
        tx.jahresabschluss.count({ where: { mandantId: id } }),
        tx.bilanz.count({ where: { mandantId: id } }),
        tx.guV.count({ where: { mandantId: id } }),
        tx.anhang.count({ where: { mandantId: id } }),
        tx.banzSubmission.count({ where: { mandantId: id } }),
      ]);

      const vorhanden: string[] = [];
      if (jahresabschluesse > 0) vorhanden.push(`${jahresabschluesse} Jahresabschluss/-abschlüsse`);
      if (bilanzen > 0) vorhanden.push(`${bilanzen} Bilanz(en)`);
      if (guvs > 0) vorhanden.push(`${guvs} GuV(s)`);
      if (anhaenge > 0) vorhanden.push(`${anhaenge} Anhang/Anhänge`);
      if (submissions > 0) vorhanden.push(`${submissions} Bundesanzeiger-Einreichung(en)`);

      if (vorhanden.length > 0) {
        throw new ConflictException(
          `Mandant kann nicht gelöscht werden: ${vorhanden.join(', ')} vorhanden. ` +
            'Buchhaltungsunterlagen sind nach § 147 AO zehn Jahre aufzubewahren und ' +
            'unveränderbar; ein Löschen würde Bilanzen, Abschlüsse und qeS-Signaturen ' +
            'samt Nachvollziehbarkeit vernichten.',
        );
      }

      await tx.mandant.delete({ where: { id } });
    });

    // `mandantId` waere hier ein Fremdschluessel auf eine gerade geloeschte
    // Zeile — der Eintrag wuerfe scheitern und still verschwinden. Der
    // Mandantbezug steckt stattdessen in `entityId`; `kanzleiId` haelt die
    // Kanzleizugehoerigkeit, damit der Eintrag mandant-gefiltert auffindbar
    // bleibt.
    void this.auditService.record({
      userId: user.id,
      kanzleiId: before.kanzleiId,
      mandantId: null,
      action: 'DELETE',
      entityType: 'Mandant',
      entityId: before.id,
      previousState: this.toAuditDto(before),
      ipAddress: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    // Cache invalidieren.
    void this.cache.invalidate(`mandant:${before.id}`);
  }

  /**
   * Archiviert einen Mandanten: ab sofort keine neuen Belege, Bestand
   * bleibt les- und nachvollziehbar.
   *
   * PRODUKTENTSCHEIDUNG 2026-10-09 („Archivieren statt Löschen"). Der
   * Löschpfad ist für Mandanten mit Aufbewahrung gesperrt; die Archivierung
   * ist der sanctioned Weg, einen Mandanten aus dem aktiven Bestand zu
   * nehmen, ohne § 147 AO zu umgehen.
   *
   * Zwei getrennte Audit-Eintraege mit vorher/nachher, weil ein einziger
   * Eintrag mit `previousState` und `newState` zwar auch ginge — aber die
   * Storno-Wirkung (Archivierung zurückgenommen) soll im Trail als eigene
   * Handlung lesbar sein, nicht als nachtraegliche Korrektur.
   */
  async archivieren(
    id: string,
    user: AuthUser,
    context: MandantContext,
  ): Promise<Mandant> {
    await this.assertMandantAccess(id, user);
    this.assertKanzleiAdmin(user);

    const before = await this.prisma.mandant.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Mandant nicht gefunden');
    if (before.archiviertAt) {
      throw new ConflictException(
        `Mandant ist bereits archiviert (seit ${before.archiviertAt.toISOString()}).`,
      );
    }

    const now = new Date();
    const updated = await this.prisma.mandant.update({
      where: { id },
      data: { archiviertAt: now, archiviertVonId: user.id },
    });

    void this.auditService.record({
      userId: user.id,
      kanzleiId: updated.kanzleiId,
      mandantId: updated.id,
      action: 'UPDATE',
      entityType: 'Mandant',
      entityId: updated.id,
      previousState: this.toAuditDto(before),
      newState: { ...(this.toAuditDto(updated) as object), archiviert: true },
      ipAddress: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    void this.cache.invalidate(`mandant:${id}`);
    return updated;
  }

  /**
   * Nimmt die Archivierung zurueck. Nennt den aufhebenden User im Audit —
   * ein Archiv ist eine Handlung mit Verantwortungsbezug, ihre Ruecknahme
   * ebenso.
   */
  async archivierungAufheben(
    id: string,
    user: AuthUser,
    context: MandantContext,
  ): Promise<Mandant> {
    await this.assertMandantAccess(id, user);
    this.assertKanzleiAdmin(user);

    const before = await this.prisma.mandant.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Mandant nicht gefunden');
    if (!before.archiviertAt) {
      throw new ConflictException('Mandant ist nicht archiviert — nichts aufzuheben.');
    }

    const updated = await this.prisma.mandant.update({
      where: { id },
      data: { archiviertAt: null, archiviertVonId: null },
    });

    void this.auditService.record({
      userId: user.id,
      kanzleiId: updated.kanzleiId,
      mandantId: updated.id,
      action: 'UPDATE',
      entityType: 'Mandant',
      entityId: updated.id,
      previousState: { ...(this.toAuditDto(before) as object), archiviert: true },
      newState: { ...(this.toAuditDto(updated) as object), archiviert: false },
      ipAddress: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    void this.cache.invalidate(`mandant:${id}`);
    return updated;
  }

  /** KANZLEI_ADMIN oder SYSTEM_ADMIN — wie beim Loeschen. */
  private assertKanzleiAdmin(user: AuthUser): void {
    if (user.globalRole === 'SYSTEM_ADMIN') return;
    if (user.mandanten.some((m) => m.rolle === 'KANZLEI_ADMIN')) return;
    throw new ForbiddenException(
      'Nur KANZLEI_ADMIN darf einen Mandanten archivieren oder die Archivierung aufheben',
    );
  }

  /**
   * Hilfsfunktion: Liste der zugänglichen Mandanten-IDs (für Filter).
   */
  async getMandantenAccessibleByUser(userId: string): Promise<
    Array<{ id: string; firmenname: string }>
  > {
    const roles = await this.prisma.userMandantRole.findMany({
      where: { userId, revokedAt: null },
      include: { mandant: { select: { id: true, firmenname: true } } },
    });
    return roles.map((r) => ({
      id: r.mandant.id,
      firmenname: r.mandant.firmenname,
    }));
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  /**
   * Zugriff auf einen Mandanten.
   *
   * Bugfix 2026-10-05: Die Pruefung kannte nur Mandanten, die dem User
   * ZUGEWIESEN sind. Ein frisch angelegter Mandant ist aber niemandem
   * zugewiesen — der anlegende KANZLEI_ADMIN konnte ihn deshalb nicht
   * einmal loeschen ("Kein Zugriff auf diesen Mandanten"), obwohl er ihn
   * gerade erst erstellt hatte.
   *
   * KANZLEI_ADMIN verwaltet die Mandanten SEINER Kanzlei. Das ist die
   * rollenweite Konvention des gesamten Moduls (branding.service,
   * subscription.service, domain-verification.service, api-key.service) und
   * gilt hier jetzt ebenfalls — mit einer DB-Pruefung, damit ein
   * KANZLEI_ADMIN einer fremden Kanzlei weiterhin abgewiesen wird.
   */
  private async assertMandantAccess(
    mandantId: string,
    user: AuthUser,
  ): Promise<void> {
    if (user.globalRole === 'SYSTEM_ADMIN') return;
    const accessibleMandantIds = user.mandanten.map((m) => m.id);
    if (accessibleMandantIds.includes(mandantId)) return;

    const istKanzleiAdmin = user.mandanten.some(
      (m) => m.rolle === 'KANZLEI_ADMIN',
    );
    if (!istKanzleiAdmin) {
      throw new ForbiddenException('Kein Zugriff auf diesen Mandanten');
    }

    // Mandant muss in derselben Kanzlei liegen wie die des Users.
    const mandant = await this.prisma.mandant.findUnique({
      where: { id: mandantId },
      select: { kanzleiId: true },
    });
    if (!mandant) throw new NotFoundException('Mandant nicht gefunden');
    const kanzleiId = await this.resolveKanzleiId(user);
    if (mandant.kanzleiId !== kanzleiId) {
      throw new ForbiddenException('Kein Zugriff auf diesen Mandanten');
    }
  }

  private async resolveKanzleiId(user: AuthUser): Promise<string> {
    // SYSTEM_ADMIN darf jede Kanzlei adressieren — Fallback auf erste
    // bestehende Kanzlei (Demo-Modus).
    if (user.globalRole === 'SYSTEM_ADMIN') {
      const firstKanzlei = await this.prisma.kanzlei.findFirst({
        select: { id: true },
      });
      if (firstKanzlei) return firstKanzlei.id;
      throw new NotFoundException('Keine Kanzlei vorhanden — Demo-Daten anlegen');
    }
    // Non-Admin: kanzleiId kommt implizit aus dem ersten zugänglichen
    // Mandanten — Mandanten gehören zu genau 1 Kanzlei.
    const firstAccessibleMandantId = user.mandanten[0]?.id;
    if (!firstAccessibleMandantId) {
      throw new ForbiddenException('Kein zugänglicher Mandant vorhanden');
    }
    const mandant = await this.prisma.mandant.findUnique({
      where: { id: firstAccessibleMandantId },
      select: { kanzleiId: true },
    });
    if (!mandant) throw new NotFoundException('Mandant nicht gefunden');
    return mandant.kanzleiId;
  }

  private toAuditDto(m: Mandant): Prisma.JsonValue {
    const dto = {
      id: m.id,
      kanzleiId: m.kanzleiId,
      firmenname: m.firmenname,
      rechtsform: m.rechtsform,
      handelsregister: m.handelsregister,
      steuernummer: m.steuernummer,
      ustId: m.ustId,
      adresse: m.adresse,
      geschaeftsfuehrer: m.geschaeftsfuehrer,
      gruendungsdatum: m.gruendungsdatum,
      bilanzsummeVorjahr: m.bilanzsummeVorjahr?.toString() ?? null,
      umsatzVorjahr: m.umsatzVorjahr?.toString() ?? null,
      mitarbeiterAnzahl: m.mitarbeiterAnzahl,
      groessenklasse: m.groessenklasse,
      publishChannel: m.publishChannel,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
    };
    return dto as unknown as Prisma.JsonValue;
  }
}
