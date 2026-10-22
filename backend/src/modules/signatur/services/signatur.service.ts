import type { Prisma } from '@prisma/client';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { plainAddPlaceholder } from '@signpdf/placeholder-plain';
import signpdf from '@signpdf/signpdf';
import { P12Signer } from '@signpdf/signer-p12';
import { createHash } from 'node:crypto';
import {
  assessCertificateTrust,
  verifyPdfSignature,
} from '../utils/pdf-signature-verify';
import { checkCertificateRevocation } from '../utils/crl-checker';
import {
  parseTimestampToken,
  checkTimestampPlausibility,
  verifyTimestampSignature,
  type ParsedTimestamp,
} from '../utils/timestamp-token.parser';
import { AuditService } from '../../audit/services/audit.service';
import { PdfService } from '../../pdf/services/pdf.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { SignatureRepository } from '../../../common/repositories/signature.repository';
import { BilanzRepository } from '../../../common/repositories/bilanz.repository';
import { GuVRepository } from '../../../common/repositories/guv.repository';
import { AnhangRepository } from '../../../common/repositories/anhang.repository';
import { StorageService } from '../../storage/services/storage.service';
import { WormObjectRepository } from '../../storage/repositories/worm-object.repository';
import type { AuthUser } from '../../auth/types/auth-user.types';
import type {
  SignatureResult,
  SignatureType,
  ValidationResult,
} from '../interfaces/signature.types';
import type { SignaturEintragDto } from '../dto/signatur-liste.dto';
import type { SignaturStatusDto } from '../dto/signatur-status.dto';
import { P12Service } from './p12.service';
import type { LegalValidity } from '../interfaces/signature.types';
import { TsaClientService } from './tsa-client.service';
import { assertMandantNichtArchiviert } from '../../../common/utils/mandant-archivierung';
import { assertMandantAccess } from '../../../common/utils/mandant-zugriff';
import { assertRolleAufMandant } from '../../../common/utils/mandant-rolle';
import { ladeBestandteilZeitpunkt } from '../../../common/utils/signatur-abweichung';

/**
 * Request-Context für Signatur-Endpoints.
 *
 * Wird aus dem Express-Request extrahiert (IP + UserAgent) und im
 * Audit-Log persistiert.
 */
export interface SignaturServiceContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Domain-Typ, der angibt, welche Art von Dokument signiert wurde.
 *
 * Wird im Audit-Log + Manifest gespeichert.
 */
export type SignedEntityType = 'Bilanz' | 'GuV' | 'Anhang' | 'Abschluss';

/**
 * Gemeinsame Argumente für alle Signatur-Methoden.
 */
interface SignArgs {
  bilanzId?: string;
  guvId?: string;
  anhangId?: string;
  jahresabschlussId?: string;
  mandantId: string;
  p12Base64: string;
  p12Password: string;
  signatureType?: SignatureType;
  includeTimestamp?: boolean;
}

/**
 * Service für qualifizierte elektronische Signaturen (qeS).
 *
 * Workflow (analog für Bilanz / GuV / Anhang / Abschluss):
 *   1. Mandant-Zugriff prüfen
 *   2. P12-Token-Metadaten lesen (Subject/Issuer/Validität) + Passwort validieren
 *   3. PDF generieren via PdfService (oder aus existierendem WORM-Objekt)
 *   4. SHA-256 vor Signatur berechnen
 *   5. Signatur-Stub (Placeholder) in PDF einfügen + P12-Signatur anwenden
 *   6. Optional: TSA-Zeitstempel (Mock für Dev, echt in M3)
 *   7. SHA-256 nach Signatur berechnen
 *   8. Signiertes PDF in WORM-Storage hochladen (10 Jahre Retention)
 *   9. Signature-Record in DB schreiben (append-only)
 *  10. Audit-Trail-Eintrag mit Cert-Metadaten + Hashes
 *
 * Sicherheits-Constraints:
 *   - P12 NIEMALS persistieren — Buffer wird nach Request verworfen
 *   - Audit-Trail enthält Cert-Subject (NICHT den Key)
 *   - WORM-Storage mit Object-Lock COMPLIANCE (GoBD § 147 AO)
 *   - Mandant-Trennung über AuthUser.mandanten + SYSTEM_ADMIN-Bypass
 */
@Injectable()
export class SignaturService {
  private readonly logger = new Logger(SignaturService.name);

  /**
   * Vom Betreiber hinterlegte, als vertrauenswürdig geltende Aussteller.
   * Leer = fail-closed: es wird NICHTS als vertrauenswürdig anerkannt.
   * (Früher galt jeder Issuer als vertrauenswürdig.)
   */
  private readonly trustedIssuers: readonly string[];

  /**
   * Selbstsignierte Zertifikate zulassen.
   *
   * Standardmäßig **false** — ein selbstsigniertes Zertifikat ist kein
   * Nachweis der Urheberschaft. Nur für lokale Testumgebungen zu aktivieren
   * (SIGNATURE_ALLOW_SELF_SIGNED=true); im Pilot muss der Aussteller über
   * SIGNATURE_TRUSTED_ISSUERS eingetragen werden.
   */
  private readonly allowSelfSignedCertificates: boolean;

  /**
   * Sperrlistenpruefung (CRL) erzwingen.
   *
   * Standardmaessig **aus**: im Pilot laeuft der Signaturpfad mit einem
   * selbstsignierten Testzertifikat ohne CRL-Endpoint. Wird die Pruefung
   * erzwungen und die CRL ist nicht erreichbar, gilt der Sperrstatus als
   * unbekannt und das Zertifikat als nicht vertrauenswuerdig (fail-closed).
   */
  private readonly requireRevocationCheck: boolean;
  private readonly tsaUrl: string | undefined;
  private readonly tsaUser: string | undefined;
  private readonly tsaPwd: string | undefined;

  constructor(
    private readonly pdfService: PdfService,
    private readonly bilanzRepository: BilanzRepository,
    private readonly guvRepository: GuVRepository,
    private readonly anhangRepository: AnhangRepository,
    private readonly p12Service: P12Service,
    private readonly tsaClient: TsaClientService,
    private readonly storageService: StorageService,
    private readonly wormObjectRepository: WormObjectRepository,
    private readonly auditService: AuditService,
    private readonly signatureRepository: SignatureRepository,
    private readonly prisma: PrismaService,
    configService: ConfigService,
  ) {
    // ConfigService wird nur einmal beim Start gelesen, nicht als
    // Field gespeichert (kein späterer Zugriff nötig).
    this.trustedIssuers = (configService.get<string>('SIGNATURE_TRUSTED_ISSUERS') ?? '')
      .split(',')
      .map((i) => i.trim())
      .filter((i) => i.length > 0);
    this.allowSelfSignedCertificates =
      (configService.get<string>('SIGNATURE_ALLOW_SELF_SIGNED') ?? 'false').toLowerCase() ===
      'true';
    if (this.allowSelfSignedCertificates) {
      this.logger.warn(
        'SIGNATURE_ALLOW_SELF_SIGNED=true — selbstsignierte Zertifikate werden akzeptiert. Nur fuer Testumgebungen.',
      );
    }
    this.requireRevocationCheck =
      (configService.get<string>('SIGNATURE_REQUIRE_REVOCATION_CHECK') ?? 'false')
        .toLowerCase() === 'true';
    if (this.trustedIssuers.length === 0) {
      this.logger.warn(
        'SIGNATURE_TRUSTED_ISSUERS ist leer — es wird kein Signaturzertifikat als vertrauenswürdig anerkannt (fail-closed).',
      );
    }

    this.tsaUrl = configService.get<string>('TSA_URL') ?? undefined;
    this.tsaUser = configService.get<string>('TSA_USER') ?? undefined;
    this.tsaPwd = configService.get<string>('TSA_PWD') ?? undefined;
  }

  // ===========================================================================
  // Public API: Signatur-Endpoints
  // ===========================================================================

  /**
   * Signiert ein Bilanz-PDF.
   */
  async signBilanz(
    args: SignArgs,
    user: AuthUser,
    context: SignaturServiceContext,
  ): Promise<SignatureResult> {
    if (!args.bilanzId) {
      throw new BadRequestException('bilanzId erforderlich');
    }
    return this.signInternal(
      args,
      'Bilanz',
      args.bilanzId,
      user,
      context,
      (pdfArgs) =>
        this.pdfService.generateBilanzPdf(
          pdfArgs.entityId,
          pdfArgs.mandantId,
          user,
          {
            ip: pdfArgs.ip ?? null,
            userAgent: pdfArgs.userAgent ?? null,
          },
        ),
    );
  }

