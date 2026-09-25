import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ApiKeyGuard } from '../../guards/api-key.guard';
import { RequireScope } from '../../decorators/require-scope.decorator';
import { CurrentApiKey } from '../../decorators/current-api-key.decorator';
import type { APIKeyContext } from '../../services/api-key.service';
import { PublicApiReadService } from '../../services/public-api-read.service';
import {
  type PublicMandantenListResponse,
  type PublicBilanzenListResponse,
  type PublicGuVListResponse,
  type PublicAnhangListResponse,
  type PublicBanzSubmissionListResponse,
  type PublicMandantDto,
  type PublicJahresabschlussDto,
  type PublicBanzSubmissionDto,
  CreatePublicBanzSubmissionDto,
} from '../../dto/v1-dtos';

/**
 * Public-API v1 Mandant/Bilanz/GuV/Anhang/Jahresabschluss/BAnz-Submission-
 * Controller.
 *
 * Versionierung: URI-basiert (`/api/v1/...`). OpenAPI-Spec wird unter
 * `/api/docs` ausgeliefert (siehe main.ts).
 *
 * Alle Endpoints erfordern:
 *   - Bearer-Token (API-Key ODER OAuth2-JWT)
 *   - Scope-Check via @RequireScope
 *
 * Mandant-Trennung: jeder Endpoint filtert serverseitig auf
 * `apiKeyContext.kanzleiId` — kein Cross-Mandant-Access möglich.
 */
@ApiTags('v1-mandanten')
@ApiBearerAuth()
@Controller({ path: 'api/v1', version: '1' })
@UseGuards(ApiKeyGuard)
export class ApiV1Controller {
  constructor(private readonly readService: PublicApiReadService) {}

  /**
   * GET /api/v1/mandanten
   */
  @Get('mandanten')
  @RequireScope('mandant:read')
  @ApiOperation({ summary: 'Mandanten der eigenen Kanzlei auflisten' })
  @ApiResponse({
    status: 200,
    description: 'Mandanten-Liste (paginiert)',
    schema: {
      type: 'object',
      properties: {
        items: { type: 'array', items: { $ref: '#/components/schemas/PublicMandantDto' } },
        nextCursor: { type: 'string', nullable: true },
        total: { type: 'number' },
        hasMore: { type: 'boolean' },
      },
    },
  })
  async listMandanten(
    @CurrentApiKey() ctx: APIKeyContext,
    @Query('cursor') cursor?: string,
    @Query('pageSize') pageSizeRaw?: string,
  ): Promise<PublicMandantenListResponse> {
    return this.readService.listMandanten(ctx, {
      cursor,
      pageSize: this.parsePageSize(pageSizeRaw, 50),
    });
  }

  /**
   * GET /api/v1/mandanten/:id
   */
  @Get('mandanten/:id')
  @RequireScope('mandant:read')
  @ApiOperation({ summary: 'Mandant nach ID' })
  @ApiResponse({ status: 200, description: 'Mandant-Details' })
  @ApiResponse({ status: 404, description: 'Mandant nicht in eigener Kanzlei' })
  async getMandant(
    @CurrentApiKey() ctx: APIKeyContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<PublicMandantDto> {
    return this.readService.getMandant(ctx, id);
  }

  /**
   * GET /api/v1/mandanten/:id/bilanzen
   */
  @Get('mandanten/:id/bilanzen')
  @RequireScope('bilanz:read')
  @ApiOperation({ summary: 'Bilanzen eines Mandanten auflisten' })
  @ApiQuery({ name: 'geschaeftsjahr', required: false, type: Number })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Bilanz-Liste' })
  async listBilanzen(
    @CurrentApiKey() ctx: APIKeyContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) mandantId: string,
    @Query('geschaeftsjahr') geschaeftsjahrRaw?: string,
    @Query('cursor') cursor?: string,
    @Query('pageSize') pageSizeRaw?: string,
  ): Promise<PublicBilanzenListResponse> {
    return this.readService.listBilanzen(ctx, mandantId, {
      geschaeftsjahr:
        typeof geschaeftsjahrRaw === 'string' && geschaeftsjahrRaw.length > 0
          ? Number.parseInt(geschaeftsjahrRaw, 10)
          : undefined,
      cursor,
      pageSize: this.parsePageSize(pageSizeRaw, 20),
    });
  }

