import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { MandantService } from '../../mandant/services/mandant.service';
import { BilanzRepository } from '../../../common/repositories/bilanz.repository';
import { GuVRepository } from '../../../common/repositories/guv.repository';
import { AnhangRepository } from '../../../common/repositories/anhang.repository';
import { KonsolidierungRepository } from '../../../common/repositories/konsolidierung.repository';
import { CursorCodec, type PaginatedResult } from '../../../common/dto/pagination.dto';
import type { APIKeyContext } from './api-key.service';
import type {
  PublicMandantDto,
  PublicBilanzDto,
  PublicGuVDto,
  PublicAnhangDto,
  PublicJahresabschlussDto,
  PublicBanzSubmissionDto,
} from '../dto/v1-dtos';

/**
 * Service für Public-API-Read-Endpoints (M4 Sprint 1).
 *
 * Alle Read-Pfade gehen durch die bestehenden Module (Mandant/Bilanz/GuV/
 * Anhang/Konsolidierung) — keine direkten Prisma-Queries hier.
 *
 * Mandant-Trennung: jede Query wird gegen `apiKeyContext.kanzleiId`
 * gefiltert. Wir liefern niemals Daten einer fremden Kanzlei.
 */
@Injectable()
export class PublicApiReadService {
  private readonly logger = new Logger(PublicApiReadService.name);

  constructor(
    private readonly mandantService: MandantService,
    private readonly bilanzRepository: BilanzRepository,
    private readonly guvRepository: GuVRepository,
    private readonly anhangRepository: AnhangRepository,
    private readonly konsolidierungRepository: KonsolidierungRepository,
  ) {}

  // ===========================================================================
  // Mandanten
  // ===========================================================================

  /**
   * Baut aus einer bereits seitenweise geholten Zeilenliste (pageSize + 1
   * Eintraege) eine echte Cursor-Seite.
   *
   * Grund fuer den Umbau (Review-Befund M-5): die Public-API lud vorher die
   * KOMPLETTE Liste in den Speicher, schnitt in JS, und gab
   * `nextCursor: null` zurueck. Bei mehr als `pageSize` Treffern meldete sie
   * `hasMore: true` — ein Client, der `nextCursor` folgte (wie die Doku es
   * beschreibt), bekam aber nie eine zweite Seite. Zusaetzlich wuchs der
   * Speicherbedarf mit der Mandantengroesse.
   */
  private toCursorPage<T extends { id: string; updatedAt: Date }>(
    rows: Array<T & { wormObjectKey?: string | null }>,
    pageSize: number,
  ): { items: T[]; nextCursor: string | null; hasMore: boolean } {
    const hasMore = rows.length > pageSize;
    const page = rows.slice(0, pageSize);
    const last = page[page.length - 1];
    return {
      items: page,
      hasMore,
      nextCursor:
        hasMore && last ? CursorCodec.encode(last.id, last.updatedAt.toISOString()) : null,
    };
  }

  async listMandanten(
    ctx: APIKeyContext,
    pagination: { cursor?: string; pageSize?: number },
  ): Promise<PaginatedResult<PublicMandantDto>> {
    const pageSize = Math.min(pagination.pageSize ?? 50, 100);
    const syntheticUser = this.syntheticAuthUser(ctx);

    const result = await this.mandantService.findAll(syntheticUser, {
      cursor: pagination.cursor,
      pageSize,
      kanzleiId: ctx.kanzleiId,
    });

    if (Array.isArray(result)) {
      return {
        items: result.map(this.toPublicMandantDto),
        nextCursor: null,
        total: result.length,
        hasMore: false,
      };
    }
    return {
      items: result.items.map(this.toPublicMandantDto),
      nextCursor: result.nextCursor,
      total: result.total,
      hasMore: result.hasMore,
    };
  }

  async getMandant(
    ctx: APIKeyContext,
    mandantId: string,
  ): Promise<PublicMandantDto> {
    await this.assertMandantInKanzlei(ctx, mandantId);
    const mandant = await this.mandantService.findOne(
      mandantId,
      this.syntheticAuthUser(ctx),
    );
    return this.toPublicMandantDto(mandant);
  }

  // ===========================================================================
  // Bilanzen
  // ===========================================================================

  async listBilanzen(
    ctx: APIKeyContext,
    mandantId: string,
    pagination: { cursor?: string; pageSize?: number; geschaeftsjahr?: number },
  ): Promise<PaginatedResult<PublicBilanzDto>> {
    await this.assertMandantInKanzlei(ctx, mandantId);

    const pageSize = Math.min(pagination.pageSize ?? 20, 100);

    // Echtes Cursor-Paging im Repository (take: pageSize + 1) statt
    // Gesamtliste in den Speicher.
    const rows = await this.bilanzRepository.findByMandantPaginated({
      mandantId,
      cursor: pagination.cursor,
      pageSize: pageSize + 1,
      jahr: pagination.geschaeftsjahr,
    });
    const page = this.toCursorPage(rows, pageSize);
    const [total] = await Promise.all([
      this.bilanzRepository.countByMandant({
        mandantId,
        jahr: pagination.geschaeftsjahr,
      }),
    ]);
    return {
      items: page.items.map(this.toPublicBilanzDto),
      nextCursor: page.nextCursor,
      total,
      hasMore: page.hasMore,
    };
  }