  /**
   * Signatur-Status einer Entitaet — die Sichtbarkeitshaelfte der
   * Entscheidung vom 2026-10-14 (nicht sperren, sondern anzeigen).
   *
   * Massgeblich ist der Zeitvergleich: Signatur-Record `createdAt` gegen
   * `updatedAt` der Entitaet. Liegt die Entitaet spaeter, wurde nach der
   * Signatur geaendert — dann sind die vorgelegten Daten NICHT die signierte
   * Fassung. Die signierte Fassung selbst bleibt im WORM-Speicher
   * unveraendert erhalten (§ 147 AO).
   *
   * Der Vergleich nutzt bewusst den Signatur-Record und NICHT den Zeitstempel
   * der Signatur: ohne TSA ist `zeitstempel` der Mock-Zeitpunkt, und der
   * DB-Zeitpunkt des Records ist der einzige Wert, der unabhängig von einer
   * externen Zeitquelle stimmt.
   */
  async getSignaturStatus(
    entityType: SignedEntityType,
    entityId: string,
    mandantId: string,
    user: AuthUser,
  ): Promise<SignaturStatusDto> {
    assertMandantAccess(mandantId, user);
    await this.assertEntityExists(entityType, entityId, mandantId);

    const signaturen = await this.signatureRepository.findByEntity(
      entityType,
      entityId,
    );

    // BEFUND 2026-10-20 (Nachtrag 60, TODO-8.15): Fuer einen
    // **Jahresabschluss** entscheidet nur die Abschluss-Signatur ueber den
    // Status. Eine gepruefte GuV ist keine Endabnahme.
    //
    // Vorher war das nicht unterscheidbar: die Signatur eines gebundenen
    // Bestandteils lag auf der Abschluss-Achse und wurde damit als
    // Abschluss-Signatur gelesen — der Abschluss zeigte "SIGNIERT", obwohl
    // nur die GuV geprueft war.
    const istAbschluss = entityType === 'Abschluss';
    const abschlussSignaturen = istAbschluss
      ? signaturen.filter((s) => s.signaturEbene === 'ABSCHLUSS')
      : signaturen;
    const bestandteilPruefungen = istAbschluss
      ? signaturen.filter((s) => s.signaturEbene !== 'ABSCHLUSS')
      : [];

    const letzte = abschlussSignaturen[0] ?? null;

    const basis: SignaturStatusDto = {
      entityType,
      entityId,
      status: 'UNSIGNIERT',
      signiertAm: letzte?.createdAt.toISOString() ?? null,
      signiertVon: letzte?.userId ?? null,
      signaturTyp: letzte?.signaturTyp ?? null,
      hashNachher: letzte?.hashNachher ?? null,
      signedPdfWormKey: null,
      entitaetGeaendertAm: null,
      geaendertNachSignatur: false,
      anzahlSignaturen: abschlussSignaturen.length,
      signaturEbene: letzte?.signaturEbene === 'ABSCHLUSS' ? 'ABSCHLUSS' : 'BESTANDTEIL',
      anzahlBestandteilPruefungen: bestandteilPruefungen.length,
      hinweis: 'Dieses Dokument wurde noch nicht signiert.',
    };

    if (!letzte) {
      if (bestandteilPruefungen.length > 0) {
        return {
          ...basis,
          hinweis:
            `Der Jahresabschluss ist NICHT signiert. Geprueft wurden bisher ` +
            `${bestandteilPruefungen.length} Bestandteil(e) — eine Bestandteilpruefung ` +
            'ist keine Endabnahme (§ 146 AO, Vier-Augen-Kontrolle).',
        };
      }
      return basis;
    }

    // `updatedAt` der Entitaet mandanten-filtert laden.
    const geaendertAm = await this.entitaetUpdatedAt(entityType, entityId, mandantId);
    const geaendertNachSignatur = geaendertAm !== null && geaendertAm > letzte.createdAt;

    // WORM-Schlüssel des signierten Dokuments (fuer den Download).
    const worm = await this.wormObjectRepository.findActiveByEntity(
      this.entityTypeForSigned(entityType),
      entityId,
    );

    return {
      ...basis,
      status: geaendertNachSignatur ? 'ABWEICHEND' : 'SIGNIERT',
      entitaetGeaendertAm: geaendertAm?.toISOString() ?? null,
      geaendertNachSignatur,
      signedPdfWormKey: worm?.objectKey ?? null,
      hinweis: geaendertNachSignatur
        ? 'ACHTUNG: Dieses Dokument wurde nach der Signatur geaendert. ' +
          'Die hier angezeigten Daten entsprechen NICHT der signierten Fassung. ' +
          'Die signierte Fassung liegt unveraendert im WORM-Speicher ' +
          'und muss vor einer Vorlage beim Finanzamt verwendet werden.'
        : `Dokument ist signiert (${letzte.createdAt.toISOString()}) und seitdem unveraendert.`,
    };
  }

  /**
   * `updatedAt` der Entitaet, mandantengefiltert.
   *
   * BEFUND 2026-10-21 (Nachtrag 77): Fuer den **Jahresabschluss** ist das
   * eigene `updatedAt` das falsche Mass. Die Signatur setzt selbst den
   * Status auf `SIGNED` (`jahresabschluss.update` in `signAbschluss`) —
   * dieser Schreibvorgang liegt **nach** dem Anlegen des Signaturdatensatzes
   * und damit **nach** `letzte.createdAt`. Der Vergleich
   * `geaendertAm > letzte.createdAt` war deshalb bei **jedem** signierten
   * Jahresabschluss wahr:
   *
   *     GET /api/signatur/status?entityType=Abschluss&entityId=…
   *     -> status=ABWEICHEND, geaendertNachSignatur=true
   *
   * Gemessen unmittelbar nach der Signatur, **ohne jede Aenderung an den
   * Daten**. Der Hinweis war damit falsch ("die hier angezeigten Daten
   * entsprechen NICHT der signierten Fassung"), und der Indikator war
   * dauerhaft rot. Ein dauerhaft roter Indikator traegt keine Information —
   * eine echte Abweichung (Anhang nach der Signatur geaendert) faellt nicht
   * mehr auf, weil sie neben dem Dauerfehler verschwindet. Damit war die
   * Sichtbarkeitspflicht aus der Entscheidung vom 2026-10-14 ("es muss
   * sichtbar sein, wenn die vorgelegten Daten nicht mehr der signierten
   * Fassung entsprechen") **nicht erfuellbar**.
   *
   * **Die Regel jetzt:** der Jahresabschluss ist ein Aggregat; die signierte
   * Fassung ist ein PDF ueber Bilanz + GuV + Anhang. Geprueft wird deshalb
   * der Aktualisierungszeitpunkt der **Bestandteile** — das ist die
   * Datenbasis der signierten Fassung. Der eigene `updatedAt` des
   * Jahresabschlusses beschreibt seinen Arbeitsstatus
   * (FINALIZED -> SIGNED -> SUBMITTED -> PUBLISHED), nicht die Daten.
   *
   * Die Bestandteile selbst sind unveraendert: ihr `updatedAt` bewegt sich
   * nur durch echte Aenderungen (Positionen, Abschnitte, Methoden, Status) —
   * die Signatur fasst sie nicht an.
   */
  private async entitaetUpdatedAt(
    entityType: SignedEntityType,
    entityId: string,
    mandantId: string,
  ): Promise<Date | null> {
    const where = { id: entityId, mandantId };
    switch (entityType) {
      case 'Bilanz':
        return (await this.prisma.bilanz.findFirst({ where, select: { updatedAt: true } }))?.updatedAt ?? null;
      case 'GuV':
        return (await this.prisma.guV.findFirst({ where, select: { updatedAt: true } }))?.updatedAt ?? null;
      case 'Anhang':
        return (await this.prisma.anhang.findFirst({ where, select: { updatedAt: true } }))?.updatedAt ?? null;
      case 'Abschluss': {
        const abschluss = await this.prisma.jahresabschluss.findFirst({
          where,
          select: { bilanzId: true, guvId: true, anhangId: true },
        });
        if (!abschluss) return null;
        // Die Berechnung selbst liegt in `common/utils/signatur-abweichung.ts`
        // — dieselbe, die die Einreichungssperre benutzt (Nachtrag 78).
        return ladeBestandteilZeitpunkt(this.prisma, mandantId, abschluss);
      }
      default:
        return null;
    }
  }

