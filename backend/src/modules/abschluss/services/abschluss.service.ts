import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/services/audit.service';
import { assertMandantNichtArchiviert } from '../../../common/utils/mandant-archivierung';
import { pruefeAbschlussAbweichung } from '../../../common/utils/signatur-abweichung';
import { CreateJahresabschlussDto } from '../dto/create-jahresabschluss.dto';
import {
  FinalizeErgebnisDto,
  FinalizeJahresabschlussDto,
  VollstaendigkeitsPruefung,
} from '../dto/finalize-jahresabschluss.dto';
import {
  EinreichenJahresabschlussDto,
  type EinreichenErgebnisDto,
  type VeroeffentlichenErgebnisDto,
} from '../dto/einreichen-jahresabschluss.dto';
import { BilanzService } from '../../bilanz/services/bilanz.service';
import { GuVService } from '../../guv/services/guv.service';
import { AnhangService } from '../../anhang/services/anhang.service';
import { WormObjectRepository } from '../../storage/repositories/worm-object.repository';
import { StorageService } from '../../storage/services/storage.service';
import { XbrlGeneratorService } from '../../ebilanz/services/xbrl-generator.service';
import type { AuthUser } from '../../auth/types/auth-user.types';
import { assertMandantAccess } from '../../../common/utils/mandant-zugriff';

