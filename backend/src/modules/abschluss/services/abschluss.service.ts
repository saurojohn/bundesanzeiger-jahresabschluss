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
import { CreateJahresabschlussDto } from '../dto/create-jahresabschluss.dto';
import {
  FinalizeErgebnisDto,
  FinalizeJahresabschlussDto,
  VollstaendigkeitsPruefung,
} from '../dto/finalize-jahresabschluss.dto';
import { BilanzService } from '../../bilanz/services/bilanz.service';
import { GuVService } from '../../guv/services/guv.service';
import { AnhangService } from '../../anhang/services/anhang.service';
import { WormObjectRepository } from '../../storage/repositories/worm-object.repository';
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
    const offenePlatzhalter = this.anhangService.offenePlatzhalter(
      abschluss.anhang.abschnitte,
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