  // ===========================================================================
  // GuV
  // ===========================================================================

  async listGuV(
    ctx: APIKeyContext,
    mandantId: string,
    pagination: { cursor?: string; pageSize?: number; geschaeftsjahr?: number },
  ): Promise<PaginatedResult<PublicGuVDto>> {
    await this.assertMandantInKanzlei(ctx, mandantId);

    const pageSize = Math.min(pagination.pageSize ?? 20, 100);
    const rows = await this.guvRepository.findByMandantPaginated({
      mandantId,
      cursor: pagination.cursor,
      pageSize: pageSize + 1,
      jahr: pagination.geschaeftsjahr,
    });
    const page = this.toCursorPage(rows, pageSize);
    const total = await this.guvRepository.countByMandant({
      mandantId,
      jahr: pagination.geschaeftsjahr,
    });
    return {
      items: page.items.map(this.toPublicGuVDto),
      nextCursor: page.nextCursor,
      total,
      hasMore: page.hasMore,
    };
  }

  // ===========================================================================
  // Anhang
  // ===========================================================================

  async listAnhang(
    ctx: APIKeyContext,
    mandantId: string,
    pagination: { cursor?: string; pageSize?: number; geschaeftsjahr?: number },
  ): Promise<PaginatedResult<PublicAnhangDto>> {
    await this.assertMandantInKanzlei(ctx, mandantId);

    const pageSize = Math.min(pagination.pageSize ?? 20, 100);
    const rows = await this.anhangRepository.findByMandantPaginated({
      mandantId,
      cursor: pagination.cursor,
      pageSize: pageSize + 1,
      jahr: pagination.geschaeftsjahr,
    });
    const page = this.toCursorPage(rows, pageSize);
    const total = await this.anhangRepository.countByMandant({
      mandantId,
      jahr: pagination.geschaeftsjahr,
    });
    return {
      items: page.items.map(this.toPublicAnhangDto),
      nextCursor: page.nextCursor,
      total,
      hasMore: page.hasMore,
    };
  }

  // ===========================================================================
  // Jahresabschluss
  // ===========================================================================

  async listJahresabschluesse(
    ctx: APIKeyContext,
    mandantId: string,
  ): Promise<PublicJahresabschlussDto[]> {
    await this.assertMandantInKanzlei(ctx, mandantId);
    const items = await this.konsolidierungRepository.findJahresabschluesseByMandant(
      mandantId,
    );
    return items.map(this.toPublicJahresabschlussDto);
  }

  // ===========================================================================
  // BAnz-Submissions
  // ===========================================================================

