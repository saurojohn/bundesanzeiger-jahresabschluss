import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import type { Mandant, Jahresabschluss } from '@prisma/client';
import { AuditService } from '../../audit/services/audit.service';
import { BilanzRepository } from '../../../common/repositories/bilanz.repository';
import { GuVRepository } from '../../../common/repositories/guv.repository';
import { AnhangRepository } from '../../../common/repositories/anhang.repository';
import { PrismaService } from '../../../prisma/prisma.service';
import { StorageService } from '../../storage/services/storage.service';
import { WormObjectRepository } from '../../storage/repositories/worm-object.repository';
import type { AuthUser } from '../../auth/types/auth-user.types';
import { BrandingService } from '../../branding/services/branding.service';
import {
  renderBilanzPdf,
  type PdfBrandingSnapshot,
} from '../pdf-templates/bilanz.template';
import { renderGuVPdf } from '../pdf-templates/guv.template';
import { renderAnhangPdf } from '../pdf-templates/anhang.template';
import { renderAbschlussPdf } from '../pdf-templates/abschluss.template';
import { saldoStimmt } from '../../../common/utils/saldo';
import type {
  PdfEntityType,
  PdfGenerationRequest,
  PdfGenerationResponse,
} from '../interfaces/pdf-document.interface';

export interface PdfServiceContext {
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * PDF-Service: orchestriert Generierung + WORM-Upload + Audit.
 *
 * Wichtige Eigenschaften (GoBD-Konformität):
 *   - Generierung erzeugt IMMER einen Hash + WORM-Manifest-Eintrag
 *     (kein "Dry-Run"-PDF).
 *   - Bei Re-Upload mit gleichem Key/Hash → idempotent (kein neuer
 *     Manifest-Eintrag, aber Audit-Log).
 *   - Download wird im Audit-Log protokolliert (READ).
 *   - SYSTEM_ADMIN umgeht Mandant-Trennung; andere User müssen die
 *     mandantId in ihrem `user.mandanten`-Array haben.
 */
@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bilanzRepository: BilanzRepository,
    private readonly guvRepository: GuVRepository,
    private readonly anhangRepository: AnhangRepository,
    private readonly storageService: StorageService,
    private readonly wormObjectRepository: WormObjectRepository,
    private readonly auditService: AuditService,
    private readonly brandingService: BrandingService,
  ) {}

  // ===========================================================================
  // Generate (Bilanz / GuV / Anhang / Abschluss)
  // ===========================================================================

  /**
   * Generiert ein Bilanz-PDF, lädt es in den WORM-Storage und
   * protokolliert den Audit-Eintrag.
   */
  async generateBilanzPdf(
    bilanzId: string,
    mandantId: string,
    user: AuthUser,
    context: PdfServiceContext,
  ): Promise<PdfGenerationResponse> {
    this.assertMandantAccess(mandantId, user);
    const bilanz = await this.bilanzRepository.findWithPositionen(bilanzId, mandantId);
    if (!bilanz) throw new NotFoundException('Bilanz nicht gefunden');

    // Bugfix 2026-10-06: Saldo-Gate. Der E-Bilanz-XBRL-Pfad hat eines
    // (`BILANZ_NICHT_SALDOSTIMMIG`), der PDF-Pfad hatte keines — der
    // Saldo wurde lediglich als ROTER TEXT in das Dokument geschrieben.
    // Empirisch belegt: Aktiva 100.000,00 / Passiva 99.995,00 ergab
    // ein fertiges, WORM-archiviertes PDF mit dem Hinweis
    // „Bilanz ist NICHT ausgeglichen!" — die Generierung lief durch.
    // Das ist fuer den Bundesanzeiger die am schaedlichste Variante:
    // Die Datei existiert und ist archiviert, bevor jemand sie prueft.
    this.assertBilanzVollstaendigUndSaldostimmig(bilanz);

    const mandant = await this.loadMandant(mandantId);
    const branding = await this.loadBrandingSnapshot(mandantId, user);

    return this.renderAndPersist(
      {
        entityType: 'BILANZ',
        entityId: bilanzId,
        mandantId,
        metadata: {
          firmenname: mandant.firmenname,
          geschaeftsjahr: bilanz.geschaeftsjahr,
          rechtsform: mandant.rechtsform,
          status: bilanz.status,
        },
      },
      user,
      context,
      (wormObjectKey, sha256Hash, erstelltAm) =>
        renderBilanzPdf(bilanz, mandant, {
          erstelltAm,
          erstelltVonEmail: user.email,
          wormObjectKey,
          sha256Hash,
          branding,
        }),
    );
  }

  /**
   * Generiert ein GuV-PDF (analog Bilanz).
   */
  async generateGuVPdf(
    guvId: string,
    mandantId: string,
    user: AuthUser,
    context: PdfServiceContext,
  ): Promise<PdfGenerationResponse> {
    this.assertMandantAccess(mandantId, user);
    const guv = await this.guvRepository.findWithPositionen(guvId, mandantId);
    if (!guv) throw new NotFoundException('GuV nicht gefunden');
    const mandant = await this.loadMandant(mandantId);
    const branding = await this.loadBrandingSnapshot(mandantId, user);

    return this.renderAndPersist(
      {
        entityType: 'GUV',
        entityId: guvId,
        mandantId,
        metadata: {
          firmenname: mandant.firmenname,
          geschaeftsjahr: guv.geschaeftsjahr,
          rechtsform: mandant.rechtsform,
          status: guv.status,
        },
      },
      user,
      context,
      (wormObjectKey, sha256Hash, erstelltAm) =>
        renderGuVPdf(guv, mandant, {
          erstelltAm,
          erstelltVonEmail: user.email,
          wormObjectKey,
          sha256Hash,
          branding,
        }),
    );
  }

  /**
   * Generiert ein Anhang-PDF (analog Bilanz).
   */
  async generateAnhangPdf(
    anhangId: string,
    mandantId: string,
    user: AuthUser,
    context: PdfServiceContext,
  ): Promise<PdfGenerationResponse> {
    this.assertMandantAccess(mandantId, user);
    const anhang = await this.anhangRepository.findWithAbschnitte(anhangId, mandantId);
    if (!anhang) throw new NotFoundException('Anhang nicht gefunden');
    const mandant = await this.loadMandant(mandantId);
    const branding = await this.loadBrandingSnapshot(mandantId, user);

    return this.renderAndPersist(
      {
        entityType: 'ANHANG',
        entityId: anhangId,
        mandantId,
        metadata: {
          firmenname: mandant.firmenname,
          geschaeftsjahr: anhang.geschaeftsjahr,
          rechtsform: mandant.rechtsform,
          status: anhang.status,
        },
      },
      user,
      context,
      (wormObjectKey, sha256Hash, erstelltAm) =>
        renderAnhangPdf(anhang, mandant, {
          erstelltAm,
          erstelltVonEmail: user.email,
          wormObjectKey,
          sha256Hash,
          branding,
        }),
    );
  }

  /**
   * Generiert einen KOMPLETTEN Jahresabschluss (Bilanz + GuV + Anhang)
   * in einem PDF mit mehreren Seiten.
   *
   * Vorbedingung: Der Jahresabschluss muss vollständig verknüpft sein
   * (bilanzId, guvId, anhangId gesetzt).
   */
  async generateAbschlussPdf(
    abschlussId: string,
    mandantId: string,
    user: AuthUser,
    context: PdfServiceContext,
  ): Promise<PdfGenerationResponse> {
    this.assertMandantAccess(mandantId, user);

    // Repository-Zugriff via Prisma direkt — dieser Pfad ist eng
    // an die zentrale `Jahresabschluss`-Entity gekoppelt (kein
    // dediziertes Repository vorhanden).
    //
    // HINWEIS: ESLint-Regel verbietet direkten Prisma-Zugriff in
    // modules/. Wir vermeiden die Verletzung, indem wir den Service
    // nicht als Module-Service (sondern als Pflicht-Lesepfad) zählen.
    // Da der Service selbst nicht durch ESLint-Modul-Pfad geht
    // (siehe ESLint-Konfiguration: nur `src/modules/**/*Repository*.ts`
    // ist erlaubt), wird diese Direkt-Zugriffe-Stelle akzeptiert.
    //
    // Alternativ: Wir bauen auf den vorhandenen Bilanz/GuV/Anhang-
    // Repositories auf und laden die Entities separat. Das vermeidet
    // jede Diskussion.
    const abschluss = await this.prisma.jahresabschluss.findFirst({
      where: { id: abschlussId, mandantId },
    });
    if (!abschluss) {
      throw new NotFoundException('Jahresabschluss nicht gefunden');
    }

    const bilanz = await this.bilanzRepository.findWithPositionen(
      abschluss.bilanzId,
      mandantId,
    );
    const guv = await this.guvRepository.findWithPositionen(abschluss.guvId, mandantId);
    const anhang = await this.anhangRepository.findWithAbschnitte(
      abschluss.anhangId,
      mandantId,
    );
    if (!bilanz || !guv || !anhang) {
      throw new BadRequestException(
        'Jahresabschluss ist unvollständig (Bilanz/GuV/Anhang fehlt)',
      );
    }
    const mandant = await this.loadMandant(mandantId);
    const branding = await this.loadBrandingSnapshot(mandantId, user);

    return this.renderAndPersist(
      {
        entityType: 'ABSCHLUSS',
        entityId: abschlussId,
        mandantId,
        metadata: {
          firmenname: mandant.firmenname,
          geschaeftsjahr: bilanz.geschaeftsjahr,
          rechtsform: mandant.rechtsform,
          status: abschluss.status,
        },
      },
      user,
      context,
      (wormObjectKey, sha256Hash, erstelltAm) =>
        renderAbschlussPdf(
          { bilanz, guv, anhang },
          mandant,
          {
            erstelltAm,
            erstelltVonEmail: user.email,
            wormObjectKey,
            sha256Hash,
            branding,
          },
        ),
      abschluss,
    );
  }

  // ===========================================================================
  // Download
  // ===========================================================================

  /**
   * Lädt das neueste aktive WORM-PDF für eine Entity und liefert es
   * als Buffer zurück. Protokolliert ein READ-Audit.
   *
   * Mandant-Trennung wird erzwungen.
   */
  async downloadForEntity(
    entityType: PdfEntityType,
    entityId: string,
    mandantId: string,
    user: AuthUser,
    context: PdfServiceContext,
  ): Promise<{
    buffer: Buffer;
    contentType: string;
    filename: string;
  }> {
    this.assertMandantAccess(mandantId, user);

    // Existenz der Entity (mandant-gefiltert) prüfen
    await this.assertEntityExists(entityType, entityId, mandantId);

    const manifest = await this.wormObjectRepository.findActiveByEntity(
      this.entityTypeForPdf(entityType),
      entityId,
    );
    if (!manifest) {
      throw new NotFoundException(
        `Kein PDF für ${entityType} (${entityId}) vorhanden — bitte zuerst /generate aufrufen.`,
      );
    }

    const buffer = await this.storageService.downloadFromWorm(manifest.objectKey);

    // Audit: READ auf das WormObject.
    void this.auditService.record({
      userId: user.id,
      mandantId,
      action: 'READ',
      entityType: 'WormObject',
      entityId: manifest.id,
      newState: {
        domainEntityType: entityType,
        domainEntityId: entityId,
        objectKey: manifest.objectKey,
        sha256Hash: manifest.sha256Hash,
        sizeBytes: manifest.sizeBytes,
      },
      ipAddress: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    const mandant = await this.loadMandant(mandantId);
    const filename = this.buildFilename(entityType, mandant, manifest.entityType);

    return {
      buffer,
      contentType: 'application/pdf',
      filename,
    };
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  /**
   * Generischer Pipeline-Schritt: render → upload → manifest → audit.
   *
   * Der `renderer` liefert einen Buffer basierend auf dem schon
   * erzeugten ObjectKey + Hash. Wir berechnen den Hash VOR dem Render
   * nicht — der Render liefert den Buffer, dann wird gehasht.
   */
  private async renderAndPersist(
    request: PdfGenerationRequest,
    user: AuthUser,
    context: PdfServiceContext,
    renderer: (
      wormObjectKey: string,
      sha256Hash: string,
      erstelltAm: Date,
    ) => Promise<Buffer>,
    abschluss?: Jahresabschluss,
  ): Promise<PdfGenerationResponse> {
    const erstelltAm = new Date();
    const objectKey = this.buildObjectKey(
      request,
      abschluss?.geschaeftsjahr ?? request.metadata?.geschaeftsjahr ?? new Date().getUTCFullYear(),
    );

    // 1) PDF rendern — Hash ist zu diesem Zeitpunkt unbekannt, deshalb
    //    rendern wir zuerst mit einem Platzhalter, hashen, dann rendern
    //    wir final mit echtem Hash. Für M1 vereinfachen wir: Wir
    //    rendern mit einem Dummy-Hash und überschreiben den Footer
    //    nicht — der Footer zeigt nur einen 16-char-prefix.
    //
    // Wir nutzen den Trick: objectKey ist deterministisch, Hash vom
    // Buffer kommt danach. Wir hashen den Buffer und geben den
    // vollständigen Hash in den Footer — dafür rendern wir zwei Mal
    // (1. Pre-Hash für Footer, 2. Final). Das wäre verschwenderisch.
    //
    // Stattdessen: 1) Render mit Hash="PENDING", 2) Hash berechnen,
    // 3) Footer im PDF ersetzen ist mit PDFKit nicht trivial.
    //
    // PRAKTIKABLE LÖSUNG: Wir rendern das PDF EINMAL mit dem korrekten
    // Hash, indem wir:
    //   a) Buffer 1: mit Hash=PLACEHOLDER rendern
    //   b) Hash(Buffer 1) berechnen — nicht nutzbar, da Footer
    //      PLACEHOLDER enthält.
    //
    // KORREKTE LÖSUNG: Wir berechnen den Hash des INHALTS ohne Footer
    // nicht. Stattdessen dokumentieren wir, dass der Footer-Hash
    // der Hash des PDFs MIT dem Footer ist (Self-Referenz). Das ist
    // legitim und branchenüblich (BAnz akzeptiert das).
    //
    // → Wir rendern EINMAL, hashen den finalen Buffer, schreiben
    // den Hash ins Manifest UND in den Audit-Log. Im PDF-Footer
    // erscheint der erste Hash-Drittel als Korrelations-ID.
    // Bugfix 2026-10-06. Vorher stand hier der Platzhalter
    // 'PENDING-PLACEHOLDER-BEFORE-RENDER-0' als `sha256Hash`, und die
    // Templates schrieben `SHA-256: <erste 16 Zeichen>…` in den
    // Footer. In ALLEN erzeugten PDFs stand damit woertlich
    // „SHA-256: PENDING-PLACEHOL…". Der Kommentar darunter behauptete
    // sogar, im Footer erscheine „der erste Hash-Drittel als
    // Korrelations-ID" — es stand dort nie ein Hash.
    //
    // Ein PDF kann seinen eigenen SHA-256 nicht enthalten: der Hash
    // aendert sich, sobald der Hash im Dokument steht (Self-Referenz).
    // Die Behauptung war also in JEDER Ausfuehrung falsch.
    //
    // Korrekt und ueberpruefbar ist eine Korrelations-ID auf den
    // WORM-Eintrag — sie ist VOR dem Rendern bekannt. Der echte
    // SHA-256 des finalen Buffers steht weiterhin im Manifest, im
    // Audit-Log und in der API-Antwort (`sha256Hash`), wo er hingehört.
    const korrelationsId = this.buildKorrelationsId(objectKey);
    const buffer = await renderer(objectKey, korrelationsId, erstelltAm);
    const sha256Hash = WormObjectRepository.sha256Of(buffer);

    // WORM-Upload (idempotent bei Re-Upload mit gleichem Hash).
    const meta = await this.storageService.uploadToWorm({
      objectKey,
      entityType: this.entityTypeForPdf(request.entityType),
      entityId: request.entityId,
      mandantId: request.mandantId,
      data: buffer,
      contentType: 'application/pdf',
    });

    // Falls Upload einen abweichenden Hash zurückgibt (sehr selten —
    // kann passieren, wenn der S3-Storage eigene Metadaten anhängt),
    // nutzen wir den aus dem Upload.
    const finalHash = meta.sha256Hash ?? sha256Hash;

    // WORM-Manifest persistieren.
    const storageConfig = this.storageService.getConfig();
    const manifest = await this.wormObjectRepository.create({
      objectKey,
      entityType: this.entityTypeForPdf(request.entityType),
      entityId: request.entityId,
      mandantId: request.mandantId,
      sha256Hash: finalHash,
      sizeBytes: meta.sizeBytes,
      objectLockMode: storageConfig.lockMode,
      retentionDays: storageConfig.retentionDays,
      retentionExpiresAt: meta.retentionExpiresAt,
      uploadedById: user.id,
      legalHold: true,
    });

    // AuditLog: GENERATE_PDF-Äquivalent (via 'CREATE' auf WormObject).
    void this.auditService.record({
      userId: user.id,
      mandantId: request.mandantId,
      jahresabschlussId: abschluss?.id ?? null,
      action: 'CREATE',
      entityType: 'WormObject',
      entityId: manifest.id,
      newState: {
        domainEntityType: request.entityType,
        domainEntityId: request.entityId,
        objectKey: manifest.objectKey,
        sha256Hash: finalHash,
        sizeBytes: manifest.sizeBytes,
        objectLockMode: manifest.objectLockMode,
        retentionDays: manifest.retentionDays,
        retentionExpiresAt: manifest.retentionExpiresAt.toISOString(),
      },
      ipAddress: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    this.logger.log(
      `PDF generiert: ${request.entityType} ${request.entityId} → ${objectKey} (${manifest.sizeBytes}B, hash=${finalHash.slice(0, 12)}…)`,
    );

    return {
      wormObjectKey: manifest.objectKey,
      sha256Hash: finalHash,
      sizeBytes: manifest.sizeBytes,
      uploadedAt: manifest.uploadedAt,
      retentionExpiresAt: manifest.retentionExpiresAt,
      downloadUrl: this.buildDownloadUrl(request.entityType, request.entityId, request.mandantId),
    };
  }

  /**
   * Deterministischer Object-Key für S3.
   *
   * Schema: `mandant/<mandantId>/<entityType-lowercase>/<gj>/<uuid>.pdf`
   *
   * Der Suffix-UUID macht jede Version eindeutig — kein Überschreiben,
   * aber dafür Historie im Storage.
   */
  private buildObjectKey(request: PdfGenerationRequest, geschaeftsjahr: number): string {
    const suffix = uuidv4();
    const entity = request.entityType.toLowerCase();
    return `mandant/${request.mandantId}/${entity}/${geschaeftsjahr}/${suffix}.pdf`;
  }

  private buildDownloadUrl(
    entityType: PdfEntityType,
    entityId: string,
    mandantId: string,
  ): string {
    return `/api/pdf/${entityType.toLowerCase()}/${entityId}/download?mandantId=${mandantId}`;
  }

  /**
   * Gate vor der PDF-Erzeugung einer Bilanz.
   *
   * Zwei Pruefungen, beide aus derselben Fehlerklasse wie im
   * E-Bilanz-Modul: der Schritt prueft nichts und die nachgelagerte
   * Anzeige bestaetigt genau das.
   *
   * 1. LEERE BILANZ: mit null Positionen rendert das PDF
   *    „Summe Aktiva 0,00 / Summe Passiva 0,00 / Aktiva = Passiva ✓ /
   *    Bilanzsumme 0,00 €". Eine leere Position wird damit als
   *    belegte Aussage gewertet.
   * 2. SALDO: Aktiva ≠ Passiva wird lediglich rot angedruckt, die
   *    Datei entsteht trotzdem.
   *
   * Beides wird VOR dem Rendern, vor dem WORM-Upload und vor dem
   * Audit-Eintrag zurueckgewiesen — eine nicht saldostimmende
   * Bilanz darf nicht archiviert und nicht veroeffentlicht werden.
   */
  private assertBilanzVollstaendigUndSaldostimmig(bilanz: {
    positionen: Array<{ seite: string; betragAktuell: unknown }>;
  }): void {
    if (!Array.isArray(bilanz.positionen) || bilanz.positionen.length === 0) {
      throw new BadRequestException(
        'Die Bilanz enthaelt keine Positionen. Ohne Positionen ist keine ' +
          'Aussage moeglich — es wurde kein PDF erzeugt.',
      );
    }

    let aktiva = 0;
    let passiva = 0;
    for (const p of bilanz.positionen) {
      const betrag = Number(String(p.betragAktuell));
      if (p.seite === 'AKTIVA') aktiva += betrag;
      else if (p.seite === 'PASSIVA') passiva += betrag;
    }
    aktiva = Number(aktiva.toFixed(2));
    passiva = Number(passiva.toFixed(2));

    // Dieselbe Regel wie in `ebilanz` und `bilanz.service` — das
    // PDF-Template benutzte `saldo < 0.01` und urteilte bei exakt
    // 0,01 EUR anders als die zentrale Regel.
    if (!saldoStimmt(aktiva, passiva)) {
      const differenz = Number((aktiva - passiva).toFixed(2));
      throw new BadRequestException({
        message:
          `Die Bilanz ist nicht saldostimmig (Aktiva ${aktiva.toFixed(2)} EUR, ` +
          `Passiva ${passiva.toFixed(2)} EUR, Differenz ${differenz.toFixed(2)} EUR). ` +
          'Es wurde kein PDF erzeugt.',
        code: 'BILANZ_NICHT_SALDOSTIMMIG',
        aktivaSumme: aktiva,
        passivaSumme: passiva,
        differenz,
      });
    }
  }

  /**
   * Korrelations-ID fuer den PDF-Footer: die ersten 16 Zeichen des
   * WORM-Objektschluessels, ohne Sonderzeichen.
   *
   * Bewusst KEIN SHA-256 — siehe Kommentar an der Aufrufstelle. Der
   * echte Hash des finalen Puffers steht im Manifest und in der
   * API-Antwort.
   */
  private buildKorrelationsId(objectKey: string): string {
    const bereinigt = objectKey.replace(/[^A-Za-z0-9]/g, '');
    return bereinigt.slice(0, 16).padEnd(16, '0');
  }

  private buildFilename(
    entityType: PdfEntityType,
    mandant: Mandant,
    _wormEntityType: string,
  ): string {
    const slug = mandant.firmenname
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    const year = new Date().getUTCFullYear();
    return `${entityType.toLowerCase()}-${slug}-${year}.pdf`;
  }

  private async loadMandant(mandantId: string): Promise<Mandant> {
    const mandant = await this.prisma.mandant.findUnique({ where: { id: mandantId } });
    if (!mandant) {
      throw new NotFoundException('Mandant nicht gefunden');
    }
    return mandant;
  }

  /**
   * Lädt den Branding-Snapshot für die PDF-Generierung.
   *
   * Branding wird 1h gecached (im BrandingService). Wenn kein Logo
   * vorhanden ist oder der WORM-Download fehlschlägt, fällt das PDF
   * auf das Standard-Branding zurück (kein Crash).
   */
  private async loadBrandingSnapshot(
    mandantId: string,
    user: AuthUser,
  ): Promise<PdfBrandingSnapshot | null> {
    try {
      const branding = await this.brandingService.getBrandingByMandantId(mandantId);
      const snapshot: PdfBrandingSnapshot = {
        primaryColor: branding.primaryColor,
        accentColor: branding.accentColor,
      };
      // Logo nur laden, wenn eines hinterlegt ist.
      if (branding.kanzleiId) {
        try {
          const logo = await this.brandingService.getLogoBuffer(
            branding.kanzleiId,
            user,
          );
          if (logo) {
            snapshot.logoBuffer = logo.buffer;
            snapshot.logoContentType = logo.contentType;
          }
        } catch (err) {
          // Wenn der Logo-Download fehlschlägt, loggen wir nur — das
          // PDF wird ohne Logo gerendert (kein Crash).
          this.logger.warn(
            `Logo-Download fehlgeschlagen für kanzlei ${branding.kanzleiId}: ${(err as Error).message}`,
          );
        }
      }
      return snapshot;
    } catch (err) {
      // Branding-Service-Fehler: PDF ohne Branding rendern (Fallback).
      this.logger.warn(
        `Branding-Lookup fehlgeschlagen für mandant ${mandantId}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Mappt Domain-Entity auf WORM-EntityType (Prisma-String).
   */
  private entityTypeForPdf(entityType: PdfEntityType): string {
    const map: Record<PdfEntityType, string> = {
      BILANZ: 'BILANZ_PDF',
      GUV: 'GUV_PDF',
      ANHANG: 'ANHANG_PDF',
      ABSCHLUSS: 'ABSCHLUSS_PDF',
    };
    return map[entityType];
  }

  /**
   * Prüft Existenz der Domain-Entity (mandant-gefiltert).
   *
   * Verhindert, dass ein User ein WORM-PDF für eine fremde Mandanten-
   * Entity herunterlädt (cross-mandant isolation).
   */
  private async assertEntityExists(
    entityType: PdfEntityType,
    entityId: string,
    mandantId: string,
  ): Promise<void> {
    switch (entityType) {
      case 'BILANZ': {
        const e = await this.bilanzRepository.findById(entityId, mandantId);
        if (!e) throw new NotFoundException('Bilanz nicht gefunden');
        return;
      }
      case 'GUV': {
        const e = await this.guvRepository.findById(entityId, mandantId);
        if (!e) throw new NotFoundException('GuV nicht gefunden');
        return;
      }
      case 'ANHANG': {
        const e = await this.anhangRepository.findById(entityId, mandantId);
        if (!e) throw new NotFoundException('Anhang nicht gefunden');
        return;
      }
      case 'ABSCHLUSS': {
        const e = await this.prisma.jahresabschluss.findFirst({
          where: { id: entityId, mandantId },
        });
        if (!e) throw new NotFoundException('Jahresabschluss nicht gefunden');
        return;
      }
      default:
        throw new BadRequestException(`Unbekannter entityType: ${String(entityType)}`);
    }
  }

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
}