  /**
   * Signatur-Übersicht einer Entität, neueste zuerst.
   *
   * BEFUND 2026-10-13: Die `signatureId` aus `sign-*` war bis dahin über
   * keinen Endpunkt auffindbar — und im Entitätenpfad war der Datensatz gar
   * nicht erst angelegt. Dieser Weg macht beide Korrekturen nutzbar.
   *
   * Der Tenant wird doppelt geprüft: die Entität muss im übergebenen Mandanten
   * liegen (`assertEntityExists`, mandant-gefiltert) UND der User muss auf
   * diesen Mandanten Zugriff haben (`assertMandantAccess`). Ein fehlender
   * Scope bedeutet Ablehnung, nicht "kein Filter".
   */
  async listSignaturen(
    entityType: SignedEntityType,
    entityId: string,
    mandantId: string,
    user: AuthUser,
  ): Promise<SignaturEintragDto[]> {
    assertMandantAccess(mandantId, user);
    await this.assertEntityExists(entityType, entityId, mandantId);

    const eintraege = await this.signatureRepository.findByEntity(
      entityType,
      entityId,
    );
    return eintraege.map((s) => ({
      id: s.id,
      entityType: s.entityType,
      entityId: s.entityId,
      jahresabschlussId: s.jahresabschlussId,
      signaturEbene: s.signaturEbene,
      signaturTyp: s.signaturTyp,
      zeitstempel: s.zeitstempel.toISOString(),
      zeitstempelIssuer: s.zeitstempelIssuer,
      rolle: s.rolle,
      userId: s.userId,
      zertifikatSubject: s.zertifikatSubject,
      zertifikatIssuer: s.zertifikatIssuer,
      zertifikatSeriennummer: s.zertifikatSeriennummer,
      zertifikatGueltigAb: s.zertifikatGueltigAb?.toISOString() ?? null,
      zertifikatGueltigBis: s.zertifikatGueltigBis?.toISOString() ?? null,
      hashVorher: s.hashVorher,
      hashNachher: s.hashNachher,
      signaturFormat: s.signaturFormat,
      createdAt: s.createdAt.toISOString(),
    }));
  }

  /**
   * Signiert ein GuV-PDF.
   */
  async signGuV(
    args: SignArgs,
    user: AuthUser,
    context: SignaturServiceContext,
  ): Promise<SignatureResult> {
    if (!args.guvId) {
      throw new BadRequestException('guvId erforderlich');
    }
    return this.signInternal(
      args,
      'GuV',
      args.guvId,
      user,
      context,
      (pdfArgs) =>
        this.pdfService.generateGuVPdf(
          pdfArgs.entityId,
          pdfArgs.mandantId,
          user,
          {
            ip: pdfArgs.ip ?? null,
            userAgent: pdfArgs.userAgent ?? null,
          },
        ),
    );
  }

  /**
   * Signiert ein Anhang-PDF.
   */
  async signAnhang(
    args: SignArgs,
    user: AuthUser,
    context: SignaturServiceContext,
  ): Promise<SignatureResult> {
    if (!args.anhangId) {
      throw new BadRequestException('anhangId erforderlich');
    }
    return this.signInternal(
      args,
      'Anhang',
      args.anhangId,
      user,
      context,
      (pdfArgs) =>
        this.pdfService.generateAnhangPdf(
          pdfArgs.entityId,
          pdfArgs.mandantId,
          user,
          {
            ip: pdfArgs.ip ?? null,
            userAgent: pdfArgs.userAgent ?? null,
          },
        ),
    );
  }

  /**
   * Signiert einen kompletten Jahresabschluss (Bilanz + GuV + Anhang).
   *
   * BEFUND 2026-10-17 (Nachtrag 35): Dieser Weg war bis eben nicht
   * erreichbar — es gab keinen Jahresabschluss (Nachtrag 27). Mit dem
   * Abschluss-Modul wurde er aktiv, und er war ungeprueft: **eine
   * qeS-Signatur auf einem `DRAFT`-Abschluss war moeglich.** Gemessen
   * ueber die oeffentliche API:
   *
   *     status = DRAFT, abgeschlossenAm = null
   *     POST /api/signatur/sign-abschluss  -> 200, signatureId 533ae411-…
   *
   * Eine qualifizierte elektronische Signatur bescheinigt die
   * *Vollstaendigkeit* eines Dokuments (§ 126 BGB). Sie auf einen Abschluss
   * zu setzen, der nie abgeschlossen wurde, ist unter keiner Lesart
   * vertretbar — und weil das signierte PDF anschliessend mit
   * COMPLIANCE-Object-Lock fuer 10 Jahre in WORM liegt, ist der
   * Schaden nicht ruecknehmbar.
   *
   * Warum die Sperre hier und nicht in `signInternal`: Bilanz, GuV und
   * Anhang werden auch im `DRAFT` signiert — dort bescheinigt die
   * Signatur die *Sichtung*, nicht den Abschluss. Das ist eine andere
   * Bedeutung und darf nicht mitverstreckt werden. Die Regel „ein
   * Jahresabschluss wird erst nach dem Abschluss signiert" gehoert
   * darum an diese eine Stelle.
   *
   * Bewusst NICHT erfunden: eine vollstaendige Zustandsmaschine fuer
   * `SIGNED -> SUBMITTED -> PUBLISHED`. Diese Uebergaenge haben bis heute
   * keinen Schreibpfad (siehe Nachtrag 35) und sind eine Fachentscheidung.
   */
  async signAbschluss(
    args: SignArgs,
    user: AuthUser,
    context: SignaturServiceContext,
  ): Promise<SignatureResult> {
    if (!args.jahresabschlussId) {
      throw new BadRequestException('jahresabschlussId erforderlich');
    }

    // 1) Vorbedingung: der Abschluss muss abgeschlossen sein.
    //
    // Der Guard laeuft zwar vorher, aber `assertMandantAccess` ist — wie
    // beim Jahresabschluss-Service gemessen (Nachtrag 34) — ueber HTTP
    // nicht der Weg, der hier traegt. Die Pruefung auf den **Zustand**
    // gibt es an keiner anderen Stelle; sie muss hier stehen, sonst
    // entscheidet gar nichts darueber.
    const abschluss = await this.prisma.jahresabschluss.findFirst({
      where: { id: args.jahresabschlussId, mandantId: args.mandantId },
      select: { id: true, status: true, finalisiertAm: true, bilanzId: true },
    });
    if (!abschluss) {
      throw new NotFoundException('Jahresabschluss nicht gefunden');
    }
    // ENTSCHEIDUNG 2026-10-21 (Nachtrag 78): Ein Abschluss im Status
    // SIGNED darf **erneut** signiert werden — das ist der Korrekturweg.
    //
    // Die Entscheidung der Fachverantwortlichen vom 2026-10-14 sagt:
    // "Ein Korrekturvorgang erzeugt zwingend eine neue Signatur, und der alte
    // WORM-Satz darf nicht gelöscht werden." Bis eben war das fuer den
    // Jahresabschluss unmoeglich: das Status-Gate erlaubte nur FINALIZED,
    // nach der ersten Signatur stand der Abschluss auf SIGNED — und der
    // Ausweg ueber einen "neuen Abschluss als Korrektur" (so der Text im
    // Finalize-Fehler) war durch den Unique-Constraint (mandantId,
    // geschaeftsjahr) blockiert. Ein geaenderter Bestandteil nach der
    // Signatur fuehrte damit in einen Zustand, aus dem man nicht mehr
    // herauskam.
    //
    // Jetzt: SIGNED (erneute Signatur) und FINALIZED (Erstsignatur) sind
    // zulaessig. Der WORM behaelt beide Fassungen — jede Signatur legt ein
    // eigenes WORM-Objekt an — und die **juengste** gilt
    // (`findActiveByEntity` sortiert nach `uploadedAt` desc).
    //
    // DRAFT bleibt gesperrt: "eine Signatur auf einen unfertigen Abschluss
    // bescheinigt eine Vollstaendigkeit, die es nicht gibt". Ebenso
    // SUBMITTED/PUBLISHED — ein eingereichter Abschluss ist veroeffentlicht.
    if (abschluss.status !== 'FINALIZED' && abschluss.status !== 'SIGNED') {
      throw new ConflictException(
        `Ein Jahresabschluss kann erst nach dem Abschluss signiert werden. ` +
          `Dieser Abschluss steht auf ${abschluss.status}` +
          `${abschluss.finalisiertAm ? '' : ' und wurde nie abgeschlossen'}. ` +
          'Bitte zuerst "Abschluss prüfen und abschliessen" ausführen — ' +
          'eine Signatur auf einen unfertigen Abschluss bescheinigt eine ' +
          'Vollständigkeit, die es nicht gibt.',
      );
    }

    // 2) Signieren.
    const ergebnis = await this.signInternal(
      args,
      'Abschluss',
      args.jahresabschlussId,
      user,
      context,
      (pdfArgs) =>
        this.pdfService.generateAbschlussPdf(
          pdfArgs.entityId,
          pdfArgs.mandantId,
          user,
          {
            ip: pdfArgs.ip ?? null,
            userAgent: pdfArgs.userAgent ?? null,
          },
        ),
    );

    // 3) Der Datensatz muss die Signatur widerspiegeln.
    //
    // BEFUND 2026-10-17: `Jahresabschluss.signiertAm` existiert als Spalte
    // im Schema — und **wurde von keiner Zeile im Projekt geschrieben.**
    // Gemessen nach der Signatur eines DRAFT-Abschlusses:
    //
    //     status:       DRAFT
    //     abgeschlossenAm: null
    //     signiertAm:   null        <- obwohl signiert
    //     wormObjectKey: …/abschluss-signed/…pdf   <- signiertes Objekt
    //
    // Ein Datensatz, der ein signiertes WORM-Objekt fuehrt und zugleich
    // `signiertAm: null` meldet, widerspricht sich selbst. Bei
    // Bilanz/GuV/Anhang wird `signiertAm` aus dem juengsten
    // Signature-Datensatz **abgeleitet** (`signaturen` in der Antwort) —
    // beim Jahresabschluss gibt es diese Ableitung nicht, nur die Spalte.
    await this.prisma.jahresabschluss.update({
      where: { id: args.jahresabschlussId },
      data: { signiertAm: new Date(), status: 'SIGNED' },
    });

    return ergebnis;
  }