  async listBanzSubmissions(
    ctx: APIKeyContext,
    mandantId: string,
    pagination: { pageSize?: number },
  ): Promise<PaginatedResult<PublicBanzSubmissionDto>> {
    await this.assertMandantInKanzlei(ctx, mandantId);

    // Ehrlich statt vorgetaeuscht: fuer BAnz-Submissions gibt es aktuell KEIN
    // Cursor-Paging im Repository. `cursor` wird deshalb nicht angeboten, und
    // `hasMore` beschreibt nur den Slice dieser einen Antwort — ein Client
    // kann die naechste Seite nicht abrufen.
    //
    // (Praktisch entschaerft: `prisma.banzSubmission` wird im Repository an
    //  KEINER Stelle geschrieben — die Tabelle ist bislang leer. Der Weg zu
    //  echter Paginierung ist, zuerst die Submission-Erzeugung zu
    //  implementieren, dann das Repository um findByMandantPaginated zu
    //  erweitern. Beides gehoert nicht in einen Review-Fix hinein.)
    const pageSize = Math.min(pagination.pageSize ?? 20, 100);
    const items = await this.konsolidierungRepository.findBanzSubmissionsByMandant(
      mandantId,
    );

    return {
      items: items.slice(0, pageSize).map(this.toPublicBanzSubmissionDto),
      nextCursor: null,
      total: items.length,
      hasMore: false,
    };
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  /**
   * Stellt sicher, dass ein Mandant zur kanzleiId des API-Keys gehört.
   * Wirft 404 (kein 403) zur Vermeidung von Existenz-Leaks.
   */
  private async assertMandantInKanzlei(
    ctx: APIKeyContext,
    mandantId: string,
  ): Promise<void> {
    const mandant = await this.mandantService.findOne(
      mandantId,
      this.syntheticAuthUser(ctx),
    );
    if (mandant.kanzleiId !== ctx.kanzleiId) {
      throw new NotFoundException('Mandant nicht gefunden');
    }
  }

  /**
   * Public-Helper: prüft Mandant-Zugehörigkeit zu einer Kanzlei.
   * Wird vom Controller für Mutationen verwendet (POST banz-submissions).
   */
  async assertMandantInKanzleiForApiKey(
    ctx: APIKeyContext,
    mandantId: string,
  ): Promise<void> {
    return this.assertMandantInKanzlei(ctx, mandantId);
  }

  /**
   * Baut einen synthetischen AuthUser aus dem API-Key-Context.
   *
   * Wir konstruieren einen SYSTEM_ADMIN-mit-Mandant-Liste, damit der
   * MandantService seine Zugriffsprüfung passieren lässt. SYSTEM_ADMIN
   * hat alle Rechte — die Mandant-Trennung wird durch unseren
   * kanzleiId-Filter garantiert.
   */
  private syntheticAuthUser(ctx: APIKeyContext): {
    id: string;
    email: string;
    vorname: string;
    nachname: string;
    globalRole: 'SYSTEM_ADMIN';
    mandanten: Array<{ id: string; firmenname: string; rolle: 'KANZLEI_ADMIN' }>;
  } {
    return {
      id: `apikey:${ctx.apiKeyId}`,
      email: `apikey-${ctx.apiKeyId}@public-api.local`,
      vorname: 'Public-API',
      nachname: 'Bot',
      globalRole: 'SYSTEM_ADMIN',
      mandanten: [
        { id: ctx.kanzleiId, firmenname: 'API-Key', rolle: 'KANZLEI_ADMIN' },
      ],
    };
  }

  private toPublicMandantDto = (m: {
    id: string;
    firmenname: string;
    rechtsform: string;
    handelsregister: string | null;
    ustId: string | null;
    groessenklasse: string;
    publishChannel: string;
    adresse: unknown;
  }): PublicMandantDto => {
    const adresse = (m.adresse ?? {}) as {
      strasse?: string;
      plz?: string;
      ort?: string;
      land?: string;
    };
    return {
      id: m.id,
      firmenname: m.firmenname,
      rechtsform: m.rechtsform,
      handelsregister: m.handelsregister,
      ustId: m.ustId,
      groessenklasse: m.groessenklasse,
      publishChannel: m.publishChannel,
      adresse: {
        strasse: adresse.strasse ?? '',
        plz: adresse.plz ?? '',
        ort: adresse.ort ?? '',
        land: adresse.land ?? 'DE',
      },
    };
  };

  private toPublicBilanzDto = (b: {
    id: string;
    mandantId: string;
    geschaeftsjahr: number;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  }): PublicBilanzDto => ({
    id: b.id,
    mandantId: b.mandantId,
    geschaeftsjahr: b.geschaeftsjahr,
    status: b.status,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  });

  private toPublicGuVDto = (g: {
    id: string;
    mandantId: string;
    geschaeftsjahr: number;
    verfahren: string;
    status: string;
  }): PublicGuVDto => ({
    id: g.id,
    mandantId: g.mandantId,
    geschaeftsjahr: g.geschaeftsjahr,
    verfahren: g.verfahren,
    status: g.status,
  });

  private toPublicAnhangDto = (a: {
    id: string;
    mandantId: string;
    geschaeftsjahr: number;
    status: string;
  }): PublicAnhangDto => ({
    id: a.id,
    mandantId: a.mandantId,
    geschaeftsjahr: a.geschaeftsjahr,
    status: a.status,
  });

  private toPublicJahresabschlussDto = (j: {
    id: string;
    mandantId: string;
    geschaeftsjahr: number;
    status: string;
    finalisiertAm: Date | null;
    signiertAm: Date | null;
    eingereichtAm: Date | null;
  }): PublicJahresabschlussDto => ({
    id: j.id,
    mandantId: j.mandantId,
    geschaeftsjahr: j.geschaeftsjahr,
    status: j.status,
    finalisiertAm: j.finalisiertAm,
    signiertAm: j.signiertAm,
    eingereichtAm: j.eingereichtAm,
  });

  private toPublicBanzSubmissionDto = (s: {
    id: string;
    jahresabschlussId: string;
    mandantId: string;
    channel: string;
    status: string;
    banzVorgangsnummer: string | null;
    submittedAt: Date | null;
    jahresabschluss?: { geschaeftsjahr: number };
  }): PublicBanzSubmissionDto => ({
    id: s.id,
    jahresabschlussId: s.jahresabschlussId,
    mandantId: s.mandantId,
    geschaeftsjahr: s.jahresabschluss?.geschaeftsjahr ?? 0,
    channel: s.channel,
    status: s.status,
    banzVorgangsnummer: s.banzVorgangsnummer,
    submittedAt: s.submittedAt,
  });
}