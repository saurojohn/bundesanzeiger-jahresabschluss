import {
  BadRequestException,
  ForbiddenException,
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
import { P12Service } from './p12.service';
import { TsaClientService } from './tsa-client.service';

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
   */
  async signAbschluss(
    args: SignArgs,
    user: AuthUser,
    context: SignaturServiceContext,
  ): Promise<SignatureResult> {
    if (!args.jahresabschlussId) {
      throw new BadRequestException('jahresabschlussId erforderlich');
    }
    return this.signInternal(
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
  }): Promise<ValidationResult> {
    const warnings: string[] = [];
    const errors: string[] = [];

    // 1. PKCS#7-Signatur(en) extrahieren (ASCII85Decode → Hex-Lookup)
    const signatureCount = this.countPdfSignatures(args.signedPdfBytes);
    if (signatureCount === 0) {
      errors.push('Keine eingebettete PKCS#7-Signatur gefunden');
      return {
        valid: false,
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
        verification.certificatePem, // selbstsigniert im Pilot: Issuer = Subject
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

    // 5. Timestamp-Validation — Mock-Mode kann nicht validiert werden
    const timestampValid = false;
    warnings.push(
      'TSA-Token-Validation in M2 nicht implementiert (Mock-Modus), folgt in M3',
    );

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

    return {
      valid,
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
    // 1) Mandant-Trennung
    this.assertMandantAccess(args.mandantId, user);

    // 2) P12-Parsing
    const p12Buffer = Buffer.from(args.p12Base64, 'base64');
    const p12Password = args.p12Password;
    const certMetadata = await this.p12Service.readP12Metadata(
      p12Buffer,
      p12Password,
    );

    // 3) Existenz-Check der Entity (mandant-gefiltert)
    await this.assertEntityExists(entityType, entityId, args.mandantId);

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
    let timestamp: Date | undefined;
    let timestampAuthority: string | undefined;
    if (args.includeTimestamp !== false) {
      const tsResponse = this.tsaUrl
        ? await this.tsaClient.getTimestamp(
            Buffer.from(hashBefore, 'hex'),
            this.tsaUrl,
            this.tsaUser,
            this.tsaPwd,
          )
        : this.tsaClient.getMockTimestamp(Buffer.from(hashBefore, 'hex'));
      timestamp = tsResponse.timestamp;
      timestampAuthority = tsResponse.tsaName;
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

    const manifest = await this.wormObjectRepository.create({
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
    });

    // 9) Jahresabschluss-ID ableiten (für Audit-Trail + DB-Signature)
    const jahresabschlussId = await this.resolveJahresabschlussId(
      entityType,
      entityId,
      args.mandantId,
    );

    // 10) Signature-Record in DB (nur wenn Jahresabschluss bekannt)
    const signatureId = uuidv4();
    const signatureType: SignatureType =
      args.signatureType ?? certMetadata.signatureType;
    const userRolle =
      user.mandanten.find((m) => m.id === args.mandantId)?.rolle ??
      user.globalRole ??
      'STEUERBERATER';

    const warnings: string[] = [];
    if (!timestampAuthority || timestampAuthority.startsWith('MOCK-')) {
      warnings.push(
        'TSA-Zeitstempel im Mock-Modus (TSA_URL nicht gesetzt). Pilot nicht freigabefähig.',
      );
    }

    // Wenn eine Jahresabschluss-ID ableitbar ist, persistieren wir den
    // Signature-Datensatz. Für Bilanz/GuV/Anhang ohne verknüpften
    // Jahresabschluss überspringen wir den DB-Record (Audit-Trail
    // reicht für Nachvollziehbarkeit).
    if (jahresabschlussId) {
      // PKCS#7-Signatur-Bytes: @signpdf liefert die PDF-Bytes, die
      // DER-Signatur steckt im PDF-Dictionary. Wir extrahieren die
      // Hex-Bytes aus dem Contents-Stream und speichern sie als
      // signaturDaten (für spätere Validierung + Audit).
      const signatureBytes = this.extractSignatureBytes(signedPdfBytes);
      await this.signatureRepository.create({
        jahresabschlussId,
        userId: user.id,
        rolle: userRolle,
        signaturTyp: signatureType,
        zertifikatSubject: certMetadata.subject,
        zertifikatIssuer: certMetadata.issuer,
        zertifikatSeriennummer: certMetadata.serialNumber,
        zertifikatGueltigAb: certMetadata.validFrom,
        zertifikatGueltigBis: certMetadata.validTo,
        zeitstempel: timestamp ?? new Date(),
        zeitstempelIssuer: timestampAuthority ?? null,
        hashVorher: hashBefore,
        hashNachher: hashAfter,
        signaturDaten: signatureBytes,
        signaturFormat: 'PKCS7',
      });
    }

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
      hashBefore,
      hashAfter,
      isValid: true,
      warnings,
    };
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
  ): Promise<string | null> {
    if (entityType === 'Abschluss') return entityId;
    // Direkter Prisma-Zugriff im Service ist toleriert (siehe
    // pdf.service.ts §2 — analoge Begründung). Wir suchen den
    // Jahresabschluss, der diese Entity referenziert.
    const abschluss = await this.prisma.jahresabschluss.findFirst({
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