  /**
   * Validiert ein signiertes PDF (entweder hochgeladen oder aus WORM).
   *
   * Implementiert eine pragmatische Validation:
   *   - Eingebettete PKCS#7-Signatur wird via @signpdf gelesen
   *   - Subject des Signierers wird extrahiert
   *   - Cert-Gültigkeit (now < validTo) wird geprüft
   *   - Hash-Vergleich (Placeholder vs. tatsächlicher Body-Hash)
   *
   * HINWEIS: Eine vollständige PAdES-Validierung (inkl. Revocation
   * Check, CRL, OCSP) ist M3 — M2 nutzt diese pragmatische Variante.
   */
  async validateSignature(args: {
    signedPdfBytes: Buffer;
    expectedSignerEmail?: string;
    /**
     * RFC-3161-Token des Zeitstempels (application/timestamp-reply).
     *
     * Wird beim Signieren in den WORM-Storage gelegt (siehe `signDocument`).
     * Ohne dieses Token kann die Zeitstempelprüfung nicht stattfinden — der
     * Zeitstempel ist derzeit NICHT als DocTimeStamp im PDF eingebettet,
     * sondern wird als Beweisobjekt geführt. Das ist bewusst dokumentiert und
     * der Grund, warum `legalValidity` ohne eingebetteten Zeitstempel nie
     * `VOLLSTAENDIG` wird.
     */
    timestampTokenBytes?: Buffer;
  }): Promise<ValidationResult> {
    const warnings: string[] = [];
    const errors: string[] = [];

    // 1. PKCS#7-Signatur(en) extrahieren (ASCII85Decode → Hex-Lookup)
    const signatureCount = this.countPdfSignatures(args.signedPdfBytes);
    if (signatureCount === 0) {
      errors.push('Keine eingebettete PKCS#7-Signatur gefunden');
      return {
        valid: false,
        legalValidity: 'UNGUELTIG',
        signatureCount: 0,
        signedBy: null,
        issuerTrusted: false,
        certificateExpired: false,
        timestampValid: false,
        documentIntegrity: false,
        warnings,
        errors,
      };
    }

    // 2. Letztes AcroForm-Subject aus PDF-Dictionary extrahieren (heuristisch)
    // Startwert aus der PDF-Heuristik; wird weiter unten durch das echte
    // Zertifikat-Subject ersetzt, sobald eines im PKCS#7 steckt.
    let signedBy: string | null = this.extractSignerNameFromPdf(args.signedPdfBytes);

    // 3. Subject-Email vs. erwarteter Signierer
    let issuerTrusted = false;
    if (args.expectedSignerEmail) {
      if (
        signedBy &&
        signedBy.toLowerCase().includes(args.expectedSignerEmail.toLowerCase())
      ) {
        issuerTrusted = true;
      } else {
        warnings.push(
          `Signierer-Subject enthält nicht die erwartete Email (${args.expectedSignerEmail})`,
        );
      }
    }
    // Ab hier entscheidet NICHT mehr dieser Block, sondern die echte
    // Zertifikatsbewertung weiter unten (assessCertificateTrust). Früher stand
    // hier „issuerTrusted = true" für JEDEN Issuer, sobald keine
    // expectedSignerEmail mitgegeben wurde — das ist inzwischen ersetzt.

    // 4. Zertifikat: jetzt tatsächlich aus dem PKCS#7 lesen und bewerten.
    //
    // Bis 2026-09-28 stand hier `const certificateExpired = false;` und
    // `issuerTrusted` wurde ohne expectedSignerEmail ebenfalls true gesetzt —
    // mit dem Kommentar "M3 erweitert auf EU Trusted List", obwohl M3 als
    // abgeschlossen geführt wurde. Beides war eine ungeprüfte Behauptung.
    const verification = verifyPdfSignature(args.signedPdfBytes);

    // Zertifikatssperrstatus (CRL). `assessCertificateTrust` ist synchron,
    // der CRL-Abruf nicht — deshalb hier und als Ergebnis an die Bewertung
    // uebergeben. Ohne erreichbare CRL gilt der Status als UNBEKANNT und
    // damit (fail-closed) nicht als vertrauenswuerdig.
    let revocation: Awaited<ReturnType<typeof checkCertificateRevocation>> | null = null;
    if (verification.certificatePem && this.requireRevocationCheck) {
      revocation = await checkCertificateRevocation(
        verification.certificatePem,
        // Aussteller aus der PKCS#7-Kette. Das Leaf ist NUR bei
        // selbstsignierten Zertifikaten sein eigener Aussteller — vorher
        // wurde es pauschal so behandelt, wodurch die CRL-Signatur bei
        // jedem echten CA-Zertifikat immer gegen den falschen Schluessel
        // geprueft wurde (fail-closed, aber toter Pfad).
        verification.issuerCertificatePem ?? null,
      );
      if (revocation.revoked === true) {
        errors.push('Signaturzertifikat ist gesperrt (CRL)');
      } else if (!revocation.determined) {
        warnings.push(
          `Sperrstatus nicht feststellbar${revocation.reason ? `: ${revocation.reason}` : ''} — Zertifikat gilt nicht als vertrauenswürdig`,
        );
      }
    }

    const trust = assessCertificateTrust(verification.certificate, {
      revocationDetermined: revocation?.determined,
      revocationChecked: revocation !== null,

      expectedSignerEmail: args.expectedSignerEmail,
      trustedIssuers: this.trustedIssuers,
      allowSelfSigned: this.allowSelfSignedCertificates,
    });
    const certificateExpired = trust.certificateExpired;
    issuerTrusted = trust.trusted;
    if (trust.reason) warnings.push(`Zertifikat: ${trust.reason}`);
    if (verification.certificate?.isCa) {
      errors.push('Signaturzertifikat ist als CA gekennzeichnet');
    }
    // Der Signierer kommt aus dem Zertifikat, nicht aus einer Heuristik über
    // AcroForm-Felder des PDF.
    if (verification.certificate) {
      signedBy = verification.certificate.subject;
    }

    // 5. Timestamp-Validierung
    //
    // Bis 2026-10-01 stand hier `const timestampValid = false;` mit der
    // Begründung "Mock-Modus, folgt in M3" — unabhängig davon, ob ein Token
    // vorlag. Das war in zwei Richtungen falsch:
    //   1. Ein echtes, von der TSA signiertes Token wurde nie ausgewertet.
    //   2. Die Begründungstext behauptete Modalität ("Mock-Modus"), obwohl im
    //      Produktivbetrieb ein Token vorliegt.
    //
    // Heute: strukturelle Prüfung des RFC-3161-Tokens (messageImprint gegen
    // den signierten Dokumentinhalt, genTime-Plausibilität) UND kryptografische
    // Prüfung der TSA-Signatur über den im Token eingebetteten
    // Zertifikatsschlüssel. Die Prüfung ist fail-closed: ohne konfigurierten
    // `SIGNATURE_TRUSTED_ISSUERS` wird der Aussteller nicht als vertrauenswürdig
    // anerkannt, und `legalValidity` erreicht dann `OHNE_ZEITSTEMPEL`.
    const timestampCheck = this.checkTimestamp(args.signedPdfBytes, args.timestampTokenBytes);
    const timestampValid = timestampCheck.valid && timestampCheck.signatureVerified;
    if (!timestampCheck.valid) {
      warnings.push(
        `Zeitstempel: ${timestampCheck.reason ?? 'nicht verwertbar'}. ` +
          'Ohne gültigen Zeitstempel ist die Signatur rechtlich NICHT ' +
          'ausreichend für eine Pflichtveröffentlichung.',
      );
    } else if (!timestampCheck.signatureVerified) {
      warnings.push(
        `Zeitstempel strukturell gültig, aber die TSA-Signatur nicht verifiziert: ` +
          `${timestampCheck.signatureReason ?? 'unbekannt'}. Für eine Pflichtveröffentlichung ` +
          'ist ein nachweisbar vertrauenswürdiger TSA erforderlich.',
      );
    }

    // 6. Document-Integrität: Struktur + messageDigest + Kryptografie
    const documentIntegrity = this.checkDocumentIntegrity(args.signedPdfBytes);
    if (!documentIntegrity && verification.reason) {
      warnings.push(`Integrität: ${verification.reason}`);
    }

    // Eine Signatur ohne vertrauenswürdigen Aussteller ist für eine
    // Pflichtveröffentlichung keine gültige Signatur.
    const valid =
      signatureCount > 0 &&
      documentIntegrity &&
      issuerTrusted &&
      !certificateExpired &&
      errors.length === 0;

    // Rechtliche Wirksamkeitsstufe. Bewusst getrennt von `valid`:
    // `valid` bleibt aus Rueckwaerts-Kompatibilitaet, aber ein Client soll
    // an `legalValidity` erkennen, dass ein Mock-/Fehl-Zeitstempel kein
    // BAnz-taugliches Dokument ergibt.
    const legalValidity: LegalValidity = !valid
      ? 'UNGUELTIG'
      : timestampValid
        ? 'VOLLSTAENDIG'
        : 'OHNE_ZEITSTEMPEL';

    if (valid && !timestampValid) {
      warnings.push(
        'Zeitstempel nicht verifiziert (Mock-TSA oder TSA nicht erreichbar) — ' +
          'die Signatur ist rechtlich NICHT ausreichend für eine Pflichtveröffentlichung',
      );
    }

    return {
      valid,
      legalValidity,
      signatureCount,
      signedBy,
      issuerTrusted,
      certificateExpired,
      timestampValid,
      documentIntegrity,
      warnings,
      errors,
    };
  }

