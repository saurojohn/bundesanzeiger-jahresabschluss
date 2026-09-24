import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { KonsolidierungRepository } from '../../../common/repositories/konsolidierung.repository';
import type {
  KonsolidierungsEinheitEntity,
  KonsolidierungsBuchungEntity,
} from '../../../common/repositories/konsolidierung.repository';
import { BilanzRepository } from '../../../common/repositories/bilanz.repository';
import { GuVRepository } from '../../../common/repositories/guv.repository';
import type { GuVKategorieLiteral } from '../../../common/repositories/guv.repository';
import { AuditService } from '../../audit/services/audit.service';
import type { AuthUser } from '../../auth/types/auth-user.types';
import {
  KONSOLIDIERUNGS_BUCHUNGSARTEN,
} from '../constants/konsolidierung.constants';
import type {
  KonsolidierungsBuchungInput,
} from '../../../common/repositories/konsolidierung.repository';
import { CreateKonsolidierungEinheitDto } from '../dto/create-konsolidierung-einheit.dto';
import type {
  ApplyKonsolidierungResponseDto,
  KonsolidierungEinheitDto,
  KonsolidierungsBuchungDto,
  KonzernSaldenDto,
} from '../dto/konsolidierung-response.dto';

export interface KonsolidierungServiceContext {
  ip?: string | null;
  userAgent?: string | null;
}

/** Toleranz für Saldovergleich Konzern-Bilanz (1 Cent). */
const SALDO_TOLERANZ_CENTS = 1;
void SALDO_TOLERANZ_CENTS;

/**
 * Service für Konzern-Konsolidierung (PublG §11, HGB §§ 301–306).
 *
 * Lifecycle einer Konsolidierungs-Einheit:
 *   1. createEinheit          — DRAFT
 *   2. calculateBuchungen     — IN_PROGRESS (Buchungen generiert)
 *   3. applyKonsolidierung    — COMPLETED (Konzern-Bilanz + GuV erzeugt)
 *   4. finalizeEinheit        — VALIDATED (WP-Freigabe)
 *
 * Pilot-Scope: 1 Mutter + 1 Tochter (keine komplexen Topologien).
 *
 * Mandant-Trennung: alle beteiligten Mandanten (Mutter + Tochtern)
 * müssen zur selben Kanzlei gehören — Service prüft das explizit.
 */
@Injectable()
export class KonsolidierungService {
  private readonly logger = new Logger(KonsolidierungService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly konsolidierungRepository: KonsolidierungRepository,
    private readonly bilanzRepository: BilanzRepository,
    private readonly guvRepository: GuVRepository,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Erstellt eine neue Konsolidierungs-Einheit (DRAFT-Status).
   *
   * Validierung:
   *   - mutterMandantId und alle tochterMandantIds sind zugänglich
   *   - alle Mandanten gehören zur selben Kanzlei (Mandant-Trennung)
   *   - beteiligungsquote: 0–100 (DTO prüft, hier redundant abgesichert)
   *   - geschaeftsjahr: sinnvoll (DTO prüft)
   */
  async createEinheit(
    dto: CreateKonsolidierungEinheitDto,
    user: AuthUser,
    context: KonsolidierungServiceContext,
  ): Promise<KonsolidierungEinheitDto> {
    this.assertKanzleiAccessForMandanten(
      [dto.mutterMandantId, ...dto.tochterMandantIds],
      user,
    );

    // Kanzlei des Mutter-Mandanten ermitteln.
    const mutterMandant = await this.prisma.mandant.findUnique({
      where: { id: dto.mutterMandantId },
      select: { id: true, kanzleiId: true },
    });
    if (!mutterMandant) {
      throw new NotFoundException('Mutter-Mandant nicht gefunden');
    }

    // Prüfe: alle Tochtermandanten existieren und sind in derselben Kanzlei.
    const tochtermandanten = await this.prisma.mandant.findMany({
      where: { id: { in: dto.tochterMandantIds } },
      select: { id: true, kanzleiId: true },
    });
    if (tochtermandanten.length !== dto.tochterMandantIds.length) {
      throw new NotFoundException('Mindestens ein Tochtermandant nicht gefunden');
    }
    for (const t of tochtermandanten) {
      if (t.kanzleiId !== mutterMandant.kanzleiId) {
        throw new ForbiddenException(
          'Tochtermandant gehört nicht zur selben Kanzlei wie Mutter',
        );
      }
    }

    // Eindeutigkeit: pro Mutter+Geschäftsjahr nur 1 Einheit.
    try {
      const einheit = await this.konsolidierungRepository.create({
        kanzleiId: mutterMandant.kanzleiId,
        mutterMandantId: dto.mutterMandantId,
        tochterMandantIds: dto.tochterMandantIds,
        geschaeftsjahr: dto.geschaeftsjahr,
        konsolidierungsArt: dto.konsolidierungsArt,
        beteiligungsquote: dto.beteiligungsquote,
        // Initial: AK und EK werden vom Pilot-User nachgetragen oder beim
        // Apply aus den Bilanz-Positionen automatisch ermittelt.
        anschaffungskosten: 0,
        eigenkapitalTochter: 0,
        jahresueberschussTochter: 0,
        createdById: user.id,
      });

      const withBuchungen = await this.konsolidierungRepository.findWithBuchungen(
        einheit.id,
        einheit.kanzleiId,
      );
      if (!withBuchungen) {
        throw new Error('Konsolidierungs-Einheit konnte nicht geladen werden');
      }

      void this.auditService.record({
        userId: user.id,
        kanzleiId: einheit.kanzleiId,
        mandantId: dto.mutterMandantId,
        action: 'CREATE',
        entityType: 'KonsolidierungsEinheit',
        entityId: einheit.id,
        newState: this.toAuditDto(withBuchungen),
        ipAddress: context.ip ?? null,
        userAgent: context.userAgent ?? null,
      });

      return this.toResponseDto(withBuchungen);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new BadRequestException(
          `Für die Mutter existiert bereits eine Konsolidierungs-Einheit für das Geschäftsjahr ${dto.geschaeftsjahr}.`,
        );
      }
      throw err;
    }
  }

