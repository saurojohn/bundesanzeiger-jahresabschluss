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
import { MANDANTEN_SORTIERUNG } from '../../../common/utils/mandanten-sortierung';
import { PaginationService } from '../../../common/services/pagination.service';
// `CursorCodec` wird hier nicht mehr direkt benutzt — die Cursor-Auswertung
// laeuft ueber `PaginationService.cursorCondition`. `PaginatedResult` schon.
import type { PaginatedResult } from '../../../common/dto/pagination.dto';
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
    mandantId: string,
    user: AuthUser,
    context: MandantContext,
  ): Promise<Mandant> {
    if (user.globalRole !== 'SYSTEM_ADMIN' && user.mandanten.length === 0) {
      throw new ForbiddenException(
        'Keine Berechtigung zum Anlegen eines Mandanten',
      );
    }

    //
    // BEFUND 2026-10-20 (Nachtrag 68): Der neue Mandant gehoert in die
    // Kanzlei des **aktiven** Mandanten — dort hat der `RolesGuard` die
    // Admin-Rolle geprueft.
    //
    // Vorher stand hier `resolveKanzleiId(user)`: die Kanzlei des **ersten**
    // Mandanten des Users (Session-Sortierung: Firmenname). Die beiden
    // koennen verschiedene Kanzleien sein.
    //
    // **Gemessen:** ein KANZLEI_ADMIN der Kanzlei A (aktiver Mandant dort)
    // mit zusaetzlich einem Mandant „Aaa GmbH" in der Kanzlei B (dort
    // STEUERBERATER) legte seinen neuen Mandanten in der **Kanzlei B** an —
    // in der er **kein** Admin ist. Folge: der neue Mandant war fuer den
    // Anleger **unsichtbar** (er steht in keiner Kanzlei, in der der
    // Anleger Admin ist, und ist niemandem zugewiesen). „Anlegen schien
    // wirkungslos" — dieselbe Beschwerde wie in Nachtrag 28, nur in einer
    // anderen Form.
    const kontextMandant = await this.prisma.mandant.findUnique({
      where: { id: mandantId },
      select: { kanzleiId: true },
    });
    if (!kontextMandant) {
      throw new NotFoundException('Mandant nicht gefunden');
    }
    const kanzleiId = kontextMandant.kanzleiId;

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

    await this.auditService.record({
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
   * Die Rollenbindung des Users: in welchen Kanzleien ist er
   * KANZLEI_ADMIN, und welche Mandanten sind seine eigenen.
   *
   * BEFUND 2026-10-20 (Nachtrag 68): Die Liste benutzte zwei Angaben, die
   * auseinanderlaufen koennen:
   *
   *     istKanzleiAdmin  = "Admin IRGENDWO"  (irgendein Mandant hat die Rolle)
   *     eigeneKanzleiId  = Kanzlei des ERSTEN Mandanten (Sortierung: Firma)
   *
   * Ist der erste Mandant in der Kanzlei, in der der User **kein** Admin
   * ist, sah er **alle** Mandanten dieser Kanzlei. Das ist der
   * Nachtrag-11-Defekt an der fuenften Stelle — Mandantentrennungs-Bruch
   * (§ 146 AO): Firmenname, USt-Id und Adresse fremder Mandanten.
   *
   * **Gemessen:** ein KANZLEI_ADMIN der Kanzlei A mit einem Mandant
   * „Aaa GmbH" in der Kanzlei B (dort STEUERBERATER) sieht in der Liste
   * **„Bravo GmbH"** — einen Mandanten der Kanzlei B, in dem er **keine
   * Rolle** hat. Und die Mandanten der Kanzlei A, in der er Admin **ist**,
   * fehlen in der Liste.
   *
   * Diese Methode bindet die Rolle an die Kanzlei — genau wie
   * `common/utils/kanzlei-rolle.ts` es fuer Webhooks, Abos, API-Schluessel
   * und DNS tut. Es gibt jetzt **eine** Stelle fuer diese Bindung.
   */
  private async rollenBindung(user: AuthUser): Promise<{
    /** Kanzleien, in denen der User KANZLEI_ADMIN ist. */
    adminKanzleiIds: string[];
    /** Alle Kanzleien, in denen der User einen Mandanten hat. */
    eigeneKanzleiIds: string[];
    /** Die Mandanten des Users. */
    eigeneMandantIds: string[];
  }> {
    const eigeneMandantIds = user.mandanten.map((m) => m.id);
    if (eigeneMandantIds.length === 0) {
      return { adminKanzleiIds: [], eigeneKanzleiIds: [], eigeneMandantIds: [] };
    }

    // BEFUND 2026-10-21 (Nachtrag 76): **Alle** Rollen eines Mandanten
    // sammeln, nicht nur eine.
    //
    // `UserMandantRole` hat `@@unique([userId, mandantId, rolle])` — ein User
    // kann also **mehrere** Rollen auf demselben Mandanten haben. Der
    // vorherige Code baute eine Map `mandantId -> rolle`; bei mehreren
    // Rollen ueberschrieb der letzte Eintrag die anderen. Wer auf einem
    // Mandanten KANZLEI_ADMIN **und** STEUERBERATER hat (eine ganz normale
    // Kanzlei-Konstellation), galt damit als „kein Admin":
    //
    //     PATCH /api/mandant/<id>/archivierung
    //     -> 403 "Nur KANZLEI_ADMIN dieser Kanzlei darf den Mandanten verwalten"
    //
    // Das ist genau der Fehler, den der `RolesGuard` seit Nachtrag 40
    // **nicht** mehr macht (dort: "ALLE Eintraege sammeln, nicht den ersten
    // nehmen"). Dieselbe Regel gehoert in beide Stellen.
    const rollenJeMandant = new Map<string, string[]>();
    for (const m of user.mandanten) {
      const rollen = Array.isArray(m.rolle) ? m.rolle : [m.rolle];
      const vorhanden = rollenJeMandant.get(m.id) ?? [];
      rollenJeMandant.set(m.id, [...vorhanden, ...rollen]);
    }

    const mandanten = await this.prisma.mandant.findMany({
      where: { id: { in: eigeneMandantIds } },
      select: { id: true, kanzleiId: true },
    });

    const adminKanzleiIds = new Set<string>();
    const eigeneKanzleiIds = new Set<string>();
    for (const mandant of mandanten) {
      eigeneKanzleiIds.add(mandant.kanzleiId);
      if ((rollenJeMandant.get(mandant.id) ?? []).includes('KANZLEI_ADMIN')) {
        adminKanzleiIds.add(mandant.kanzleiId);
      }
    }

    return {
      adminKanzleiIds: [...adminKanzleiIds],
      eigeneKanzleiIds: [...eigeneKanzleiIds],
      eigeneMandantIds,
    };
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
    // (branding.service, subscription.service, domain-verification.service,
    // api-key.service). Die Liste war die einzige Stelle mit der engeren
    // Regel — sie wird jetzt angeglichen. Und: „kanzleiweit" heisst seit
    // Nachtrag 71/70 **Admin in dieser Kanzlei**, nicht „Admin irgendwo".
    const istSystemAdmin = user.globalRole === 'SYSTEM_ADMIN';
    //
    // BEFUND 2026-10-20 (Nachtrag 68): „Admin IRGENDWO" und „Kanzlei des
    // ersten Mandanten" sind zwei verschiedene Fragen — und die alte
    // Verknuepfung beider ergab einen Mandantentrennungs-Bruch. Jetzt
    // kommt die Bindung aus `rollenBindung()`: die Kanzleien, in denen der
    // User **Admin ist**, und seine eigenen Mandanten.
    const { adminKanzleiIds, eigeneKanzleiIds, eigeneMandantIds } =
      await this.rollenBindung(user);
    // `resolveKanzleiId` WIRFT, wenn nichts auflösbar ist — es liefert nie
    // leer. Damit ist der alte `{}`-Zweig (kein Filter = alle Mandanten
    // aller Kanzleien) nicht erreichbar und wird hier entfernt: er war
    // eine latente Falle, keine Absicht.
    const eigeneKanzleiId = istSystemAdmin ? await this.resolveKanzleiId(user) : null;

    // BEFUND 2026-10-11: `pagination.kanzleiId` stammt aus dem Query-String
    // und ÜBERSCHrieb zuvor den aufgelösten Wert. Live gemessen:
    //
    //   GET /api/mandant                     -> 3 Mandanten (eigene Kanzlei)
    //   GET /api/mandant?kanzleiId=<fremd>   -> "Fremd-Mandant GmbH"
    //
    // Ein KANZLEI_ADMIN konnte damit die Mandantenliste einer fremden
    // Kanzlei abrufen — Firmenname, USt-Id, Adresse. Das ist ein
    // Mandantentrennungs-Bruch (§ 146 AO), ausgeloest durch genau die
    // "pragmatische" Rollenbehandlung von 2026-10-05.
    //
    // SYSTEM_ADMIN darf weiterhin kanzleiübergreifend filtern (Pilot-
    // Annahme). Für KANZLEI_ADMIN ist die eigene Kanzlei gesetzt — und ein
    // abweichender Widerspruch wird abgelehnt statt still ignoriert: ein
    // stilles Ignorieren laesst den Aufrufer glauben, er habe die fremde
    // Kanzlei gesehen.
    //
    // BEFUND 2026-10-20 (Nachtrag 68): Ein `kanzleiId` aus dem
    // Query-String darf nur eine Kanzlei treffen, in der der User Admin
    // ist **oder** selbst einen Mandanten hat. Sonst waere es wieder der
    // Fremdzugriff vom 2026-10-11 — nur mit einem anderen Weg.
    if (
      !istSystemAdmin &&
      pagination?.kanzleiId &&
      !adminKanzleiIds.includes(pagination.kanzleiId) &&
      !eigeneKanzleiIds.includes(pagination.kanzleiId)
    ) {
      throw new ForbiddenException(
        'Die angeforderte Kanzlei gehört nicht zu Ihren Mandanten.',
      );
    }

    //
    // **Die Sichtbarkeit.** Der User sieht:
    //   1. alle Mandanten der Kanzleien, in denen er KANZLEI_ADMIN ist,
    //   2. seine eigenen Mandanten — in jeder Kanzlei, mit jeder Rolle.
    //
    // Punkt 2 ist wichtig: ein User mit einem Mandant in einer zweiten
    // Kanzlei sieht diesen sonst gar nicht — seine eigene Mandantenliste
    // waere unvollstaendig.
    const sichtbar: Prisma.MandantWhereInput =
      adminKanzleiIds.length === 0
        ? { id: { in: eigeneMandantIds } }
        : {
            OR: [
              { kanzleiId: { in: adminKanzleiIds } },
              { id: { in: eigeneMandantIds } },
            ],
          };

    const where: Prisma.MandantWhereInput = istSystemAdmin
      ? { kanzleiId: pagination?.kanzleiId ?? eigeneKanzleiId! }
      : pagination?.kanzleiId
        ? { AND: [sichtbar, { kanzleiId: pagination.kanzleiId }] }
        : sichtbar;

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
    // Siehe `PaginationService.cursorCondition`: `firmenname` ist nicht
    // eindeutig, deshalb braucht es hier den `id`-Tiebreaker genauso wie
    // bei den Zeitstempeln in den anderen Listen.
    const cond = PaginationService.cursorCondition(
      pagination?.cursor,
      'firmenname',
      'asc',
      'asc',
    );
    if (cond) {
      cursorWhere.OR = cond as Prisma.MandantWhereInput['OR'];
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

    await this.auditService.record({
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
   * Löscht einen Mandanten. Nur KANZLEI_ADMIN der **Kanzlei des Mandanten**
   * oder SYSTEM_ADMIN.
   *
   * BEFUND 2026-10-21 (Nachtrag 71): Vorher genuegte „Admin IRGENDWO" —
   * ein STEUERBERATER konnte einen eigenen Mandanten loeschen, weil er in
   * einer anderen Kanzlei Admin ist. Siehe
   * `assertKanzleiAdminFuerMandant()`.
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
    // BEFUND 2026-10-21 (Nachtrag 71): „Admin IRGENDWO" war hier eine
    // Rolleneskalation — ein STEUERBERATER konnte einen eigenen Mandanten
    // loeschen, weil er in einer anderen Kanzlei Admin ist. Jetzt zaehlt
    // nur die Admin-Rolle in der **Kanzlei des Ziel-Mandanten**.
    await this.assertKanzleiAdminFuerMandant(id, user);
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
    await this.auditService.record({
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
    // BEFUND 2026-10-21 (Nachtrag 71): siehe `assertKanzleiAdminFuerMandant`.
    await this.assertKanzleiAdminFuerMandant(id, user);

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

    await this.auditService.record({
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
    // BEFUND 2026-10-21 (Nachtrag 71): siehe `assertKanzleiAdminFuerMandant`.
    await this.assertKanzleiAdminFuerMandant(id, user);

    const before = await this.prisma.mandant.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Mandant nicht gefunden');
    if (!before.archiviertAt) {
      throw new ConflictException('Mandant ist nicht archiviert — nichts aufzuheben.');
    }

    const updated = await this.prisma.mandant.update({
      where: { id },
      data: { archiviertAt: null, archiviertVonId: null },
    });

    await this.auditService.record({
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

  /**
   * KANZLEI_ADMIN **dieser Kanzlei** — nicht "Admin irgendwo".
   *
   * BEFUND 2026-10-21 (Nachtrag 71): `delete()` und `archivieren()` prueften
   * nach dem Zugriff nur noch „hat der User irgendwo KANZLEI_ADMIN?". Der
   * Zugriffstest `assertMandantAccess()` laesst aber **eigene** Mandanten
   * zu — mit jeder Rolle. Die Kombination war eine Rolleneskalation:
   *
   * **Gemessen.** Ein User, der in der Kanzlei B STEUERBERATER ist (eigener
   * Mandant „Aaa GmbH") und in der Kanzlei A KANZLEI_ADMIN:
   *
   *     DELETE /api/mandant/<Aaa>  -> HTTP 204, der Mandant ist GELOESCHT
   *
   * Ein Loeschen ist eine KANZLEI_ADMIN-Aktion (§ 147 AO: Loeschpfad nur
   * fuer Mandanten ohne Aufbewahrung). Hier hat sie ein STEUERBERATER
   * ausgefuehrt — auf einem Mandanten, an dem er nur Berater ist.
   *
   * Der Kontext-Header war dabei nicht der Ausloeser: der `RolesGuard`
   * laesst den User durch, wenn er die Rolle auf dem **Kontext-Mandanten**
   * hat. Mit dem Kontext auf einen eigenen Admin-Mandanten ist diese
   * Bedingung erfuellt, geprueft wurde aber der **Ziel**-Mandant.
   *
   * Die Regel jetzt: loeschen und archivieren darf nur, wer KANZLEI_ADMIN
   * in der **Kanzlei des Ziel-Mandanten** ist. Das ist dieselbe Bindung
   * wie beim Branding (Nachtrag 71) und wie bei Subscription, API-Keys,
   * Webhooks und Custom-Domain.
   */
  private async assertKanzleiAdminFuerMandant(
    mandantId: string,
    user: AuthUser,
  ): Promise<void> {
    if (user.globalRole === 'SYSTEM_ADMIN') return;
    const { adminKanzleiIds } = await this.rollenBindung(user);
    if (adminKanzleiIds.length === 0) {
      throw new ForbiddenException(
        'Nur KANZLEI_ADMIN dieser Kanzlei darf den Mandanten verwalten',
      );
    }
    const mandant = await this.prisma.mandant.findUnique({
      where: { id: mandantId },
      select: { kanzleiId: true },
    });
    if (!mandant) throw new NotFoundException('Mandant nicht gefunden');
    if (!adminKanzleiIds.includes(mandant.kanzleiId)) {
      throw new ForbiddenException(
        'Nur KANZLEI_ADMIN dieser Kanzlei darf den Mandanten verwalten',
      );
    }
  }

  /**
   * Hilfsfunktion: Liste der zugänglichen Mandanten-IDs (für Filter).
   */
  async getMandantenAccessibleByUser(userId: string): Promise<
    Array<{ id: string; firmenname: string }>
  > {
    const roles = await this.prisma.userMandantRole.findMany({
      where: { userId, revokedAt: null },
      orderBy: MANDANTEN_SORTIERUNG,
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
   * KANZLEI_ADMIN verwaltet die Mandanten der Kanzlei, in der er
   * KANZLEI_ADMIN ist. Das ist die rollenweite Konvention des gesamten
   * Moduls (branding.service, subscription.service, domain-verification.service,
   * api-key.service) und gilt hier jetzt ebenfalls — mit einer DB-Pruefung,
   * damit ein KANZLEI_ADMIN einer fremden Kanzlei weiterhin abgewiesen wird.
   *
   * BEFUND 2026-10-21 (Nachtrag 70): „seiner Kanzlei" war bisher ueber
   * `resolveKanzleiId(user)` bestimmt — die Kanzlei des **ersten** Mandanten.
   * Das ist die Kanzlei des Users, **nicht** die Kanzlei, in der er Admin
   * ist. Siehe die ausfuehrliche Begruendung im Koerper der Methode.
   */
  private async assertMandantAccess(
    mandantId: string,
    user: AuthUser,
  ): Promise<void> {
    if (user.globalRole === 'SYSTEM_ADMIN') return;
    const accessibleMandantIds = user.mandanten.map((m) => m.id);
    if (accessibleMandantIds.includes(mandantId)) return;

    //
    // BEFUND 2026-10-21 (Nachtrag 70): Der KANZLEI_ADMIN-Zweig verglich die
    // Kanzlei des Ziel-Mandanten mit `resolveKanzleiId(user)` — der Kanzlei
    // des **ersten** Mandanten des Users (Sortierung: Firmenname). Das ist
    // dieselbe lose Logik wie in der Liste (Nachtrag 68), nur an der
    // Schreibstelle: „Admin IRGENDWO" (irgendein Mandant hat die Rolle) und
    // „Kanzlei des ersten Mandanten" wurden verknuepft, ohne dass die Rolle
    // an **diese** Kanzlei gebunden war.
    //
    // **Gemessen.** Ein KANZLEI_ADMIN der Kanzlei A mit zusaetzlich einem
    // Mandant „Aaa GmbH" in der Kanzlei B (dort STEUERBERATER, also
    // KEIN Admin) — und ein weiterer Mandant „Bravo GmbH" in Kanzlei B, in
    // dem der User **keine Rolle** hat. „Aaa GmbH" sortiert vor
    // „Beispiel GmbH" (Kanzlei A) und ist damit der erste Mandant:
    //
    //   GET   /api/mandant/<Bravo>            -> 200  (Firmenname, USt-Id, Adresse)
    //   PATCH /api/mandant/<Bravo>            -> 200  (umbenannt!)
    //   PATCH /api/mandant/<Bravo>/archivierung -> 200 (archiviert!)
    //
    // Der Kontext-Header `x-mandant-id` zeigte dabei auf **das Zielmandant
    // selbst**. Das ist kein Randfall: der `RolesGuard` laesst einen User
    // durch, wenn er die Rolle irgendwo hat und der Kontext-Mandant ihm
    // nicht zugewiesen ist („der MandantGuard entscheidet") — auf diesen
    // Routen gibt es aber **keinen** `MandantGuard`. Die Service-Pruefung
    // war damit die einzige Schranke, und sie stand auf der falschen
    // Grundlage.
    //
    // **Die Regel jetzt:** ein KANZLEI_ADMIN darf die Mandanten der
    // Kanzleien verwalten, in denen er KANZLEI_ADMIN ist — plus seine
    // eigenen Mandanten. Dieselbe Bindung wie in der Liste
    // (`rollenBindung()`), damit Liste und Schreibpfad dasselbe sagen.
    const { adminKanzleiIds } = await this.rollenBindung(user);
    if (adminKanzleiIds.length === 0) {
      throw new ForbiddenException('Kein Zugriff auf diesen Mandanten');
    }

    const mandant = await this.prisma.mandant.findUnique({
      where: { id: mandantId },
      select: { kanzleiId: true },
    });
    if (!mandant) throw new NotFoundException('Mandant nicht gefunden');
    if (!adminKanzleiIds.includes(mandant.kanzleiId)) {
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