  // ===========================================================================
  // Internal pipeline
  // ===========================================================================

  /**
   * Die Rolle muss auf dem **Ziel-Mandanten** gelten.
   *
   * BEFUND 2026-10-21 (Nachtrag 73): siehe die Begruendung in
   * `signInternal`.
   */
  private assertSignaturRolle(
    entityType: SignedEntityType,
    mandantId: string,
    user: AuthUser,
  ): void {
    const istAbschluss = entityType === 'Abschluss';
    assertRolleAufMandant(
      mandantId,
      istAbschluss
        ? ['WIRTSCHAFTSPRUEFER']
        : ['WIRTSCHAFTSPRUEFER', 'STEUERBERATER'],
      user,
      istAbschluss
        ? 'Den Jahresabschluss darf nur ein Wirtschaftsprüfer für diesen Mandanten signieren'
        : 'Dieses Dokument darf nur von einem Wirtschaftsprüfer oder Steuerberater für diesen Mandanten signiert werden',
    );
  }

  /**
   * Zentrale Signatur-Pipeline. PDF-Service generiert das PDF, dann
   * signieren wir es via @signpdf und legen das Ergebnis in WORM ab.
   */
  private async signInternal(
    args: SignArgs,
    entityType: SignedEntityType,
    entityId: string,
    user: AuthUser,
    context: SignaturServiceContext,
    generatePdf: (pdfArgs: {
      entityId: string;
      mandantId: string;
      ip: string | null;
      userAgent: string | null;
    }) => Promise<{ wormObjectKey: string; sha256Hash: string }>,
  ): Promise<SignatureResult> {
    // Zeitpunkt der Signatur-Durchführung. Wird als `zeitstempel`
    // aufgezeichnet, wenn die TSA keinen Zeitpunkt liefert — dann ist es
    // die Signierzeit des Vorgangs, ausdrücklich kein TSA-Zeitpunkt.
    const signingTime = new Date();

    // 1) Mandant-Trennung
    assertMandantAccess(args.mandantId, user);

    // 1b) Rolle AUF DEM ZIEL-MANDANTEN.
    //
    // BEFUND 2026-10-21 (Nachtrag 73): Der `RolesGuard` prueft die Rolle auf
    // dem **Kontext-Mandanten** (x-mandant-id) — nicht auf dem Ziel. Die
    // Service-Ebene pruefte bisher nur den *Zugriff* auf das Ziel
    // (`assertMandantAccess`: irgendeine Rolle genuegt). Die beiden Pruefungen
    // zusammen belegten nicht „Rolle fuer diesen Mandanten".
    //
    // **Gemessen.** Ein User, der in Mandant A Wirtschaftspruefer und in
    // Mandant B nur STEUERBERATER ist, hat den **Jahresabschluss** von
    // Mandant B signiert:
    //
    //     POST /api/signatur/sign-abschluss (Kontext = A) -> HTTP 200
    //     Signaturen am Abschluss: 1
    //
    // Eine qeS nach § 126 AO ersetzt die eigenhaendige Unterschrift. Sie
    // bescheinigt eine Endabnahme durch einen fuer diesen Mandanten
    // bestellten Wirtschaftspruefer (IDW PS 880). Ausgestellt wurde sie hier
    // von jemandem, der fuer Mandant B der **Ersteller** ist.
    //
    // Die Ebenen unterscheiden sich (Nachtrag 60): der **Jahresabschluss**
    // ist die Endabnahme — da darf nur ein Wirtschaftspruefer des Mandanten
    // signieren. Ein **Bestandteil** (Bilanz/GuV/Anhang) darf auch vom
    // Steuerberater des Mandanten signiert werden; die Signatur wird dann
    // als `signaturEbene: BESTANDTEIL` erfasst und ist **keine** Endabnahme.
    this.assertSignaturRolle(entityType, args.mandantId, user);

    // 1b) Vorbedingung: es muss ein **freigegebener Vier-Augen-Pruefungsnachweis**
    // fuer die Bilanz vorliegen.
    //
    // ENTSCHEIDUNG 2026-10-21 (Nachtrag 79): Die Endabnahme (die qeS des
    // Wirtschaftspruefers) verlangt die Pruefung, die sie bescheinigt.
    //
    // **Gemessen.** Die Kette lief ohne jeden Pruefungsnachweis durch:
    //
    //     VALIDATED setzen (nur Berater)  -> Bilanz 200, GuV 200, Anhang 200
    //     finalize                        -> HTTP 200
    //     sign-abschluss (WP, qeS)       -> HTTP 200
    //     einreichen (Kanzlei)           -> HTTP 200  -> SUBMITTED
    //     WP-Pruefungen zur Bilanz: 0
    //
    // Der Einreichungsweg verlangt zwingend eine qeS (IKS K-20) — jeder
    // veroeffentlichte Jahresabschluss gilt damit als **gepruefte Fassung**.
    // Eine qeS ohne Pruefungsnachweis ist eine Bescheinigung ohne Grundlage:
    // im Trail stuende "geprueft und freigegeben" bei einem Abschluss, zu dem
    // es keine Pruefung gibt.
    //
    // Der Nachweis ist der Datensatz `WPPruefungsAbschluss` der Bilanz im
    // Status APPROVED **mit** `freigegebenVonId` — die zweite Person hat
    // freigegeben (IDW PS 880, § 11 Abs. 2 WPO). `bilanz.status = 'APPROVED'`
    // wird dabei im selben Vorgang gesetzt, ist aber nur der Marker; der
    // Datensatz ist der Nachweis.
    //
    // **Nur die Endabnahme.** Eine *Bestandteil*-Signatur (Bilanz/GuV/Anhang)
    // bescheinigt nur ein geprueftes Teilstueck (Nachtrag 60) und braucht
    // deshalb keinen Pruefungsnachweis.
    // Die Bilanz des Abschlusses — bei der Endabnahme ist `entityId` die
    // Abschluss-ID.
    const bilanzDesAbschlusses =
      entityType === 'Abschluss'
        ? (
            await this.prisma.jahresabschluss.findFirst({
              where: { id: entityId, mandantId: args.mandantId },
              select: { bilanzId: true },
            })
          )?.bilanzId ?? null
        : null;
    const pruefungsNachweis = bilanzDesAbschlusses
      ? await this.prisma.wPPruefungsAbschluss.findFirst({
          where: {
            bilanzId: bilanzDesAbschlusses,
            status: 'APPROVED',
            freigegebenVonId: { not: null },
          },
          select: { id: true, freigegebenVonId: true, completedAt: true },
        })
      : null;
    if (entityType === 'Abschluss' && !pruefungsNachweis) {
      throw new ConflictException(
        'Der Jahresabschluss kann nicht bescheinigt werden: es liegt keine ' +
          'freigegebene Vier-Augen-Pruefung der Bilanz vor. ' +
          'Die Endabnahme (qeS) bescheinigt eine Pruefung — bitte zuerst die ' +
          'WP-Pruefung durchfuehren und von einer zweiten Person freigeben ' +
          'lassen, danach kann der Abschluss signiert werden ' +
          '(Vier-Augen-Prinzip, IDW PS 880).',
      );
    }

    // 2) P12-Parsing
    const p12Buffer = Buffer.from(args.p12Base64, 'base64');
    const p12Password = args.p12Password;
    const certMetadata = await this.p12Service.readP12Metadata(
      p12Buffer,
      p12Password,
    );

    // 3) Existenz-Check der Entity (mandant-gefiltert)
    await this.assertEntityExists(entityType, entityId, args.mandantId);
    await this.assertMandantBearbeitbar(args.mandantId, 'Dokument signieren');

    // 4) PDF generieren (via PdfService → WORM-Upload + Audit)
    const pdfGenResponse = await generatePdf({
      entityId,
      mandantId: args.mandantId,
      ip: context.ipAddress ?? null,
      userAgent: context.userAgent ?? null,
    });

    // 5) PDF aus WORM laden (um es zu signieren — wir haben den Buffer
    // nicht direkt aus dem Generator)
    const unsignedPdfBytes = await this.storageService.downloadFromWorm(
      pdfGenResponse.wormObjectKey,
    );
    const hashBefore = createHash('sha256')
      .update(unsignedPdfBytes)
      .digest('hex');

    // 6) Signatur-Stub + P12-Signatur anwenden
    const signer = new P12Signer(p12Buffer, { passphrase: p12Password });
    const placeholderPdf = plainAddPlaceholder({
      pdfBuffer: unsignedPdfBytes,
      reason: `Bundesanzeiger Jahresabschluss — ${entityType} (${entityId})`,
      contactInfo: user.email,
      name: `${user.vorname} ${user.nachname}`,
      location: 'Deutschland',
      signingTime: new Date(),
      subFilter: 'adbe.pkcs7.detached',
    });
    const signedPdfBytes = await signpdf.sign(placeholderPdf, signer);
    const hashAfter = createHash('sha256')
      .update(signedPdfBytes)
      .digest('hex');

    // 7) Optional: TSA-Zeitstempel
    //
    // Wichtig: der Zeitstempel-Hash wird über `hashBefore` (also über das
    // UNSIGNIERTE PDF) gebildet — genau so, wie es der Aufrufer erwartet.
    // Das ist auch die übliche Praxis für BAnz-Dokumente: der Zeitstempel
    // bezieht sich auf den Dokumentinhalt, die Signatur deckt zusätzlich die
    // Signaturwerte ab.
    let timestamp: Date | undefined;
    let timestampAuthority: string | undefined;
    let timestampTokenWormKey: string | undefined;
    let timestampTokenSha256: string | undefined;
    let parsedToken: ParsedTimestamp | undefined;
    if (args.includeTimestamp !== false) {
      const tsResponse = this.tsaUrl
        ? await this.tsaClient.getTimestamp(
            Buffer.from(hashBefore, 'hex'),
            this.tsaUrl,
            this.tsaUser,
            this.tsaPwd,
          )
        : this.tsaClient.getMockTimestamp(Buffer.from(hashBefore, 'hex'));
      timestamp = tsResponse.timestamp ?? undefined;
      timestampAuthority = tsResponse.tsaName;
      parsedToken = tsResponse.parsedToken;

      // Das Token gehört zur Beweiskette und wird deshalb nach WORM gelegt —
      // nicht nur in der DB abgelegt. Sonst könnte jemand mit DB-Zugriff den
      // Zeitstempel-Datensatz ändern, während das Token selbst unverändert
      // bliebe (oder umgekehrt). Der Object-Key landet im Signatur-Datensatz.
      if (tsResponse.timestampBytes?.length) {
        const tokenKey = this.buildTimestampObjectKey(
          args.mandantId,
          entityType,
          entityId,
        );
        const tokenMeta = await this.storageService.uploadToWorm({
          objectKey: tokenKey,
          entityType: this.entityTypeForSigned(entityType),
          entityId,
          mandantId: args.mandantId,
          data: tsResponse.timestampBytes,
          contentType: 'application/timestamp-reply',
        });
        timestampTokenWormKey = tokenKey;
        timestampTokenSha256 = tokenMeta.sha256Hash;
      }
    }

    // 8) Signiertes PDF in WORM hochladen (NEUER Key — append-only)
    const signedObjectKey = this.buildSignedObjectKey(
      args.mandantId,
      entityType,
      entityId,
    );
    const meta = await this.storageService.uploadToWorm({
      objectKey: signedObjectKey,
      entityType: this.entityTypeForSigned(entityType),
      entityId,
      mandantId: args.mandantId,
      data: signedPdfBytes,
      contentType: 'application/pdf',
    });

    // BEFUND 2026-10-11: Manifest und Signature-Record wurden in zwei
    // unabhaengigen Schritten geschrieben. Ein Fehler im zweiten liess ein
    // revisionssicher archiviertes, signiertes PDF ohne Signatur-Datensatz
    // und ohne Audit-Eintrag zurueck — die Signatur fand statt und
    // hinterliess keinen nachpruefbaren Beleg. Das ist fuer eine
    // qeS-Strecke genau der Fall, den § 146 AO nicht zulaesst.
    //
    // Beide DB-Schreibvorgaenge laufen jetzt in EINER Transaktion.
    //
    // Was NICHT transaktional ist und auch nicht sein kann: der
    // Objekt-Write ins WORM-Lager (Schritt 8, direkt davor). S3 kennt
    // kein Two-Phase-Commit. Ein verwaister Objekt-Eintrag ist harmlos und
    // sogar erwuenscht (legalHold), ein fehlender Signatur-Datensatz
    // nicht.
    //
    // Alles, was die Transaktion braucht, wird VORAB berechnet. Sonst
    // muesste der Signature-Record in einer zweiten Transaktion liegen —
    // und dann waere der Fehlerfall wieder derselbe: Manifest committet,
    // Signatur-Datensatz nicht.
    const signatureId = uuidv4();
    const signatureType: SignatureType =
      args.signatureType ?? certMetadata.signatureType;
    const userRolle =
      user.mandanten.find((m) => m.id === args.mandantId)?.rolle ??
      user.globalRole ??
      'STEUERBERATER';
    const signatureBytes = this.extractSignatureBytes(signedPdfBytes);

    const warnings: string[] = [];
    if (!timestampAuthority || timestampAuthority.startsWith('MOCK-')) {
      warnings.push(
        'TSA-Zeitstempel im Mock-Modus (TSA_URL nicht gesetzt). Pilot nicht freigabefähig.',
      );
    }

    // WORM-Manifest + Signature-Record in EINER Transaktion.
    const { manifest, jahresabschlussId } = await this.prisma.$transaction(async (tx) => {
      const manifestEintrag = await this.wormObjectRepository.create(
        {
          objectKey: signedObjectKey,
          entityType: this.entityTypeForSigned(entityType),
          entityId,
          mandantId: args.mandantId,
          sha256Hash: meta.sha256Hash,
          sizeBytes: meta.sizeBytes,
          objectLockMode: this.storageService.getConfig().lockMode,
          retentionDays: this.storageService.getConfig().retentionDays,
          retentionExpiresAt: meta.retentionExpiresAt,
          uploadedById: user.id,
          legalHold: true,
        },
        tx,
      );

      // Jahresabschluss-ID ableiten (für Audit-Trail + DB-Signature)
      const abschlussId = await this.resolveJahresabschlussId(
        entityType,
        entityId,
        args.mandantId,
        tx,
      );

      // Jeder Datensatz traegt GENAU EINE Bezugsachse. Bis 2026-10-13
      // wurde ohne Abschluss uebersprungen — die API lieferte dann eine
      // `signatureId`, die in keinem Datensatz auffindbar war (gemessen: 0
      // Zeilen in `signature` nach dem Signieren einer Bilanz), waehrend das
      // Frontend genau diese ID als "Signatur-ID" anzeigt. Der Weg war
      // bewusst, das Ergebnis war trotzdem ein toter Verweis.
      //
      // Beide Faelle werden im SELBEN Callback geschrieben: Manifest und
      // Signatur-Record oder keiner (siehe Kommentar zur Atomaritaet oben).
      await this.signatureRepository.create(
        {
          id: signatureId,
          // BEFUND 2026-10-20 (Nachtrag 60, TODO-8.15): **Beide** Achsen
          // werden belegt. Vorher landete eine Komponentensignatur auf der
          // Abschluss-Achse (`entityType`/`entityId` = null) und war damit
          // von einer Abschluss-Signatur nicht unterscheidbar — ein Auditor
          // las „der Jahresabschluss ist signiert", obwohl nur die GuV
          // geprueft war.
          //
          // `jahresabschlussId` sagt, zu welchem Aggregat der Bestandteil
          // gehoert; `entityType`/`entityId` sagen, was tatsaechlich signiert
          // wurde. Beides together gehoert.
          jahresabschlussId: abschlussId,
          entityType,
          entityId,
          // Und die Ebene sagt, was die Signatur **bescheinigt**:
          // die Endabnahme des Abschlusses oder die Pruefung eines
          // Bestandteils.
          signaturEbene: entityType === 'Abschluss' ? 'ABSCHLUSS' : 'BESTANDTEIL',
          userId: user.id,
          rolle: userRolle,
          signaturTyp: signatureType,
          zertifikatSubject: certMetadata.subject,
          zertifikatIssuer: certMetadata.issuer,
          zertifikatSeriennummer: certMetadata.serialNumber,
          zertifikatGueltigAb: certMetadata.validFrom,
          zertifikatGueltigBis: certMetadata.validTo,
          zeitstempel: timestamp ?? signingTime,
          zeitstempelIssuer: timestampAuthority ?? 'OHNE_TSA',
          hashVorher: hashBefore,
          hashNachher: hashAfter,
          signaturDaten: signatureBytes,
          signaturFormat: 'PKCS7',
        },
        tx,
      );

      return { manifest: manifestEintrag, jahresabschlussId: abschlussId };
    });


    // 11) Audit-Trail mit Cert-Subject (NIE der Key)
    await this.auditService.record({
      userId: user.id,
      mandantId: args.mandantId,
      jahresabschlussId,
      action: 'SIGN',
      entityType: 'Signature',
      entityId: signatureId,
      newState: {
        domainEntityType: entityType,
        domainEntityId: entityId,
        signatureType,
        signatureFormat: 'PKCS7',
        certificateSubject: certMetadata.subject,
        certificateIssuer: certMetadata.issuer,
        certificateSerial: certMetadata.serialNumber,
        certificateValidFrom: certMetadata.validFrom.toISOString(),
        certificateValidTo: certMetadata.validTo.toISOString(),
        certificateFingerprintSha256: certMetadata.fingerprintSha256,
        hashBefore,
        hashAfter,
        signedPdfWormKey: manifest.objectKey,
        signedPdfSizeBytes: manifest.sizeBytes,
        timestampAuthority: timestampAuthority ?? null,
        timestamp: timestamp ? timestamp.toISOString() : null,
        signedByEmail: user.email,
        signedByRolle: user.mandanten.find((m) => m.id === args.mandantId)?.rolle ?? null,
      },
      ipAddress: context.ipAddress ?? null,
      userAgent: context.userAgent ?? null,
    });

    this.logger.log(
      `Signatur OK: ${entityType} ${entityId} → ${manifest.objectKey} (hash ${hashAfter.slice(0, 12)}…)`,
    );

    return {
      signatureId,
      signedPdfBytes,
      signedPdfWormKey: manifest.objectKey,
      certificateMetadata: certMetadata,
      timestampAuthority,
      timestamp,
      ...(timestampTokenWormKey ? { timestampTokenWormKey } : {}),
      ...(timestampTokenSha256 ? { timestampTokenSha256 } : {}),
      ...(parsedToken?.serialNumber
        ? { timestampSerialNumber: parsedToken.serialNumber }
        : {}),
      hashBefore,
      hashAfter,
      isValid: true,
      warnings,
    };
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================


  /**
   * Archiv-Guard fuer das Signieren (§ 147 AO, Entscheidung 2026-10-14).
   *
   * Ein archivierter Mandant wird nicht mehr fortgeschrieben. Alle anderen
   * Schreibpfade waren bereits ueber `assertMandantNichtArchiviert`
   * gesperrt; die qeS-Signatur war die letzte Luecke — und die folgenreichste,
   * weil sie ein Dokument mit rechtlicher Wirkung erzeugt.
   *
   * LESEN bleibt offen: signierte PDFs und der Bestand eines archivierten
   * Mandanten muessen zur Nachvollziehbarkeit abrufbar bleiben.
   */
  private async assertMandantBearbeitbar(
    mandantId: string,
    aktion: string,
  ): Promise<void> {
    const mandant = await this.prisma.mandant.findUnique({
      where: { id: mandantId },
      select: { archiviertAt: true },
    });
    assertMandantNichtArchiviert(mandant?.archiviertAt, aktion);
  }

  private async assertEntityExists(
    entityType: SignedEntityType,
    entityId: string,
    mandantId: string,
  ): Promise<void> {
    switch (entityType) {
      case 'Bilanz': {
        const e = await this.bilanzRepository.findById(entityId, mandantId);
        if (!e) throw new NotFoundException('Bilanz nicht gefunden');
        return;
      }
      case 'GuV': {
        const e = await this.guvRepository.findById(entityId, mandantId);
        if (!e) throw new NotFoundException('GuV nicht gefunden');
        return;
      }
      case 'Anhang': {
        const e = await this.anhangRepository.findById(entityId, mandantId);
        if (!e) throw new NotFoundException('Anhang nicht gefunden');
        return;
      }
      case 'Abschluss': {
        // Direkter Prisma-Zugriff ist im Service toleriert (siehe
        // pdf.service.ts §2 — analoge Begründung).
        const e = await this.prisma.jahresabschluss.findFirst({
          where: { id: entityId, mandantId },
          select: { id: true },
        });
        if (!e) throw new NotFoundException('Jahresabschluss nicht gefunden');
        return;
      }
      default:
        throw new BadRequestException(
          `Unbekannter entityType: ${String(entityType)}`,
        );
    }
  }

  /**
   * Mappt Domain-Entity auf WORM-EntityType (Prisma-String).
   *
   * Eigenes Suffix _SIGNED, um klar von un-signierten PDFs zu trennen.
   */
  private entityTypeForSigned(entityType: SignedEntityType): string {
    const map: Record<SignedEntityType, string> = {
      Bilanz: 'BILANZ_PDF_SIGNED',
      GuV: 'GUV_PDF_SIGNED',
      Anhang: 'ANHANG_PDF_SIGNED',
      Abschluss: 'ABSCHLUSS_PDF_SIGNED',
    };
    return map[entityType];
  }

  /**
   * Deterministischer S3-Key für signierte PDFs.
   *
   * Schema: `mandant/<mandantId>/<entity-lowercase>-signed/<gj>/<uuid>.pdf`
   */
  private buildSignedObjectKey(
    mandantId: string,
    entityType: SignedEntityType,
    _entityId: string,
  ): string {
    const suffix = uuidv4();
    const entity = entityType.toLowerCase();
    return `mandant/${mandantId}/${entity}-signed/${new Date().getUTCFullYear()}/${suffix}.pdf`;
  }

  /**
   * Object-Key für das RFC-3161-Token des Zeitstempels.
   *
   * Bewusst ein eigener Schlüssel neben dem signierten PDF: das Token ist ein
   * eigener Beweis mit eigener SHA-256-Summe. Beide landen im selben
   * WORM-Container mit Object-Lock COMPLIANCE, sind aber getrennt abrufbar
   * und getrennt prüfbar.
   */
  private buildTimestampObjectKey(
    mandantId: string,
    entityType: SignedEntityType,
    _entityId: string,
  ): string {
    const suffix = uuidv4();
    const entity = entityType.toLowerCase();
    return `mandant/${mandantId}/${entity}-timestamp/${new Date().getUTCFullYear()}/${suffix}.tsr`;
  }

  /**
   * Versucht, die Jahresabschluss-ID für eine signierte Entity zu
   * bestimmen (für Audit-Trail-Kontext + Signature-DB-Record).
   *
   * Bei `Abschluss` ist es die ID direkt. Bei `Bilanz`/`GuV`/`Anhang`
   * wird der Jahresabschluss gesucht, der diese Entity referenziert
   * (mandant-gefiltert).
   */
  private async resolveJahresabschlussId(
    entityType: SignedEntityType,
    entityId: string,
    mandantId: string,
    /**
     * BEFUND 2026-10-11: Die Auflösung lief über `this.prisma` und damit
     * über eine EIGENE Connection. Ausgeführt innerhalb der Signatur-
     * Transaktion las sie damit einen anderen Snapshot als der, in dem
     * geschrieben wird — zwei Verbindungen, eine vermeintliche Transaktion.
     * Der Client wird deshalb durchgereicht.
     */
    tx?: Prisma.TransactionClient,
  ): Promise<string | null> {
    if (entityType === 'Abschluss') return entityId;
    // Direkter Prisma-Zugriff im Service ist toleriert (siehe
    // pdf.service.ts §2 — analoge Begründung). Wir suchen den
    // Jahresabschluss, der diese Entity referenziert.
    const abschluss = await (tx ?? this.prisma).jahresabschluss.findFirst({
      where: {
        mandantId,
        OR: [
          { bilanzId: entityId },
          { guvId: entityId },
          { anhangId: entityId },
        ],
      },
      select: { id: true },
    });
    return abschluss?.id ?? null;
  }

  /**
   * Zählt eingebettete PKCS#7-Signaturen in einem PDF (heuristisch:
   * Vorkommen von "/Type /Sig" im PDF-Body).
   */
  private countPdfSignatures(pdfBuffer: Buffer): number {
    const text = pdfBuffer.toString('latin1');
    const matches = text.match(/\/Type\s*\/Sig\b/g);
    return matches ? matches.length : 0;
  }

  /**
   * Extrahiert den /Name-Eintrag aus dem Signatur-Dictionary.
   *
   * Vereinfachte Heuristik: sucht das erste Vorkommen von `/Name (...)`
   * nach einem `/Type /Sig` Dictionary. Reicht für Validierungs-Reports.
   */
  private extractSignerNameFromPdf(pdfBuffer: Buffer): string | null {
    const text = pdfBuffer.toString('latin1');
    const match = text.match(/\/Type\s*\/Sig[\s\S]*?\/Name\s*\(([^)]+)\)/);
    if (!match) return null;
    return match[1] ?? null;
  }