  /**
   * Liefert eine Konsolidierungs-Einheit mit allen Buchungen.
   */
  async findOne(
    einheitId: string,
    user: AuthUser,
  ): Promise<KonsolidierungEinheitDto> {
    const einheit = await this.loadEinheitForUser(einheitId, user);
    return this.toResponseDto(einheit);
  }

  /**
   * Liefert alle Konsolidierungs-Einheiten der Kanzlei des Users.
   */
  async findAll(user: AuthUser): Promise<KonsolidierungEinheitDto[]> {
    const kanzleiId = await this.resolveKanzleiId(user);
    const einheiten = await this.konsolidierungRepository.findByKanzlei(kanzleiId);
    if (einheiten.length === 0) return [];

    // Hole alle Buchungen gebündelt (1 Query statt N+1).
    const ids = einheiten.map((e) => e.id);
    const allBuchungen = await this.konsolidierungRepository.findBuchungenByEinheitIds(ids);
    const buchungenByEinheit = new Map<string, KonsolidierungsBuchungEntity[]>();
    for (const b of allBuchungen) {
      const arr = buchungenByEinheit.get(b.einheitId) ?? [];
      arr.push(b);
      buchungenByEinheit.set(b.einheitId, arr);
    }

    return einheiten.map((e) =>
      this.toResponseDto({
        ...e,
        buchungen: buchungenByEinheit.get(e.id) ?? [],
      }),
    );
  }

