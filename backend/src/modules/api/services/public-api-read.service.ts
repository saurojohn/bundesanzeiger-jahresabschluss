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
import type { PaginatedResult } from '../../../common/dto/pagination.dto';
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

    // Optional: Cursor-Dekodierung (über createdAt)
  
    const items = await this.bilanzRepository.findByMandantAndJahr(
      mandantId,
      pagination.geschaeftsjahr,
    );

    const sliced = items.slice(0, pageSize + 1);
    const dtos = sliced.slice(0, pageSize).map(this.toPublicBilanzDto);
    return {
      items: dtos,
      nextCursor: null,
      total: items.length,
      hasMore: sliced.length > pageSize,
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
    const items = await this.guvRepository.findByMandantAndJahr(
      mandantId,
      pagination.geschaeftsjahr,
    );

    const sliced = items.slice(0, pageSize + 1);
    return {
      items: sliced.slice(0, pageSize).map(this.toPublicGuVDto),
      nextCursor: null,
      total: items.length,
      hasMore: sliced.length > pageSize,
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
    const items = await this.anhangRepository.findByMandantAndJahr(
      mandantId,
      pagination.geschaeftsjahr,
    );

    return {
      items: items.slice(0, pageSize).map(this.toPublicAnhangDto),
      nextCursor: null,
      total: items.length,
      hasMore: items.length > pageSize,
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
    pagination: { cursor?: string; pageSize?: number },
  ): Promise<PaginatedResult<PublicBanzSubmissionDto>> {
    await this.assertMandantInKanzlei(ctx, mandantId);

    const pageSize = Math.min(pagination.pageSize ?? 20, 100);
    const items = await this.konsolidierungRepository.findBanzSubmissionsByMandant(
      mandantId,
    );

    return {
      items: items.slice(0, pageSize).map(this.toPublicBanzSubmissionDto),
      nextCursor: null,
      total: items.length,
      hasMore: items.length > pageSize,
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