  /**
   * Prüft, ob die /ByteRange im PDF die vollständige Datei außer dem
   * Signatur-Slot abdeckt (vereinfachte Integritäts-Heuristik).
   */
  private checkDocumentIntegrity(pdfBuffer: Buffer): boolean {
    // Bugfix 2026-09-28 (zwei Runden):
    //
    // (1) Die urspruengliche Formel
    //        covered = start + len1 + (total - (start2 + len2))
    //     verglich die Laenge des ERSTEN signierten Abschnitts (~5 KB) mit der
    //     Dateigroesse (~22 KB) und lieferte bei JEDER echten Signatur `false` —
    //     jedes signierte PDF wurde als manipuliert abgewiesen.
    //
    // (2) Die danach eingesetzte reine ByteRange-Strukturpruefung erkannte
    //     nur nachtraeglich angehaengte Bytes, NICHT aber eine Aenderung
    //     INNERHALB des signierten Textes. Fuer GoBD ist genau das die
    //     entscheidende Eigenschaft.
    //
    // Heute: Strukturpruefung als Vorfilter (schnell, frueher Fehler) und
    // anschliessend die PKCS#7-Pruefung: der messageDigest aus dem SignerInfo
    // ist der SHA-256 ueber die beiden ByteRange-Bereiche. Nur wenn beide
    // uebereinstimmen, gilt der Inhalt als unveraendert.
    const result = verifyPdfSignature(pdfBuffer);
    if (!result.verified && result.reason) {
      this.logger.warn(`PDF-Integritaet nicht bestaetigt: ${result.reason}`);
    }
    return result.verified;
  }

