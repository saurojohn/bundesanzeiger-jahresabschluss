import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
  NotImplementedException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../../../auth/decorators/public.decorator';
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
// Bugfix 2026-09-28: `path: 'api/v1'` erzeugte unter dem globalen Prefix
// `/api` die Route `/api/api/v1/...` (doppeltes `api`). Jeder Aufruf der
// dokumentierten Public-API unter `/api/v1/...` lief deshalb in einen 404.
// Der globale Prefix liefert das `api` bereits — hier gehoert nur `v1` rein.
@Controller({ path: 'v1', version: '1' })
// Der globale JwtAuthGuard (APP_GUARD) laeuft VOR den methoden-/klassen-
// Guards und beantwortete jede Anfrage mit 401 "Nicht authentifiziert" —
// der API-Key kam nie bei ApiKeyGuard an. Mit @Public() ueberspringt der
// JwtGuard, und ApiKeyGuard authentifiziert den Bearer "ak_<keyId>.<secret>".
// Betrifft die gesamte Public-API (M4 Sprint 1), die sonst unbenutzbar war.
@Public()
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
  @RequireScope('banz-submission:write')
  @ApiOperation({
    summary: 'BAnz-Submission erstellen (noch nicht implementiert)',
    description:
      'NICHT IMPLEMENTIERT. Derzeit wird 501 zurueckgegeben.\n\n' +
      'Die frueher hier zurueckgegebene Antwort (202 Accepted mit ' +
      '`id: "placeholder-<timestamp>"`) war fachlich falsch: es wurde ' +
      'nichts persistiert, die ID existierte in der Datenbank nie. ' +
      'Ein Client, der sie gespeichert hat, verweist auf einen ' +
      'Datensatz, den es nie gab.\n\n' +
      'Warum das nicht einfach baubar ist: `BanzSubmission` verlangt ' +
      'Pflichtfelder, die ein Public-API-Aufruf nicht liefern kann — ' +
      '`jahresabschlussId` (FK auf einen bereits erstellten ' +
      'Jahresabschluss), `rawPayload` (die generierten XML/XBRL-Daten) ' +
      'und `payloadHash`. Die Erzeugung gehoert in das Ebilanz-Modul, ' +
      'nicht in die Public-API.',
  })
  @ApiResponse({
    status: 501,
    description:
      'Nicht implementiert — es wird kein Datensatz angelegt und keine ID vergeben.',
  })
  async createBanzSubmission(
    @CurrentApiKey() ctx: APIKeyContext,
    @Body() dto: CreatePublicBanzSubmissionDto,
  ): Promise<never> {
    // Berechtigungspruefung bleibt: sie verhindert, dass ein Aufrufer ueber
    // den Fehlerstatus Mandanten fremder Kanzleien enumeriert.
    try {
      await this.readService.assertMandantInKanzleiForApiKey(ctx, dto.mandantId);
    } catch {
      throw new ForbiddenException('Mandant nicht zugänglich');
    }

    // KEIN Verweis auf einen Alternativ-Endpunkt: es gibt derzeit keinen.
    // (Ein solcher Verweis stand in einem ersten Entwurf dieser Meldung —
    //  `POST /api/jahresabschluss/{id}/banz-submission` existiert nicht.)
    throw new NotImplementedException(
      'Die Erstellung einer BAnz-Submission ueber die Public-API ist nicht ' +
        'implementiert. Es wurde NICHTS angelegt und keine Auftragsnummer ' +
        'vergeben. Einzelauskunft: derzeit existiert im System kein ' +
        'Endpunkt, der eine BAnz-Submission anlegt.',
    );
  }

  private parsePageSize(raw: string | undefined, fallback: number): number {
    if (typeof raw !== 'string' || raw.length === 0) return fallback;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.min(n, 100);
  }
}