/**
 * Jahresabschluss — das Aggregat nach § 314 HGB.
 *
 * BEFUND 2026-10-17 (Nachtrag 27): Zu diesem Objekt gab es überhaupt keinen
 * Schreibpfad — keine Route, keinen Service, 0 Datensätze nach dem Seed.
 * Damit waren `signatur.signAbschluss()` und `pdf/abschluss/:id/generate`
 * vorhandener, aber unerreichbarer Code.
 *
 * **Umfang: Anlegen, Lesen und Abschliessen** (Schritt 1-3 des
 * Jahresabschluss-Plans).
 *
 * Dieser Kommentar stand hier bis eben als "Das Abschliessen (`finalize`)
 * ist bewusst NICHT enthalten". Das war nach Schritt 3 **falsch** - und ein
 * Kommentar, der eine erledigte Arbeit als offen ausweist, ist schlimmer
 * als keiner: Er erzeugt eine offene Frage, die niemand beantworten kann,
 * weil die Antwort schon im Code steht.
 *
 * Zum Saldoabgleich (Nachtrag 22, Entscheidung 1): Eine Abweichung
 * zwischen Bilanz-`A.V.` und GuV-Ergebnis **sperrt nicht**, sie wird
 * gemeldet. `A.V.` ist nicht zwangsläufig das Jahresergebnis -
 * Kapitalerhoehungen und Entnahmen verschieben den Saldo, ohne in der GuV
 * zu erscheinen, und das Produkt modelliert solche Bewegungen nicht. Eine
 * harte Sperre wuerde berechtigte Abschluesse blockieren.
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
    private readonly bilanzService: BilanzService,
    private readonly guvService: GuVService,
    private readonly anhangService: AnhangService,
    private readonly wormObjectRepository: WormObjectRepository,
    // BEFUND 2026-10-20 (Nachtrag 62, TODO-8.10): Fuer die
    // Einreichungs-Datensaetze braucht es die **Nutzlast** selbst — das
    // signierte PDF aus dem WORM-Speicher.
    private readonly storageService: StorageService,
    /**
     * BEFUND 2026-10-22 (Nachtrag 86): Fuer Mandanten mit Kanal
     * `XML_XBRL` / `EBILANZ_TAXONOMIE` ist die eingereichte Nutzlast die
     * **XBRL** — nicht das signierte PDF. Der Generator erzeugt sie und legt
     * sie im WORM ab (§ 147 AO).
     */
    private readonly xbrlGenerator: XbrlGeneratorService,
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
    assertMandantAccess(dto.mandantId, user);

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

    await this.auditService.record({
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
    return this.toResponse(abschluss, user);
  }

  /**
   * Liste der Jahresabschlüsse eines Mandanten, neueste zuerst.
   *
   * Der Context-Mandant kommt aus dem `MandantGuard` (Header/Query/Body),
   * nicht aus einem freien Parameter.
   */
  async findAll(mandantId: string, user: AuthUser) {
    assertMandantAccess(mandantId, user);
    const eintraege = await this.prisma.jahresabschluss.findMany({
      where: { mandantId },
      orderBy: [{ geschaeftsjahr: 'desc' }],
      include: { bilanz: true, guv: true, anhang: true },
    });
    return Promise.all(eintraege.map((a) => this.toResponse(a, user)));
  }

  async findOne(id: string, mandantId: string, user: AuthUser) {
    assertMandantAccess(mandantId, user);
    const abschluss = await this.prisma.jahresabschluss.findFirst({
      where: { id, mandantId },
      include: { bilanz: true, guv: true, anhang: true },
    });
    if (!abschluss) throw new NotFoundException('Jahresabschluss nicht gefunden');
    return this.toResponse(abschluss, user);
  }

  /**
   * Schliesst den Jahresabschluss ab — die letzte Instanz vor der
   * Veroeffentlichung.
   *
   * **Sperren** (der Abschluss wird abgelehnt):
   *   - der Mandant ist archiviert (Entscheidung 2026-10-14)
   *   - die Bilanz geht nicht auf (`saldostimmt`)
   *   - die GuV fehlt oder ist nicht ausgewiesen
   *   - der Anhang hat noch offene Platzhalter ("[Ort]" im PDF!)
   *   - einer der drei Saetze steht noch auf DRAFT (in Bearbeitung)
   *   - der Abschluss ist nicht DRAFT (kein Zuruecksetzen)
   *
   * **Sperre mit schriftlich begruendetem Ausweg**:
   *   - die Abweichung zwischen `A.V.` (Bilanz) und dem GuV-Ergebnis.
   *
   * ENTSCHEIDUNG 2026-10-20 (Nachtrag 59, Entscheidung 1): Dieser Punkt
   * war eine blosse Meldung — die Abweichung wurde angezeigt, und der
   * Abschluss ging trotzdem durch. Jetzt **sperrt** er.
   *
   * Der Ausweg bleibt, weil es einen realen Grund fuer die Abweichung
   * gibt: `A.V.` ist nicht zwangslaeufig das Jahresergebnis —
   * Kapitalerhoehungen und Entnahmen verschieben den Saldo, ohne in der
   * GuV zu erscheinen, und solche Eigenkapitalbewegungen modelliert das
   * Produkt nicht. Wer das weiss, begruendet die Abweichung schriftlich
   * (`begruendung` im Body); die Begruendung geht in den Audit-Trail.
   *
   * Die Begruendung gilt **nur** fuer diesen Punkt. Die anderen Sperren
   * sind unabhaengig davon und lassen sich nicht begruenden.
   */
  async finalize(
    id: string,
    mandantId: string,
    dto: FinalizeJahresabschlussDto,
    user: AuthUser,
    context: { ip?: string | null; userAgent?: string | null },
  ): Promise<FinalizeErgebnisDto> {
    assertMandantAccess(mandantId, user);

    const abschluss = await this.prisma.jahresabschluss.findFirst({
      where: { id, mandantId },
      include: { bilanz: { include: { positionen: true } }, guv: true, anhang: { include: { abschnitte: true } } },
    });
    if (!abschluss) throw new NotFoundException('Jahresabschluss nicht gefunden');

    if (abschluss.status !== 'DRAFT') {
      throw new ConflictException(
        `Der Jahresabschluss ist bereits abgeschlossen (Status ${abschluss.status}). ` +
          'Ein Zuruecksetzen auf DRAFT ist nicht zulaessig — ' +
          'ein korrigierter Abschluss wird als neuer Abschluss angelegt.',
      );
    }

    const mandant = await this.prisma.mandant.findUnique({
      where: { id: mandantId },
      select: { archiviertAt: true, firmenname: true },
    });
    if (!mandant) throw new NotFoundException('Mandant nicht gefunden');
    assertMandantNichtArchiviert(mandant.archiviertAt, 'Jahresabschluss abschliessen');

    const pruefungen: VollstaendigkeitsPruefung[] = [];

    // 1) Bilanz: muss aufgehen
    const bilanzValidierung = await this.bilanzService.validate(
      abschluss.bilanzId,
      mandantId,
      user,
    );
    pruefungen.push({
      gegenstand: 'Bilanz',
      bestanden: bilanzValidierung.saldostimmt,
      meldung: bilanzValidierung.saldostimmt
        ? `Bilanz geht auf (Aktiva ${bilanzValidierung.aktivaSumme.toFixed(2)} = Passiva ${bilanzValidierung.passivaSumme.toFixed(2)}).`
        : `Die Bilanz geht NICHT auf: Differenz ${bilanzValidierung.differenz.toFixed(2)} EUR. ` +
          'Ein Jahresabschluss mit unausgeglichener Bilanz ist keine Bilanz.',
    });

    // 2) GuV: Ergebnis muss ausgewiesen sein
    const guvValidierung = await this.guvService.validate(abschluss.guvId, mandantId, user);
    const guvOk = Number.isFinite(guvValidierung.jahresergebnis);
    pruefungen.push({
      gegenstand: 'GuV',
      bestanden: guvOk,
      meldung: guvOk
        ? `GuV-Ergebnis: ${guvValidierung.jahresergebnis.toFixed(2)} EUR.`
        : 'Die GuV weist kein Jahresergebnis aus.',
    });

    // 3) Anhang: keine offenen Platzhalter
    // BEFUND 2026-10-24 (Nachtrag 93): Der Anhang wird als GANZES
    // geprueft — Abschnitte und die drei Pflichtangaben (§ 284/285 HGB).
    const offenePlatzhalter = this.anhangService.offenePlatzhalter(
      abschluss.anhang,
    );
    pruefungen.push({
      gegenstand: 'Anhang',
      bestanden: offenePlatzhalter.length === 0,
      meldung:
        offenePlatzhalter.length === 0
          ? 'Alle Pflichtangaben sind ausgefüllt.'
          : `Der Anhang enthaelt noch offene Platzhalter: ${offenePlatzhalter.join(', ')}. ` +
            'Ein PDF mit Platzhaltern ist kein veroeffentlichungsfaehiger Anhang.',
    });

    // 4) Die drei Saetze duerfen nicht mehr in Bearbeitung sein
    for (const [bezeichnung, status] of [
      ['Bilanz', abschluss.bilanz.status],
      ['GuV', abschluss.guv.status],
      ['Anhang', abschluss.anhang.status],
    ] as const) {
      pruefungen.push({
        gegenstand: `${bezeichnung} (Bearbeitungsstatus)`,
        bestanden: status !== 'DRAFT',
        meldung:
          status !== 'DRAFT'
            ? `${bezeichnung} ist abgeschlossen (${status}).`
            : `Die ${bezeichnung} steht noch auf DRAFT und kann sich aendern — ` +
              'ein Jahresabschluss laesst sich sonst nicht fixieren.',
      });
    }

    const verstoesse = pruefungen.filter((p) => !p.bestanden);
    if (verstoesse.length > 0) {
      throw new ConflictException({
        message:
          'Der Jahresabschluss ist noch nicht vollstaendig. ' +
          '§ 314 HGB verlangt Bilanz, GuV und Anhang in abgeschlossener Fassung.',
        pruefungen: verstoesse,
      });
    }

    // --- Saldoabgleich: SPERRE mit schriftlich begruendetem Ausweg ---
    //
    // ENTSCHEIDUNG 2026-10-20 (Nachtrag 59, Entscheidung 1): Der
    // Saldoabgleich war eine **Meldung** — die Abweichung zwischen `A.V.`
    // (Bilanz) und dem GuV-Ergebnis wurde angezeigt, und der Abschluss
    // ging trotzdem durch. Ein Abschluss, dessen Bilanz nicht auf die GuV
    // aufgeht, ist aber keine Bilanzaussage.
    //
    // Die Sperre hat einen Ausweg, weil es einen realen Grund fuer die
    // Abweichung gibt: Kapitalerhoehungen und Entnahmen verschieben den
    // Saldo, ohne in der GuV zu erscheinen — das Produkt erfasst solche
    // Eigenkapitalbewegungen nicht (keine Entitaet, kein Feld). Wer das
    // weiss, begruendet die Abweichung schriftlich; die Begruendung geht
    // in den Audit-Trail.
    //
    // **Die Begruendung gilt ausschliesslich fuer den Saldoabgleich.**
    // Die anderen Sperren (Bilanz geht nicht auf, GuV fehlt, Anhang mit
    // Platzhaltern, Saetze in Bearbeitung) sind davon nicht beruehrt.
    const aV = abschluss.bilanz.positionen.find(
      (p) => p.kontonummer === 'A.V.',
    );
    const bilanzJahresueberschuss = aV ? Number(aV.betragAktuell) : null;
    const guvJahresergebnis = Number(guvValidierung.jahresergebnis);
    const abweichung =
      bilanzJahresueberschuss !== null
        ? bilanzJahresueberschuss - guvJahresergebnis
        : null;

    const begruendung = dto.begruendung?.trim();
    const abweichungRelevant = abweichung !== null && Math.abs(abweichung) > 0.01;

    const warnungen: VollstaendigkeitsPruefung[] = [];
    let saldoFreigegeben = false;

    if (abweichung === null) {
      warnungen.push({
        gegenstand: 'Saldoabgleich Bilanz/GuV',
        bestanden: true,
        meldung:
          'Die Bilanz fuehrt keine Position A.V. (Jahresueberschuss); ' +
          'ein Abgleich war nicht moeglich.',
      });
    } else if (abweichungRelevant && !begruendung) {
      // SPERRE — aber mit dem Weg zur Freigabe.
      throw new ConflictException({
        message:
          'Der Saldoabgleich zwischen Bilanz und GuV weicht ab: ' +
          `Die Bilanz weist ${bilanzJahresueberschuss!.toFixed(2)} EUR als ` +
          `Jahresueberschuss aus, die GuV dagegen ${guvJahresergebnis.toFixed(2)} EUR ` +
          `— Abweichung ${abweichung.toFixed(2)} EUR. ` +
          'Das kann an Eigenkapitalbewegungen liegen (Kapitalerhoehung, Entnahme), ' +
          'die das Produkt nicht erfasst. ' +
          'Wenn das der Fall ist, kann der Abschluss mit einer schriftlichen ' +
          'Begruendung (mindestens 20 Zeichen) freigegeben werden — sie geht ' +
          'in den Audit-Trail.',
        pruefungen: [
          {
            gegenstand: 'Saldoabgleich Bilanz/GuV',
            bestanden: false,
            meldung:
              `Abweichung ${abweichung.toFixed(2)} EUR zwischen Bilanz (A.V. ` +
              `${bilanzJahresueberschuss!.toFixed(2)} EUR) und GuV-Ergebnis ` +
              `(${guvJahresergebnis.toFixed(2)} EUR).`,
          },
        ],
        abweichung,
        guvJahresergebnis,
        bilanzJahresueberschuss,
        begruendungErforderlich: true,
      });
    } else if (abweichungRelevant) {
      saldoFreigegeben = true;
      warnungen.push({
        gegenstand: 'Saldoabgleich Bilanz/GuV (freigegeben)',
        bestanden: true,
        meldung:
          `Die Bilanz weist ${bilanzJahresueberschuss!.toFixed(2)} EUR als ` +
          `Jahresueberschuss aus, die GuV dagegen ${guvJahresergebnis.toFixed(2)} EUR ` +
          `— Abweichung ${abweichung.toFixed(2)} EUR. ` +
          'FREIGEGEBEN mit schriftlicher Begruendung: ' +
          `"${begruendung}"`,
      });
    }

    const aktualisiert = await this.prisma.jahresabschluss.update({
      where: { id: abschluss.id },
      data: {
        status: 'FINALIZED',
        finalisiertAm: new Date(),
        finalizedById: user.id,
      },
    });

    await this.auditService.record({
      userId: user.id,
      mandantId,
      action: 'UPDATE',
      entityType: AbschlussService.entityName,
      entityId: aktualisiert.id,
      previousState: { status: abschluss.status },
      newState: {
        status: aktualisiert.status,
        finalisiertAm: aktualisiert.finalisiertAm?.toISOString(),
        warnungen: warnungen.map((w) => w.meldung),
        saldoabgleich: abweichung,
        // Die Ausnahme muss fuer einen Auditor sichtbar sein: ein
        // Abschluss, der **trotz** einer Abweichung durchging, ist eine
        // Ausnahme — und steht deshalb im Audit-Trail, mit der
        // Begruendung, die sie getragen hat.
        ...(saldoFreigegeben
          ? {
              saldoabgleichFreigegeben: {
                abweichung,
                begruendung,
                freigegebenVon: user.id,
              },
            }
          : {}),
      } as unknown as Prisma.JsonValue,
      ipAddress: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    this.logger.log(
      `Jahresabschluss abgeschlossen: ${mandant.firmenname} GJ ${aktualisiert.geschaeftsjahr} -> ${aktualisiert.id}`,
    );

    return {
      id: aktualisiert.id,
      status: aktualisiert.status,
      finalisiertAm: aktualisiert.finalisiertAm?.toISOString() ?? null,
      pruefungen,
      warnungen,
      saldoabgleich: {
        berechenbar: abweichung !== null,
        bilanzJahresueberschuss,
        guvJahresergebnis,
        abweichung,
        hinweis:
          abweichung === null
            ? 'Ein Abgleich war nicht moeglich (keine Position A.V. in der Bilanz).'
            : Math.abs(abweichung) > 0.01
              ? saldoFreigegeben
                ? `Abweichung ${abweichung.toFixed(2)} EUR zwischen Bilanz (A.V.) und GuV — ` +
                  `FREIGEGEBEN mit Begruendung: "${begruendung}"`
                : `Abweichung ${abweichung.toFixed(2)} EUR zwischen Bilanz (A.V.) und GuV. ` +
                  'Kann an Eigenkapitalbewegungen liegen — das Produkt erfasst sie nicht.'
              : 'Bilanz und GuV stimmen ueberein.',
        freigegeben: saldoFreigegeben,
        ...(saldoFreigegeben ? { begruendung } : {}),
      },
    };
  }

  /**
   * Meldet die **externe** Einreichung beim Bundesanzeiger.
   *
   * BEFUND 2026-10-20 (Nachtrag 62, TODO-8.10): `SIGNED -> SUBMITTED ->
   * PUBLISHED` hatten keinen Schreibpfad — das Modell versprach eine
   * Zustandsmaschine, die es nicht gab.
   *
   * ## Was hier passiert — und was ausdruecklich nicht
   *
   * Die Anwendung **reicht nichts beim Bundesanzeiger ein.** Es gibt keine
   * oeffentliche Submission-API des Verlags (siehe `MILESTONE-4.md`:
   * „Submission via eBilanz-Online + DATEV, **nicht direkt**"), und der
   * Portalzugang mit Vorgangsnummer und Gebuehren ist extern
   * (`JAHRESABSCHLUSS-MODUL-PLAN.md`, Schritt 4).
   *
   * Was hier passiert: die Kanzlei hat **drauessen** etwas getan (Datei in
   * ERiC/eBilanz-Online importiert und an das Finanzamt gesendet) und
   * traegt hier die **Bestellnummer** nach, die das Portal zurueckgegeben
   * hat. Der Datensatz macht damit belegbar, **was** eingereicht wurde und
   * **unter welcher Vorgangsnummer**.
   *
   * Ohne die Bestellnummer waere der Statuswechsel eine Behauptung — deshalb
   * ist sie Pflicht (DTO) und muss eindeutig sein (UNIQUE + 409).
   *
   * ## Wer darf das
   *
   * Die Kanzlei-Seite: STEUERBERATER und KANZLEI_ADMIN. **Nicht** der
   * Wirtschaftspruefer: der bescheinigt (qeS-Signatur), die Kanzlei reicht
   * ein. Ein WP, der einen Abschluss ohne Kanzlei-Beteiligung
   * veroeffentlichen koennte, waere die Vier-Augen-Kontrolle ausgehebelt.
   *
   * ## Fail-closed
   *
   * 1. Nur ein **signierter** Abschluss kann eingereicht werden (409).
   * 2. Es muss ein signiertes PDF im WORM liegen (409) — sonst gaelte der
   *    Datensatz eine Einreichung ohne Einreichungsgegenstand.
   * 3. Die Bestellnummer muss eindeutig sein (409).
   */
  async einreichen(
    id: string,
    mandantId: string,
    dto: EinreichenJahresabschlussDto,
    user: AuthUser,
    context: { ip?: string | null; userAgent?: string | null },
  ): Promise<EinreichenErgebnisDto> {
    assertMandantAccess(mandantId, user);

    const abschluss = await this.prisma.jahresabschluss.findFirst({
      where: { id, mandantId },
      select: { id: true, status: true, geschaeftsjahr: true },
    });
    if (!abschluss) throw new NotFoundException('Jahresabschluss nicht gefunden');

    // 1) Zustand: nur ein signierter Abschluss.
    if (abschluss.status !== 'SIGNED') {
      throw new ConflictException(
        'Nur ein signierter Jahresabschluss kann eingereicht werden. ' +
          `Dieser steht auf ${abschluss.status}.`,
      );
    }

    // 2) Die Daten muessen noch der **signierten Fassung** entsprechen.
    //
    // ENTSCHEIDUNG 2026-10-21 (Nachtrag 78, Frage 2 = "sperren"):
    // Fail-closed. Bisher wurde eingereicht, was im WORM lag — die
    // attestierte Fassung —, waehrend die Datenbank bereits die neuen Zahlen
    // zeigte. Damit beantwortete die Frage "was wurde veroeffentlicht?" und
    // die Frage "was steht im System?" unterschiedliche Dinge, und die
    // Nachvollziehbarkeit (§ 147 AO) war nicht mehr gegeben.
    //
    // Der Weg aus diesem Zustand ist der Korrekturvorgang: der Jahresabschluss
    // wird erneut signiert (Nachtrag 78, Frage 1 = A). Danach ist die
    // Abweichung weg und die Einreichung wieder moeglich.
    const abweichung = await pruefeAbschlussAbweichung(
      this.prisma,
      mandantId,
      id,
    );
    if (abweichung.abweichend) {
      throw new ConflictException(
        'Die Daten des Jahresabschlusses wurden nach der Signatur geaendert ' +
          `(zuletzt am ${abweichung.geaendertAm?.toISOString()}, ` +
          `signiert am ${abweichung.signiertAm?.toISOString()}). ` +
          'Eine Einreichung ist damit nicht zulaessig: veroeffentlicht wuerde ' +
          'die signierte Fassung, waehrend das System die geaenderten Zahlen ' +
          'zeigt (§ 147 AO). Bitte den Jahresabschluss erneut signieren — ' +
          'danach kann er eingereicht werden.',
      );
    }

    // 3) Die Bestellnummer muss eindeutig sein.
    const doppelt = await this.prisma.jahresabschluss.findFirst({
      where: { banzBestellnummer: dto.banzBestellnummer, NOT: { id } },
      select: { id: true, geschaeftsjahr: true },
    });
    if (doppelt) {
      throw new ConflictException(
        `Die BAnz-Bestellnummer ${dto.banzBestellnummer} ist bereits einem ` +
          `anderen Jahresabschluss zugeordnet (Geschaeftsjahr ` +
          `${doppelt.geschaeftsjahr}).`,
      );
    }

    // 4) Das signierte PDF ist die Einreichungsgrundlage.
    const signiertesPdf = await this.wormObjectRepository.findActiveByEntity(
      'ABSCHLUSS_PDF_SIGNED',
      id,
    );
    if (!signiertesPdf) {
      throw new ConflictException(
        'Es existiert kein signiertes Jahresabschluss-PDF. Ohne signierte ' +
          'Fassung gibt es nichts, was eingereicht werden koennte.',
      );
    }

    const mandant = await this.prisma.mandant.findUnique({
      where: { id: mandantId },
      select: { publishChannel: true, firmenname: true, archiviertAt: true },
    });
    if (!mandant) throw new NotFoundException('Mandant nicht gefunden');

    //
    // BEFUND 2026-10-21 (Nachtrag 76): Ein **archivierter** Mandant liess
    // sich noch zum Bundesanzeiger einreichen:
    //
    //     PATCH /api/mandant/<id>/archivierung  -> HTTP 200
    //     POST  /api/jahresabschluss/<id>/einreichen -> HTTP 200
    //     Status des Abschlusses: SUBMITTED (Bestellnummer: MESS-…)
    //     BanzSubmission-Eintraege: 1
    //
    // Die Einreichung legt einen neuen Datensatz an (BanzSubmission) und
    // schreibt den Abschluss fort (SIGNED -> SUBMITTED). Das widerspricht
    // der Archiv-Entscheidung: „Der Bestand bleibt lesbar und
    // nachvollziehbar (§ 147 AO), es entstehen **keine neuen Belege**."
    //
    // Der Signaturpfad ist gesperrt (Nachtrag 60) — aber ein Abschluss, der
    // VOR der Archivierung signiert wurde, ist SIGNED und damit einreichbar.
    assertMandantNichtArchiviert(
      mandant.archiviertAt,
      'Jahresabschluss einreichen',
    );

    // 5. Die Nutzlast haengt am **Kanal** des Mandanten.
    //
    // BEFUND 2026-10-22 (Nachtrag 86): Der Beleg trug fuer JEDEN Kanal das
    // signierte PDF — auch bei `XML_XBRL` und `EBILANZ_TAXONOMIE`. Gemessen:
    //
    //     channel       = XML_XBRL
    //     payloadFormat = PDF
    //     rawPayload[0..8] = "%PDF-1.3"
    //
    // Das PDF war bei diesem Kanal nie eingereicht worden (der E-Bilanz-Upload
    // findet laut Verfahrensdokumentation ausserhalb der Anwendung statt) —
    // der Beleg behauptete also etwas Falsches. Das Schema sagt dagegen
    // "rawPayload: Generierte XML/XBRL/PDF-Daten" und
    // "payloadFormat: XML | XBRL | PDF | ZIP".
    //
    // ENTSCHEIDUNG der Fachverantwortlichen (2026-10-23): Die beim
    // Einreichen erzeugte XBRL wird im WORM abgelegt (zehn Jahre, eigener
    // EntityType) und als Nutzlast protokolliert. Das signierte PDF bleibt
    // als Beweisdokument im WORM (dort liegt es bereits).
    const istXmlKanal =
      mandant.publishChannel === 'XML_XBRL' ||
      mandant.publishChannel === 'EBILANZ_TAXONOMIE';

    let payload: Buffer;
    let payloadFormat: string;
    let payloadHash: string;
    let payloadWormKey: string | null = null;

    if (istXmlKanal) {
      const abschluss = await this.prisma.jahresabschluss.findUnique({
        where: { id },
        select: { bilanzId: true, guvId: true, anhangId: true },
      });
      if (!abschluss) throw new NotFoundException('Jahresabschluss nicht gefunden');

      // Die XBRL wird HIER erzeugt — nach der Abweichungspruefung oben. Die
      // Daten entsprechen damit der signierten Fassung (§ 147 AO): die
      // Nutzlast, die protokolliert wird, ist die Fassung, die der Kanzlei
      // zur Einreichung gedient hat.
      const xbrl = await this.xbrlGenerator.generateUndArchivieren(
        {
          mandantId,
          bilanzId: abschluss.bilanzId,
          guvId: abschluss.guvId,
          anhangId: abschluss.anhangId,
          jahresabschlussId: id,
        },
        user,
        { ip: context.ip ?? null, userAgent: context.userAgent ?? null },
      );
      payload = xbrl.bytes;
      payloadFormat = 'XBRL';
      payloadHash = xbrl.sha256Hash;
      payloadWormKey = xbrl.wormObjectKey;
    } else {
      payload = await this.storageService.downloadFromWorm(
        signiertesPdf.objectKey,
      );
      payloadFormat = 'PDF';
      payloadHash = signiertesPdf.sha256Hash;
    }

    const jetzt = new Date();
    let submissionId: string;
    try {
      // Der Submission-Datensatz und der Statuswechsel gehoeren zusammen:
      // entweder existiert der Einreichungsbeleg **und** der Abschluss steht
      // auf SUBMITTED — oder nichts von beidem.
      const ergebnis = await this.prisma.$transaction(async (tx) => {
        const submission = await tx.banzSubmission.create({
          data: {
            jahresabschlussId: id,
            mandantId,
            channel: mandant.publishChannel,
            status: 'SUBMITTED',
            submittedAt: jetzt,
            banzBestellnummer: dto.banzBestellnummer,
            rawPayload: payload,
            payloadFormat,
            payloadHash,
            createdById: user.id,
          },
          select: { id: true },
        });
        await tx.jahresabschluss.update({
          where: { id },
          data: {
            status: 'SUBMITTED',
            eingereichtAm: jetzt,
            banzBestellnummer: dto.banzBestellnummer,
          },
        });
        return submission;
      });
      submissionId = ergebnis.id;
    } catch (err) {
      // Die Datenbank erzwingt die Eindeutigkeit der Bestellnummer. Wer
      // gleichzeitig einreicht, bekommt einen 409 — kein 500.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          `Diese BAnz-Bestellnummer ist bereits vergeben: ${dto.banzBestellnummer}`,
        );
      }
      throw err;
    }

    await this.auditService.record({
      userId: user.id,
      mandantId,
      jahresabschlussId: id,
      action: 'UPDATE',
      entityType: AbschlussService.entityName,
      entityId: id,
      previousState: { status: abschluss.status },
      newState: {
        status: 'SUBMITTED',
        eingereichtAm: jetzt.toISOString(),
        banzBestellnummer: dto.banzBestellnummer,
        channel: mandant.publishChannel,
        submissionId,
        payloadFormat,
        payloadHash,
        payloadGroesse: payload.length,
        // Bei XML-Kanaelen: der WORM-Schluessel der eingereichten Datei.
        // Das signierte PDF bleibt davon unberuehrt im WORM (Beweisdokument).
        payloadWormKey,
      } as unknown as Prisma.JsonValue,
      ipAddress: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    this.logger.log(
      `Jahresabschluss eingereicht: ${mandant.firmenname} GJ ` +
        `${abschluss.geschaeftsjahr} -> ${id} (Vorgang ${dto.banzBestellnummer})`,
    );

    return {
      id,
      status: 'SUBMITTED',
      eingereichtAm: jetzt.toISOString(),
      banzBestellnummer: dto.banzBestellnummer,
      channel: mandant.publishChannel,
      submissionId,
      payloadFormat,
      payloadHash,
    };
  }

  /**
   * Meldet die Veroeffentlichung im Bundesanzeiger.
   *
   * BEFUND 2026-10-20 (Nachtrag 62, TODO-8.10): `veroeffentlichtAm` war
   * unbeschrieben — der letzte Schritt der Zustandsmaschine fehlte.
   *
   * Wie bei `einreichen()`: Die Anwendung veroeffentlicht **nicht** selbst.
   * Sie protokolliert, dass der Bundesanzeiger veroeffentlicht hat — der
   * Kanzlei sieht das im Portal und meldet es hier.
   *
   * Fail-closed: Nur ein **eingereichter** Abschluss kann veroeffentlicht
   * werden (409). Ohne Einreichung gibt es nichts zu veroeffentlichen.
   */
  async veroeffentlichen(
    id: string,
    mandantId: string,
    user: AuthUser,
    context: { ip?: string | null; userAgent?: string | null },
  ): Promise<VeroeffentlichenErgebnisDto> {
    assertMandantAccess(mandantId, user);

    const abschluss = await this.prisma.jahresabschluss.findFirst({
      where: { id, mandantId },
      select: { id: true, status: true, geschaeftsjahr: true, banzBestellnummer: true },
    });
    if (!abschluss) throw new NotFoundException('Jahresabschluss nicht gefunden');

    if (abschluss.status !== 'SUBMITTED') {
      throw new ConflictException(
        'Nur ein eingereichter Jahresabschluss kann als veroeffentlicht ' +
          `gemeldet werden. Dieser steht auf ${abschluss.status}.`,
      );
    }

    //
    // BEFUND 2026-10-21 (Nachtrag 76): dieselbe Archiv-Sperre wie beim
    // Einreichen — ein archivierter Mandant darf nicht veroeffentlicht
    // werden (siehe dort die Messung).
    const mandant = await this.prisma.mandant.findUnique({
      where: { id: mandantId },
      select: { archiviertAt: true },
    });
    if (!mandant) throw new NotFoundException('Mandant nicht gefunden');
    assertMandantNichtArchiviert(
      mandant.archiviertAt,
      'Jahresabschluss als veroeffentlicht melden',
    );

    const jetzt = new Date();
    const aktualisiert = await this.prisma.$transaction(async (tx) => {
      await tx.banzSubmission.updateMany({
        where: { jahresabschlussId: id, status: 'SUBMITTED' },
        data: { status: 'PUBLISHED' },
      });
      return tx.jahresabschluss.update({
        where: { id },
        data: { status: 'PUBLISHED', veroeffentlichtAm: jetzt },
        select: { status: true, veroeffentlichtAm: true },
      });
    });

    await this.auditService.record({
      userId: user.id,
      mandantId,
      jahresabschlussId: id,
      action: 'UPDATE',
      entityType: AbschlussService.entityName,
      entityId: id,
      previousState: { status: abschluss.status },
      newState: {
        status: aktualisiert.status,
        veroeffentlichtAm: aktualisiert.veroeffentlichtAm?.toISOString(),
        banzBestellnummer: abschluss.banzBestellnummer,
      } as unknown as Prisma.JsonValue,
      ipAddress: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return {
      id,
      status: aktualisiert.status,
      veroeffentlichtAm: aktualisiert.veroeffentlichtAm?.toISOString() ?? null,
      banzBestellnummer: abschluss.banzBestellnummer,
    };
  }

  /**
   * Antwortform des Jahresabschlusses.
   *
   * Die Felder `bilanzsumme`, `guvErgebnis`, `abgeschlossenAm` und
   * `wormObjectKey` entsprechen dem Vertrag, den die Oberflaeche
   * (`JahresabschlussView`) seit Anfang an erwartet. Sie werden ueber die
   * vorhandenen `validate()`-Methoden der Fachservices berechnet — die
   * Arithmetik (Summen, GuV-Ergebnis, Toleranz) bleibt damit an EINER Stelle.
   */
  private async toResponse(
    a: {
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
    },
    user: AuthUser,
  ) {
    const [bilanzValidierung, guvValidierung, worm] = await Promise.all([
      this.bilanzService.validate(a.bilanzId, a.mandantId, user),
      this.guvService.validate(a.guvId, a.mandantId, user),
      this.wormObjectRepository.findActiveByEntity(
        'ABSCHLUSS_PDF_SIGNED',
        a.id,
      ),
    ]);

    return {
      id: a.id,
      mandantId: a.mandantId,
      geschaeftsjahr: a.geschaeftsjahr,
      bilanzId: a.bilanzId,
      guvId: a.guvId,
      anhangId: a.anhangId,
      status: a.status,
      // Vertragsnamen der Oberflaeche:
      bilanzsumme: bilanzValidierung.aktivaSumme,
      guvErgebnis: guvValidierung.jahresergebnis,
      abgeschlossenAm: a.finalisiertAm?.toISOString() ?? null,
      signiertAm: a.signiertAm?.toISOString() ?? null,
      wormObjectKey: worm?.objectKey ?? null,
      // Ergaenzungen:
      finalisiertAt: a.finalisiertAm?.toISOString() ?? null,
      eingereichtAm: a.eingereichtAm?.toISOString() ?? null,
      veroeffentlichtAm: a.veroeffentlichtAm?.toISOString() ?? null,
      banzBestellnummer: a.banzBestellnummer,
      createdAt: a.createdAt.toISOString(),
    };
  }

}