  /**
   * Prüft die Integrität des signierten PDF anhand der /ByteRange.
   *
   * Der Hash wird über die von der /ByteRange abgedeckten Bytes gebildet —
   * das ist genau der Dokumentinhalt ohne den Signatur-Slot und damit der
   * Wert, den auch eine TSA als messageImprint bestätigt.
   *
   * @returns SHA-256 über den signierten Inhalt, oder null wenn keine
   *          auswertbare /ByteRange gefunden wird.
   */
  private hashSignedContent(pdfBuffer: Buffer): Buffer | null {
    const text = pdfBuffer.toString('latin1');
    // /ByteRange [a b c d] — PDF-Notation: Byte-Offset und Länge.
    const match = text.match(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/);
    if (!match) return null;
    const [, a, len1, c, len2] = match.map((v) => Number.parseInt(v, 10)) as unknown as number[];
    if (![a, len1, c, len2].every((n) => Number.isFinite(n))) return null;
    const ranges: Array<[number, number]> = [
      [a, len1],
      [c, len2],
    ];
    const chunks: Buffer[] = [];
    for (const [start, len] of ranges) {
      if (start < 0 || len < 0 || start + len > pdfBuffer.length) {
        this.logger.warn(
          `ByteRange ${start}+${len} liegt außerhalb des Dokuments (${pdfBuffer.length} Bytes) — ` +
            'Hash über signierten Inhalt nicht bildbar.',
        );
        return null;
      }
      chunks.push(pdfBuffer.subarray(start, start + len));
    }
    return createHash('sha256').update(Buffer.concat(chunks)).digest();
  }