  /**
   * Berechnet die Konsolidierungs-Buchungen automatisch und persistiert sie.
   *
   * Schritte:
   *   1. Bilanzen + GuVs aller beteiligten Mandanten laden
   *   2. Kapitalkonsolidierung (§ 301 HGB) — Goodwill/Badwill aus AK vs. EK
   *   3. Schuldenkonsolidierung (§ 303 HGB) — Eliminierung konzerninterner
   *      Forderungen/Verbindlichkeiten über Konto-Paarung (1400 ↔ 3300)
   *   4. Aufwand/Ertrag-Eliminierung (§ 305 HGB) — über Beteiligungsquote
   *   5. Zwischenergebniseliminierung (§ 304 HGB) — pauschal 0 (kein
   *      Vorratsbestand-Tracking im Pilot)
   *   6. Latente Steuern (§ 306 HGB) — pauschal 0 im Pilot
   */
  async calculateBuchungen(
    einheitId: string,
    user: AuthUser,
    context: KonsolidierungServiceContext,
  ): Promise<KonsolidierungsBuchungDto[]> {
    const einheit = await this.loadEinheitForUser(einheitId, user);

    if (einheit.status === 'COMPLETED' || einheit.status === 'VALIDATED') {
      throw new BadRequestException(
        'Buchungen können nach Apply/Finalize nicht mehr neu berechnet werden',
      );
    }

    const inputs = await this.generateBuchungsInputs(einheit);

    // Recalculate: alte Buchungen wegwerfen, neu einfügen.
    await this.konsolidierungRepository.deleteBuchungen(einheit.id);
    if (inputs.length > 0) {
      await this.konsolidierungRepository.createBuchungen(einheit.id, inputs);
    }

    // Status auf IN_PROGRESS setzen.
    if (einheit.status === 'DRAFT') {
      await this.konsolidierungRepository.updateStatus(
        einheit.id,
        einheit.kanzleiId,
        { status: 'IN_PROGRESS' },
      );
    }

    const reloaded = await this.konsolidierungRepository.findWithBuchungen(
      einheit.id,
      einheit.kanzleiId,
    );
    if (!reloaded) {
      throw new Error('Konsolidierungs-Einheit konnte nicht geladen werden');
    }

    void this.auditService.record({
      userId: user.id,
      kanzleiId: einheit.kanzleiId,
      mandantId: einheit.mutterMandantId,
      action: 'UPDATE',
      entityType: 'KonsolidierungsEinheit',
      entityId: einheit.id,
      newState: {
        anzahlBuchungen: reloaded.buchungen.length,
        status: reloaded.status,
        buchungsArten: Array.from(
          new Set(reloaded.buchungen.map((b) => b.buchungsArt)),
        ),
      },
      ipAddress: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return reloaded.buchungen.map((b) => this.toBuchungDto(b, einheit.id));
  }

  /**
   * Erzeugt die Konzern-Bilanz + Konzern-GuV durch Aggregation der
   * Mutter- und Tochter-Positionen und wendet die Eliminations-Buchungen
   * an.
   */
  async applyKonsolidierung(
    einheitId: string,
    user: AuthUser,
    context: KonsolidierungServiceContext,
  ): Promise<ApplyKonsolidierungResponseDto> {
    const einheit = await this.loadEinheitForUser(einheitId, user);

    if (einheit.status === 'COMPLETED' || einheit.status === 'VALIDATED') {
      throw new BadRequestException(
        'Konsolidierung wurde bereits angewendet',
      );
    }

    // 1. Aktuelle Buchungen laden (oder neu berechnen, falls DRAFT).
    let buchungen = einheit.buchungen;
    if (buchungen.length === 0) {
      const inputs = await this.generateBuchungsInputs(einheit);
      if (inputs.length > 0) {
        buchungen = await this.konsolidierungRepository.createBuchungen(
          einheit.id,
          inputs,
        );
      }
    }

    // 2. Bilanzen + GuVs aller beteiligten Mandanten aggregieren.
    const teilnehmerIds = [einheit.mutterMandantId, ...einheit.tochterMandantIds];
    const bilanzMap = await this.loadBilanzenFuerGeschäftsjahr(
      teilnehmerIds,
      einheit.geschaeftsjahr,
    );
    const guvMap = await this.loadGuVsFuerGeschäftsjahr(
      teilnehmerIds,
      einheit.geschaeftsjahr,
    );

    // 3. Konsolidierte Bilanz-Positionen erzeugen.
    const konsBilanzPositionen = this.aggregateBilanzPositionen(
      bilanzMap,
      Number(einheit.beteiligungsquote),
    );
    // Eliminations-Buchungen auf Bilanz anwenden (Soll-/Haben-Korrektur).
    this.applyEliminationsToBilanz(konsBilanzPositionen, buchungen);

    // 4. Konsolidierte GuV-Positionen erzeugen.
    const konsGuvPositionen = this.aggregateGuvPositionen(
      guvMap,
      Number(einheit.beteiligungsquote),
    );
    this.applyEliminationsToGuv(konsGuvPositionen, buchungen);

    // 5. Konzern-Bilanz anlegen (mandantId = mutterMandantId).
    const konzernBilanz = await this.bilanzRepository.createWithPositionen({
      mandantId: einheit.mutterMandantId,
      geschaeftsjahr: einheit.geschaeftsjahr,
      status: 'VALIDATED',
      hinweise: `Konzern-Bilanz (Konsolidierungseinheit ${einheit.id}, ${einheit.konsolidierungsArt})`,
      createdById: user.id,
      positionen: konsBilanzPositionen.map((p, idx) => ({
        seite: p.seite,
        kontonummer: p.kontonummer,
        bezeichnung: p.bezeichnung,
        betragVorjahr: null,
        betragAktuell: p.betragAktuell,
        reihenfolge: idx + 1,
        bemerkung: p.bemerkung ?? null,
      })),
    });

    // 6. Jahresergebnis aus konsolidierter GuV berechnen.
    const jahresergebnis = this.computeGuvErgebnis(konsGuvPositionen);

    const konzernGuv = await this.guvRepository.createWithPositionen({
      mandantId: einheit.mutterMandantId,
      geschaeftsjahr: einheit.geschaeftsjahr,
      verfahren: 'GKV',
      status: 'VALIDATED',
      hinweise: `Konzern-GuV (Konsolidierungseinheit ${einheit.id}, ${einheit.konsolidierungsArt})`,
      ergebnis: jahresergebnis,
      createdById: user.id,
      positionen: konsGuvPositionen.map((p, idx) => ({
        kontonummer: p.kontonummer,
        bezeichnung: p.bezeichnung,
        kategorie: p.kategorie as GuVKategorieLiteral,
        betragVorjahr: null,
        betragAktuell: p.betragAktuell,
        reihenfolge: idx + 1,
        bemerkung: p.bemerkung ?? null,
      })),
    });

    // 7. Salden berechnen + Status auf COMPLETED.
    const salden = await this.calculateKonzernSalden(einheitId, user);
    await this.konsolidierungRepository.updateStatus(einheit.id, einheit.kanzleiId, {
      status: 'COMPLETED',
      konzernBilanzId: konzernBilanz.id,
      konzernGuvId: konzernGuv.id,
    });

    void this.auditService.record({
      userId: user.id,
      kanzleiId: einheit.kanzleiId,
      mandantId: einheit.mutterMandantId,
      action: 'UPDATE',
      entityType: 'KonsolidierungsEinheit',
      entityId: einheit.id,
      newState: {
        status: 'COMPLETED',
        konzernBilanzId: konzernBilanz.id,
        konzernGuvId: konzernGuv.id,
        salden,
        anzahlBuchungen: buchungen.length,
      } as unknown as Prisma.JsonValue,
      ipAddress: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return {
      konzernBilanzId: konzernBilanz.id,
      konzernGuvId: konzernGuv.id,
      salden,
      anzahlBuchungen: buchungen.length,
    };
  }

  /**
   * Berechnet finale Konzern-Salden aus Konzern-Bilanz + Konzern-GuV.
   *
   * Goodwill/Badwill werden aus dem passiven/aktiven Differenzbetrag
   * der Kapitalkonsolidierung abgeleitet.
   */
  async calculateKonzernSalden(
    einheitId: string,
    user: AuthUser,
  ): Promise<KonzernSaldenDto> {
    const einheit = await this.loadEinheitForUser(einheitId, user);

    let aktivaSumme = 0;
    let passivaSumme = 0;
    let eigenkapitalSumme = 0;

    if (einheit.konzernBilanzId) {
      const bilanz = await this.bilanzRepository.findWithPositionen(
        einheit.konzernBilanzId,
        einheit.mutterMandantId,
      );
      if (bilanz) {
        for (const p of bilanz.positionen) {
          const betrag = Number(p.betragAktuell);
          if (p.seite === 'AKTIVA') {
            aktivaSumme += betrag;
          } else if (p.seite === 'PASSIVA') {
            passivaSumme += betrag;
            // Gezeichnetes Kapital + Rücklagen + Jahresergebnis = EK
            if (
              p.kontonummer === 'A.I.' ||
              p.kontonummer === 'A.II.' ||
              p.kontonummer === 'A.III.' ||
              p.kontonummer === 'A.IV.' ||
              p.kontonummer === 'A.V.'
            ) {
              eigenkapitalSumme += betrag;
            }
          }
        }
      }
    }

    let guvErgebnis = 0;
    if (einheit.konzernGuvId) {
      const guv = await this.guvRepository.findWithPositionen(
        einheit.konzernGuvId,
        einheit.mutterMandantId,
      );
      if (guv) {
        guvErgebnis = Number(guv.ergebnis);
      }
    }

    const bilanzDifferenz = Math.abs(aktivaSumme - passivaSumme);
    const bilanzSumme = aktivaSumme; // == passivaSumme nach erfolgreicher Konsolidierung
    const eigenkapitalQuote =
      bilanzSumme > 0 ? (eigenkapitalSumme / bilanzSumme) * 100 : 0;

    // Goodwill/Badwill aus aktiver/passiver Differenz der Kapitalkonsolidierung.
    const anschaffungskosten = Number(einheit.anschaffungskosten);
    const eigenkapitalTochter = Number(einheit.eigenkapitalTochter);
    const beteiligungsquote = Number(einheit.beteiligungsquote);
    const anteilEKEK = (eigenkapitalTochter * beteiligungsquote) / 100;
    const goodwill = Math.max(anschaffungskosten - anteilEKEK, 0);
    const badwill = Math.max(anteilEKEK - anschaffungskosten, 0);

    return {
      konzernAktivaSumme: Number(aktivaSumme.toFixed(2)),
      konzernPassivaSumme: Number(passivaSumme.toFixed(2)),
      konzernBilanzDifferenz: Number(bilanzDifferenz.toFixed(2)),
      konzernGuVErgebnis: Number(guvErgebnis.toFixed(2)),
      eigenkapitalQuoteKonzern: Number(eigenkapitalQuote.toFixed(2)),
      goodwill: Number(goodwill.toFixed(2)),
      badwill: Number(badwill.toFixed(2)),
    };
  }

  /**
   * Finalisiert eine Konsolidierung (nach WP-Prüfung).
   * Status: COMPLETED → VALIDATED.
   */
  async finalizeEinheit(
    einheitId: string,
    user: AuthUser,
    context: KonsolidierungServiceContext,
  ): Promise<void> {
    const einheit = await this.loadEinheitForUser(einheitId, user);

    if (einheit.status !== 'COMPLETED') {
      throw new BadRequestException(
        `Finalize nur nach Apply möglich — aktueller Status: ${einheit.status}`,
      );
    }

    await this.konsolidierungRepository.updateStatus(
      einheit.id,
      einheit.kanzleiId,
      {
        status: 'VALIDATED',
        finalisiertAm: new Date(),
        finalisiertVonId: user.id,
      },
    );

    void this.auditService.record({
      userId: user.id,
      kanzleiId: einheit.kanzleiId,
      mandantId: einheit.mutterMandantId,
      action: 'UPDATE',
      entityType: 'KonsolidierungsEinheit',
      entityId: einheit.id,
      previousState: { status: 'COMPLETED' } as unknown as Prisma.JsonValue,
      newState: {
        status: 'VALIDATED',
        finalisiertAm: new Date().toISOString(),
      } as unknown as Prisma.JsonValue,
      ipAddress: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  /**
   * Lädt eine Einheit für den User (mit Kanzlei-Filter) inklusive Buchungen.
   * Wirft NotFoundException, falls nicht in der Kanzlei des Users.
   */
  private async loadEinheitForUser(einheitId: string, user: AuthUser): Promise<KonsolidierungsEinheitEntity> {
    const kanzleiId = await this.resolveKanzleiId(user);
    const einheit = await this.konsolidierungRepository.findWithBuchungen(
      einheitId,
      kanzleiId,
    );
    if (!einheit) {
      throw new NotFoundException('Konsolidierungs-Einheit nicht gefunden');
    }
    return einheit;
  }

  /**
   * Erzwingt Mandant-Trennung: alle Mandanten-IDs müssen für den User
   * zugänglich sein (entweder über user.mandanten oder globalRole=SYSTEM_ADMIN).
   *
   * Cross-Kanzlei-Mandanten werden NICHT hier, sondern im createEinheit
   * explizit gegen dieselbe kanzleiId geprüft.
   */
  private assertKanzleiAccessForMandanten(
    mandantIds: string[],
    user: AuthUser,
  ): void {
    if (user.globalRole === 'SYSTEM_ADMIN') return;
    const accessible = new Set(user.mandanten.map((m) => m.id));
    for (const id of mandantIds) {
      if (!accessible.has(id)) {
        throw new ForbiddenException(
          `Kein Zugriff auf Mandant ${id} (Mandant-Trennung)`,
        );
      }
    }
  }

  /**
   * Liefert die kanzleiId des Users (aus erstem zugänglichen Mandanten
   * oder SYSTEM_ADMIN → erste Kanzlei).
   */
  private async resolveKanzleiId(user: AuthUser): Promise<string> {
    if (user.globalRole === 'SYSTEM_ADMIN') {
      const firstKanzlei = await this.prisma.kanzlei.findFirst({
        select: { id: true },
      });
      if (firstKanzlei) return firstKanzlei.id;
      throw new NotFoundException('Keine Kanzlei vorhanden');
    }
    const first = user.mandanten[0];
    if (!first) {
      throw new ForbiddenException('Kein zugänglicher Mandant vorhanden');
    }
    const mandant = await this.prisma.mandant.findUnique({
      where: { id: first.id },
      select: { kanzleiId: true },
    });
    if (!mandant) throw new NotFoundException('Mandant nicht gefunden');
    return mandant.kanzleiId;
  }

  /**
   * Generiert die Eliminations-Buchungen für eine Einheit.
   */
  private async generateBuchungsInputs(
    einheit: KonsolidierungsEinheitEntity,
  ): Promise<KonsolidierungsBuchungInput[]> {
    const inputs: KonsolidierungsBuchungInput[] = [];
    const teilnehmerIds = [einheit.mutterMandantId, ...einheit.tochterMandantIds];
    const bilanzMap = await this.loadBilanzenFuerGeschäftsjahr(
      teilnehmerIds,
      einheit.geschaeftsjahr,
    );
    const guvMap = await this.loadGuVsFuerGeschäftsjahr(
      teilnehmerIds,
      einheit.geschaeftsjahr,
    );

    let reihenfolge = 1;

    // 1) Kapitalkonsolidierung (§ 301 HGB)
    const ak = Number(einheit.anschaffungskosten);
    const ekTochter = Number(einheit.eigenkapitalTochter);
    const beteiligungsquote = Number(einheit.beteiligungsquote);
    const anteilEK = (ekTochter * beteiligungsquote) / 100;

    if (ak > 0 || ekTochter > 0) {
      const kapDef = KONSOLIDIERUNGS_BUCHUNGSARTEN.find(
        (b) => b.art === 'KAPITAL_KONSOLIDIERUNG',
      )!;
      const betrag = Math.abs(ak - anteilEK);
      const istGoodwill = ak >= anteilEK;
      inputs.push({
        buchungsArt: 'KAPITAL_KONSOLIDIERUNG',
        beschreibung: istGoodwill
          ? `Kapitalkonsolidierung: Goodwill aus AK ${ak.toFixed(2)} EUR vs. anteiligem EK ${anteilEK.toFixed(2)} EUR`
          : `Kapitalkonsolidierung: Badwill aus AK ${ak.toFixed(2)} EUR vs. anteiligem EK ${anteilEK.toFixed(2)} EUR`,
        kontoSoll: kapDef.defaultKontoSoll,
        kontoHaben: kapDef.defaultKontoHaben,
        betrag,
        reihenfolge: reihenfolge++,
        istAutomatisch: true,
      });
    }

    // 2) Schuldenkonsolidierung (§ 303 HGB)
    // Pauschal-Elimination: konzerninterne Forderungen (SKR04 1400) =
    // konzerninterne Verbindlichkeiten (SKR04 3300) — Pilot-Annahme.
    // Der WP prüft die zugrundeliegenden Buchungen separat.
    const internerForderungsBetrag = bilanzMap
      .flatMap((b) => b.bilanz.positionen)
      .filter((p) => p.kontonummer === 'B.II.1.' && p.seite === 'AKTIVA')
      .reduce((s, p) => s + Number(p.betragAktuell), 0);
    const internerVerbindlichkeitsBetrag = bilanzMap
      .flatMap((b) => b.bilanz.positionen)
      .filter((p) => p.kontonummer === 'C.4.' && p.seite === 'PASSIVA')
      .reduce((s, p) => s + Number(p.betragAktuell), 0);
    // Im Pilot vereinfachen wir: nur eliminieren, wenn beide > 0.
    const schuldBetrag = Math.min(internerForderungsBetrag, internerVerbindlichkeitsBetrag);
    if (schuldBetrag > 0) {
      const schuldDef = KONSOLIDIERUNGS_BUCHUNGSARTEN.find(
        (b) => b.art === 'SCHULDEN_KONSOLIDIERUNG',
      )!;
      inputs.push({
        buchungsArt: 'SCHULDEN_KONSOLIDIERUNG',
        beschreibung: `Eliminierung konzerninterner Forderungen/Verbindlichkeiten (${schuldBetrag.toFixed(2)} EUR, Pilot-Schätzung)`,
        kontoSoll: schuldDef.defaultKontoSoll,
        kontoHaben: schuldDef.defaultKontoHaben,
        betrag: schuldBetrag,
        reihenfolge: reihenfolge++,
        istAutomatisch: true,
      });
    }

    // 3) Zwischenergebniseliminierung (§ 304 HGB)
    // Pilot: kein Vorratsbestand-Tracking → keine Buchung.
    // Hook für zukünftige Erweiterung: wenn konzerninterne Lieferungen
    // mit Margen bekannt sind, hier eliminieren.

    // 4) Aufwand/Ertrag-Eliminierung (§ 305 HGB)
    // Pilot: konzerninterne Umsatzerlöse (4400) und Materialaufwand (5000)
    // werden über die Beteiligungsquote pauschal proportional reduziert.
    const umsatzTochter = guvMap
      .filter((g) => g.mandantId !== einheit.mutterMandantId)
      .flatMap((g) => g.guv.positionen)
      .filter((p) => p.kategorie === 'ERLOES')
      .reduce((s, p) => s + Number(p.betragAktuell), 0);
    const elimBetrag = (umsatzTochter * beteiligungsquote) / 100;
    if (elimBetrag > 0) {
      const aufwDef = KONSOLIDIERUNGS_BUCHUNGSARTEN.find(
        (b) => b.art === 'AUFWAND_ERTRAG',
      )!;
      inputs.push({
        buchungsArt: 'AUFWAND_ERTRAG',
        beschreibung: `Eliminierung konzerninterner Umsatzerlöse (${elimBetrag.toFixed(2)} EUR, ${beteiligungsquote.toFixed(2)}% Beteiligung)`,
        kontoSoll: aufwDef.defaultKontoSoll,
        kontoHaben: aufwDef.defaultKontoHaben,
        betrag: elimBetrag,
        reihenfolge: reihenfolge++,
        istAutomatisch: true,
      });
    }

    // 5) Latente Steuern (§ 306 HGB)
    // Pilot: keine Berechnung (vereinfachte Variante) — Hook für Erweiterung.

    return inputs;
  }

  /**
   * Lädt alle Bilanzen der Teilnehmer für ein Geschäftsjahr.
   */
  private async loadBilanzenFuerGeschäftsjahr(
    mandantIds: string[],
    geschaeftsjahr: number,
  ): Promise<Array<{ mandantId: string; bilanz: NonNullable<Awaited<ReturnType<BilanzRepository['findWithPositionen']>>> }>> {
    const result: Array<{ mandantId: string; bilanz: NonNullable<Awaited<ReturnType<BilanzRepository['findWithPositionen']>>> }> = [];
    for (const mandantId of mandantIds) {
      // Suche ohne Positionen, dann prüfe Jahr.
      const allBilanzen = await this.bilanzRepository.findByMandantAndJahr(
        mandantId,
        geschaeftsjahr,
      );
      const target = allBilanzen[0];
      if (!target) continue;
      const withPos = await this.bilanzRepository.findWithPositionen(
        target.id,
        mandantId,
      );
      if (withPos) {
        result.push({ mandantId, bilanz: withPos });
      }
    }
    return result;
  }

  /**
   * Lädt alle GuVs der Teilnehmer für ein Geschäftsjahr.
   */
  private async loadGuVsFuerGeschäftsjahr(
    mandantIds: string[],
    geschaeftsjahr: number,
  ): Promise<Array<{ mandantId: string; guv: NonNullable<Awaited<ReturnType<GuVRepository['findWithPositionen']>>> }>> {
    const result: Array<{ mandantId: string; guv: NonNullable<Awaited<ReturnType<GuVRepository['findWithPositionen']>>> }> = [];
    for (const mandantId of mandantIds) {
      const allGuVs = await this.guvRepository.findByMandantAndJahr(
        mandantId,
        geschaeftsjahr,
      );
      const target = allGuVs[0];
      if (!target) continue;
      const withPos = await this.guvRepository.findWithPositionen(
        target.id,
        mandantId,
      );
      if (withPos) {
        result.push({ mandantId, guv: withPos });
      }
    }
    return result;
  }

  /**
   * Aggregiert Bilanz-Positionen aus allen Teilnehmern. Pro HGB-Position
   * wird der höchste reihenfolge-Wert genutzt.
   */
  private aggregateBilanzPositionen(
    bilanzMap: Array<{ mandantId: string; bilanz: NonNullable<Awaited<ReturnType<BilanzRepository['findWithPositionen']>>> }>,
    beteiligungsquote: number,
  ): Array<{
    seite: 'AKTIVA' | 'PASSIVA';
    kontonummer: string;
    bezeichnung: string;
    betragAktuell: number;
    bemerkung?: string;
  }> {
    const positionMap = new Map<
      string,
      {
        seite: 'AKTIVA' | 'PASSIVA';
        kontonummer: string;
        bezeichnung: string;
        betragAktuell: number;
        bemerkung?: string;
        reihenfolge: number;
      }
    >();

    for (const { bilanz } of bilanzMap) {
      for (const p of bilanz.positionen) {
        const key = `${p.seite}::${p.kontonummer}`;
        const existing = positionMap.get(key);
        if (!existing) {
          positionMap.set(key, {
            seite: p.seite as 'AKTIVA' | 'PASSIVA',
            kontonummer: p.kontonummer,
            bezeichnung: p.bezeichnung,
            betragAktuell: Number(p.betragAktuell),
            bemerkung: undefined,
            reihenfolge: p.reihenfolge,
          });
        } else {
          existing.betragAktuell += Number(p.betragAktuell);
          existing.reihenfolge = Math.max(existing.reihenfolge, p.reihenfolge);
        }
      }
    }

    // Aufwand/Ertrag-Korrektur: bei < 100% Beteiligung werden
    // Tochter-Positionen proportional skaliert. Pilot: nur Umsatzerlöse
    // werden bereits in calculateBuchungen eliminiert; hier Full-Aggregation.
    void beteiligungsquote;

    return Array.from(positionMap.values())
      .sort((a, b) => a.reihenfolge - b.reihenfolge)
      .map(({ reihenfolge: _r, ...rest }) => rest);
  }

  /**
   * Aggregiert GuV-Positionen aus allen Teilnehmern.
   */
  private aggregateGuvPositionen(
    guvMap: Array<{ mandantId: string; guv: NonNullable<Awaited<ReturnType<GuVRepository['findWithPositionen']>>> }>,
    beteiligungsquote: number,
  ): Array<{
    kontonummer: string;
    bezeichnung: string;
    kategorie: string;
    betragAktuell: number;
    bemerkung?: string;
  }> {
    const positionMap = new Map<
      string,
      {
        kontonummer: string;
        bezeichnung: string;
        kategorie: string;
        betragAktuell: number;
        reihenfolge: number;
      }
    >();

    for (const { guv } of guvMap) {
      for (const p of guv.positionen) {
        const key = p.kontonummer;
        const existing = positionMap.get(key);
        if (!existing) {
          positionMap.set(key, {
            kontonummer: p.kontonummer,
            bezeichnung: p.bezeichnung,
            kategorie: p.kategorie,
            betragAktuell: Number(p.betragAktuell),
            reihenfolge: p.reihenfolge,
          });
        } else {
          existing.betragAktuell += Number(p.betragAktuell);
          existing.reihenfolge = Math.max(existing.reihenfolge, p.reihenfolge);
        }
      }
    }

    void beteiligungsquote;

    return Array.from(positionMap.values())
      .sort((a, b) => a.reihenfolge - b.reihenfolge)
      .map(({ reihenfolge: _r, ...rest }) => rest);
  }

  /**
   * Wendet Eliminations-Buchungen auf Bilanz-Positionen an.
   * Aktuell: SCHULDEN_KONSOLIDIERUNG reduziert Aktiv- und Passiv-Positionen
   * um den Betrag (vereinfachtes Modell).
   */
  private applyEliminationsToBilanz(
    positionen: Array<{
      seite: 'AKTIVA' | 'PASSIVA';
      kontonummer: string;
      bezeichnung: string;
      betragAktuell: number;
      bemerkung?: string;
    }>,
    buchungen: Array<{ buchungsArt: string; betrag: Prisma.Decimal }>,
  ): void {
    for (const b of buchungen) {
      const betrag = Number(b.betrag);
      if (b.buchungsArt === 'SCHULDEN_KONSOLIDIERUNG') {
        // Forderungen (B.II.1.) und Verbindlichkeiten (C.4.) reduzieren.
        for (const p of positionen) {
          if (
            (p.seite === 'AKTIVA' && p.kontonummer === 'B.II.1.') ||
            (p.seite === 'PASSIVA' && p.kontonummer === 'C.4.')
          ) {
            p.betragAktuell = Math.max(p.betragAktuell - betrag, 0);
          }
        }
      } else if (b.buchungsArt === 'KAPITAL_KONSOLIDIERUNG') {
        // Goodwill als zusätzliche Aktiva-Position; Badwill reduziert EK.
        // Vereinfacht: EK (A.I.) der Mutter um AK-Anteil reduzieren.
        for (const p of positionen) {
          if (p.seite === 'PASSIVA' && p.kontonummer === 'A.I.') {
            p.betragAktuell = Math.max(p.betragAktuell - betrag, 0);
          }
        }
        // Aktiva-Seite: Goodwill als immaterieller Vermögensgegenstand.
        const existingGoodwill = positionen.find(
          (p) => p.seite === 'AKTIVA' && p.kontonummer === 'A.I.3.',
        );
        if (existingGoodwill) {
          existingGoodwill.betragAktuell += betrag;
        } else {
          positionen.push({
            seite: 'AKTIVA',
            kontonummer: 'A.I.3.',
            bezeichnung: 'Geschäfts- oder Firmenwert (Konsolidierung)',
            betragAktuell: betrag,
            bemerkung: 'Goodwill aus Kapitalkonsolidierung',
          });
        }
      }
    }
  }

  /**
   * Wendet Eliminations-Buchungen auf GuV-Positionen an.
   */
  private applyEliminationsToGuv(
    positionen: Array<{
      kontonummer: string;
      bezeichnung: string;
      kategorie: string;
      betragAktuell: number;
      bemerkung?: string;
    }>,
    buchungen: Array<{ buchungsArt: string; betrag: Prisma.Decimal }>,
  ): void {
    for (const b of buchungen) {
      const betrag = Number(b.betrag);
      if (b.buchungsArt === 'AUFWAND_ERTRAG') {
        // Umsatzerlöse (ERLOES) und korrespondierender Materialaufwand
        // (MATERIAL) reduzieren.
        for (const p of positionen) {
          if (p.kategorie === 'ERLOES' || p.kategorie === 'MATERIAL') {
            p.betragAktuell = Math.max(p.betragAktuell - betrag, 0);
          }
        }
      } else if (b.buchungsArt === 'LATENTE_STEUERN') {
        // Latente Steuern als zusätzliche STEUER-Position.
        const existing = positionen.find((p) => p.kategorie === 'STEUER');
        if (existing) {
          existing.betragAktuell += betrag;
        } else {
          positionen.push({
            kontonummer: '16.',
            bezeichnung: 'Latente Steuern (§ 306 HGB)',
            kategorie: 'STEUER',
            betragAktuell: betrag,
          });
        }
      }
    }
  }

  /**
   * Berechnet das Jahresergebnis aus konsolidierten GuV-Positionen.
   */
  private computeGuvErgebnis(
    positionen: Array<{ kategorie: string; betragAktuell: number }>,
  ): number {
    let erloese = 0;
    let aufwand = 0;
    for (const p of positionen) {
      if (p.kategorie === 'ERLOES' || (p.kategorie === 'FINANZ' && p.betragAktuell > 0)) {
        erloese += p.betragAktuell;
      } else {
        aufwand += Math.abs(p.betragAktuell);
      }
    }
    return Number((erloese - aufwand).toFixed(2));
  }

  /**
   * Konvertiert ein KonsolidierungsEntity in das Response-DTO.
   */
  private toResponseDto(
    einheit: KonsolidierungsEinheitEntity,
  ): KonsolidierungEinheitDto {
    return {
      id: einheit.id,
      kanzleiId: einheit.kanzleiId,
      mutterMandantId: einheit.mutterMandantId,
      tochterMandantIds: einheit.tochterMandantIds,
      geschaeftsjahr: einheit.geschaeftsjahr,
      beteiligungsquote: Number(einheit.beteiligungsquote),
      anschaffungskosten: Number(einheit.anschaffungskosten),
      eigenkapitalTochter: Number(einheit.eigenkapitalTochter),
      jahresueberschussTochter: Number(einheit.jahresueberschussTochter),
      konsolidierungsArt: einheit.konsolidierungsArt,
      status: einheit.status,
      konzernBilanzId: einheit.konzernBilanzId,
      konzernGuvId: einheit.konzernGuvId,
      erstellungsdatum: einheit.erstellungsdatum.toISOString(),
      finalisiertAm: einheit.finalisiertAm
        ? einheit.finalisiertAm.toISOString()
        : null,
      buchungen: einheit.buchungen.map((b) => this.toBuchungDto(b, einheit.id)),
    };
  }

  private toBuchungDto(
    b: KonsolidierungsBuchungEntity,
    einheitId: string,
  ): KonsolidierungsBuchungDto {
    return {
      id: b.id,
      einheitId,
      buchungsArt: b.buchungsArt,
      beschreibung: b.beschreibung,
      kontoSoll: b.kontoSoll,
      kontoHaben: b.kontoHaben,
      betrag: Number(b.betrag),
      mandantId: b.mandantId,
      bezugId: b.bezugId,
      reihenfolge: b.reihenfolge,
      istAutomatisch: b.istAutomatisch,
    };
  }

  private toAuditDto(
    einheit: KonsolidierungsEinheitEntity,
  ): Prisma.JsonValue {
    return {
      id: einheit.id,
      kanzleiId: einheit.kanzleiId,
      mutterMandantId: einheit.mutterMandantId,
      tochterMandantIds: einheit.tochterMandantIds,
      geschaeftsjahr: einheit.geschaeftsjahr,
      konsolidierungsArt: einheit.konsolidierungsArt,
      status: einheit.status,
      beteiligungsquote: einheit.beteiligungsquote.toString(),
      anschaffungskosten: einheit.anschaffungskosten.toString(),
      eigenkapitalTochter: einheit.eigenkapitalTochter.toString(),
      jahresueberschussTochter: einheit.jahresueberschussTochter.toString(),
      konzernBilanzId: einheit.konzernBilanzId,
      konzernGuvId: einheit.konzernGuvId,
      buchungen: einheit.buchungen.map((b) => ({
        id: b.id,
        buchungsArt: b.buchungsArt,
        betrag: b.betrag.toString(),
        reihenfolge: b.reihenfolge,
        istAutomatisch: b.istAutomatisch,
      })),
    } as unknown as Prisma.JsonValue;
  }
}