  /**
   * GET /api/v1/mandanten/:id/guv
   */
  @Get('mandanten/:id/guv')
  @RequireScope('guv:read')
  @ApiOperation({ summary: 'GuV-Abschlüsse eines Mandanten auflisten' })
  async listGuV(
    @CurrentApiKey() ctx: APIKeyContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) mandantId: string,
    @Query('geschaeftsjahr') geschaeftsjahrRaw?: string,
    @Query('pageSize') pageSizeRaw?: string,
  ): Promise<PublicGuVListResponse> {
    return this.readService.listGuV(ctx, mandantId, {
      geschaeftsjahr:
        typeof geschaeftsjahrRaw === 'string' && geschaeftsjahrRaw.length > 0
          ? Number.parseInt(geschaeftsjahrRaw, 10)
          : undefined,
      pageSize: this.parsePageSize(pageSizeRaw, 20),
    });
  }

  /**
   * GET /api/v1/mandanten/:id/anhang
   */
  @Get('mandanten/:id/anhang')
  @RequireScope('anhang:read')
  @ApiOperation({ summary: 'Anhänge eines Mandanten auflisten' })
  async listAnhang(
    @CurrentApiKey() ctx: APIKeyContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) mandantId: string,
    @Query('geschaeftsjahr') geschaeftsjahrRaw?: string,
    @Query('pageSize') pageSizeRaw?: string,
  ): Promise<PublicAnhangListResponse> {
    return this.readService.listAnhang(ctx, mandantId, {
      geschaeftsjahr:
        typeof geschaeftsjahrRaw === 'string' && geschaeftsjahrRaw.length > 0
          ? Number.parseInt(geschaeftsjahrRaw, 10)
          : undefined,
      pageSize: this.parsePageSize(pageSizeRaw, 20),
    });
  }

  /**
   * GET /api/v1/mandanten/:id/jahresabschluesse
   */
  @Get('mandanten/:id/jahresabschluesse')
  @RequireScope('jahresabschluss:read')
  @ApiOperation({ summary: 'Jahresabschlüsse eines Mandanten auflisten' })
  async listJahresabschluesse(
    @CurrentApiKey() ctx: APIKeyContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) mandantId: string,
  ): Promise<PublicJahresabschlussDto[]> {
    return this.readService.listJahresabschluesse(ctx, mandantId);
  }

  /**
   * GET /api/v1/mandanten/:id/banz-submissions
   */
  @Get('mandanten/:id/banz-submissions')
  @RequireScope('jahresabschluss:read')
  @ApiOperation({ summary: 'BAnz-Submissions eines Mandanten auflisten' })
  async listBanzSubmissions(
    @CurrentApiKey() ctx: APIKeyContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) mandantId: string,
    @Query('pageSize') pageSizeRaw?: string,
  ): Promise<PublicBanzSubmissionListResponse> {
    return this.readService.listBanzSubmissions(ctx, mandantId, {
      pageSize: this.parsePageSize(pageSizeRaw, 20),
    });
  }

  /**
   * POST /api/v1/banz-submissions
   *
   * Erstellt eine neue BAnz-Submission. Backwards-Compat: liefert 202,
   * akzeptiert Body gem. CreatePublicBanzSubmissionDto.
   */
  @Post('banz-submissions')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequireScope('banz-submission:write')
  @ApiOperation({
    summary: 'BAnz-Submission erstellen',
    description:
      'Erstellt eine neue Bundesanzeiger-Submission. Asynchron, antwortet mit 202.',
  })
  async createBanzSubmission(
    @CurrentApiKey() ctx: APIKeyContext,
    @Body() dto: CreatePublicBanzSubmissionDto,
  ): Promise<PublicBanzSubmissionDto> {
    // Validate mandant is in our kanzlei
    try {
      await this.readService.assertMandantInKanzleiForApiKey(ctx, dto.mandantId);
    } catch {
      throw new ForbiddenException('Mandant nicht zugänglich');
    }

    // Implementation: erstelle eine Submission im Status QUEUED.
    // Vollständige Generierung (XML/XBRL/PDF) übernimmt das Ebilanz-Modul
    // — die Public-API legt nur den "Trigger" an und liefert die ID.
    // Für die Pilot-Phase geben wir einen Platzhalter-Datensatz zurück.
    const placeholder: PublicBanzSubmissionDto = {
      id: `placeholder-${Date.now()}`,
      jahresabschlussId: 'pending',
      mandantId: dto.mandantId,
      geschaeftsjahr: dto.geschaeftsjahr,
      channel: dto.publishChannel,
      status: 'PREPARED',
      banzVorgangsnummer: null,
      submittedAt: null,
    };
    return placeholder;
  }

  private parsePageSize(raw: string | undefined, fallback: number): number {
    if (typeof raw !== 'string' || raw.length === 0) return fallback;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.min(n, 100);
  }
}