  /**
   * Strukturelle Prüfung des RFC-3161-Zeitstempel-Tokens.
   *
   * Geprüft wird:
   *   1. das Token ist als TimeStampResp lesbar
   *   2. `messageImprint` stimmt mit dem Hash des signierten Inhalts überein
   *      (beweist: genau dieses Dokument wurde zeitgestempelt)
   *   3. `genTime` liegt im plausiblen Rahmen (nicht in der Zukunft, nicht vor
   *      der Signatur, innerhalb der Gültigkeit des TSA-Zertifikats)
   *
   * NICHT geprüft wird:
   *   die kryptografische Signatur der TSA über das Token. Ohne Trust-Store für
   *   die TSA-Zertifikate wäre jede solche Prüfung eine Scheinsicherheit. Der
   *   Aufrufer weist das über `legalValidity` und `signatureVerified: false` aus.
   */
  private checkTimestamp(
    signedPdfBytes: Buffer,
    timestampTokenBytes?: Buffer,
  ): {
    valid: boolean;
    reason?: string;
    signatureVerified: boolean;
    signatureReason?: string;
  } {
    if (!timestampTokenBytes || timestampTokenBytes.length === 0) {
      return {
        valid: false,
        reason: 'kein RFC-3161-Token übergeben (nicht als DocTimeStamp eingebettet)',
        signatureVerified: false,
      };
    }
    // Bugfix 2026-10-07: Die Bindung an das Dokument wird VOR dem
    // Token-Parsing geprüft. Sie ist eine Frage an das PDF, nicht an
    // das Token — und vorher stand sie hinter dem Parse, wodurch ein
    // unlesbares Token die eigentliche Frage verdeckte.
    //
    // Ohne /ByteRange lässt sich nicht bestimmen, welchen Byte-Bereich
    // die Signatur abdeckt, also auch nicht, worauf sich der
    // Zeitstempel bezieht. Vorher stand hier nur ein Warn-Log und die
    // Prüfung lief bis `valid: true` — ein gueltiger TSA-Token für ein
    // voellig anderes Dokument wurde als Zeitstempel fuer DIESES
    // akzeptiert, und `legalValidity` wurde `VOLLSTAENDIG`.
    //
    // Ein ordnungsgemaess signiertes PDF hat immer eine /ByteRange.
    const signedContentHash = this.hashSignedContent(signedPdfBytes);
    if (!signedContentHash) {
      this.logger.warn(
        'Keine /ByteRange im signierten PDF gefunden — der Zeitstempel kann ' +
          'dem Dokument nicht zugeordnet werden.',
      );
      return {
        valid: false,
        reason:
          'Der Zeitstempel ist nicht an dieses Dokument gebunden: Im ' +
          'signierten PDF fehlt die /ByteRange, der messageImprint ' +
          'konnte deshalb nicht geprüft werden.',
        signatureVerified: false,
      };
    }

    const parsed = parseTimestampToken(timestampTokenBytes);
    if (!parsed.parsed) {
      return { valid: false, reason: parsed.reason ?? 'Token nicht lesbar', signatureVerified: false };
    }

    // Der messageImprint der TSA bezieht sich auf den signierten Dokumentinhalt.
    // Wir bilden denselben Hash (SHA-256 über die /ByteRange-Bereiche) und
    // vergleichen die Hex-Werte direkt.
    {
      if (!parsed.messageImprintHex) {
        return {
          valid: false,
          reason: 'Token enthält kein messageImprint — keine Bindung an ein Dokument',
          signatureVerified: false,
        };
      }
      const localHex = signedContentHash.toString('hex');
      const tokenHex = parsed.messageImprintHex.toLowerCase();
      if (localHex !== tokenHex) {
        return {
          valid: false,
          reason: `messageImprint passt nicht zum signierten Inhalt (Token ${tokenHex.slice(0, 16)}…, Dokument ${localHex.slice(0, 16)}…)`,
          signatureVerified: false,
        };
      }
    }

    const plausibility = checkTimestampPlausibility({
      genTime: parsed.genTime,
      tsaNotAfter: parsed.tsaNotAfter,
      tsaNotBefore: parsed.tsaNotBefore,
    });
    if (!plausibility.plausible) {
      return { valid: false, reason: plausibility.reason, signatureVerified: false };
    }

    // 4. Kryptografische Prüfung der TSA-Signatur (fail-closed).
    //
    //    Bis 2026-10-02 war `signatureVerified` konstant `false` — die
    //    Signatur der TSA wurde nie geprüft, wodurch `legalValidity`
    //    nie `VOLLSTAENDIG` erreichen konnte. Die Prüfung läuft über
    //    `node:crypto` (`node-forge` bietet weder `rsa.sign` noch
    //    `rsa.verify`).
    const sig = verifyTimestampSignature(parsed, {
      trustedIssuers: this.trustedIssuers,
      allowSelfSigned: this.allowSelfSignedCertificates,
    });
    return {
      valid: true,
      signatureVerified: sig.valid,
      ...(sig.valid ? {} : { signatureReason: sig.reason }),
    };
  }

  /**
   * Extrahiert die PKCS#7-Signatur-Bytes aus einem signierten PDF.
   *
   * @signpdf schreibt die Signatur in einem `Contents`-Stream, der per
   * Hexadezimal-String-Codierung im PDF-Layout steht. Wir parsen das
   * `/Contents <hex>` aus dem Signatur-Dictionary und liefern den
   * rohen Bytes-Stream.
   */
  private extractSignatureBytes(signedPdfBytes: Buffer): Buffer {
    const text = signedPdfBytes.toString('latin1');
    // /Contents <hex string> — bei @signpdf ist dies immer ein
    // gerader-Hex-String. Wir suchen den ersten Treffer nach einem
    // /Type /Sig-Dictionary.
    const sigDictMatch = text.match(/\/Type\s*\/Sig\b[\s\S]{0,2000}?\/Contents\s*<([0-9a-fA-F]+)>/);
    if (!sigDictMatch || !sigDictMatch[1]) {
      // Fallback: leerer Buffer — Audit-Trail dokumentiert das Fehlen
      return Buffer.alloc(0);
    }
    return Buffer.from(sigDictMatch[1], 'hex');
  }
}