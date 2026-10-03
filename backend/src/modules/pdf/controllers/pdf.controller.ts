import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { MandantGuard } from '../../auth/guards/mandant.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { MandantId } from '../../auth/decorators/mandant-id.decorator';
import { RequireMandant } from '../../auth/decorators/require-mandant.decorator';
import { requireMandantId } from '../../auth/utils/resolve-mandant-id';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/types/auth-user.types';
import { PdfService } from '../services/pdf.service';
import type { PdfGenerationResponse } from '../interfaces/pdf-document.interface';

/**
 * Controller für PDF-Generierung + Download.
 *
 * Endpoints (alle mandant-isoliert):
 *   POST /api/pdf/bilanz/:id/generate         — STEUERBERATER/KANZLEI_ADMIN
 *   GET  /api/pdf/bilanz/:id/download         — authentifiziert (alle Rollen)
 *   POST /api/pdf/guv/:id/generate            — STEUERBERATER/KANZLEI_ADMIN
 *   GET  /api/pdf/guv/:id/download            — authentifiziert
 *   POST /api/pdf/anhang/:id/generate         — STEUERBERATER/KANZLEI_ADMIN
 *   GET  /api/pdf/anhang/:id/download         — authentifiziert
 *   POST /api/pdf/abschluss/:id/generate      — STEUERBERATER/KANZLEI_ADMIN
 *   GET  /api/pdf/abschluss/:id/download      — authentifiziert
 *
 * Mandant-Trennung wird sowohl über `MandantGuard` als auch im
 * Service (Repository-Filter) erzwungen.
 */
@Controller('pdf')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PdfController {
  constructor(private readonly pdfService: PdfService) {}

  // ===========================================================================
  // Bilanz
  // ===========================================================================

  /**
   * POST /api/pdf/bilanz/:id/generate
   *
   * Body: { mandantId }
   * Response: { wormObjectKey, sha256Hash, sizeBytes, uploadedAt, retentionExpiresAt, downloadUrl }
   */
  @Post('bilanz/:id/generate')
  // PDF-Generierung ist eine Umwandlung (Bestehendes -> PDF), keine
  // Ressourcen-Erstellung: 200 statt Nest-Default 201. Deckt sich mit
  // dem API-Vertrag in USER-GUIDE/RUNBOOK und den e2e-Specs.
  @HttpCode(HttpStatus.OK)
  @RequireMandant()
  @UseGuards(MandantGuard)
  @Roles('STEUERBERATER', 'KANZLEI_ADMIN')
  generateBilanz(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: { mandantId?: string } | undefined,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<PdfGenerationResponse> {
    // `body` ist bei POST ohne Rumpf undefined (Express liefert dann kein
    // Objekt) — `body.mandantId` wäre ein TypeError und ergäbe 500 statt
    // einer verwertbaren Meldung. Der optionale Zugriff greift in vier
    // Generate-Endpunkten.
    const mandantId = body?.mandantId ?? this.extractMandantFromRequest(req);
    return this.pdfService.generateBilanzPdf(id, mandantId, user, {
      ip: req.ip ?? null,
      userAgent: this.userAgent(req),
    });
  }

  @Get('bilanz/:id/download')
  @RequireMandant()
  @UseGuards(MandantGuard)
  async downloadBilanz(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @MandantId() mandantId: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.pdfService.downloadForEntity(
      'BILANZ',
      id,
      mandantId,
      user,
      { ip: req.ip ?? null, userAgent: this.userAgent(req) },
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}"`,
    );
    res.setHeader('Content-Length', String(buffer.length));
    res.status(200).end(buffer);
  }

  // ===========================================================================
  // GuV
  // ===========================================================================

  @Post('guv/:id/generate')
  // PDF-Generierung ist eine Umwandlung (Bestehendes -> PDF), keine
  // Ressourcen-Erstellung: 200 statt Nest-Default 201. Deckt sich mit
  // dem API-Vertrag in USER-GUIDE/RUNBOOK und den e2e-Specs.
  @HttpCode(HttpStatus.OK)
  @RequireMandant()
  @UseGuards(MandantGuard)
  @Roles('STEUERBERATER', 'KANZLEI_ADMIN')
  generateGuV(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: { mandantId?: string } | undefined,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<PdfGenerationResponse> {
    // `body` ist bei POST ohne Rumpf undefined (Express liefert dann kein
    // Objekt) — `body.mandantId` wäre ein TypeError und ergäbe 500 statt
    // einer verwertbaren Meldung. Der optionale Zugriff greift in vier
    // Generate-Endpunkten.
    const mandantId = body?.mandantId ?? this.extractMandantFromRequest(req);
    return this.pdfService.generateGuVPdf(id, mandantId, user, {
      ip: req.ip ?? null,
      userAgent: this.userAgent(req),
    });
  }

  @Get('guv/:id/download')
  @RequireMandant()
  @UseGuards(MandantGuard)
  async downloadGuV(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @MandantId() mandantId: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.pdfService.downloadForEntity(
      'GUV',
      id,
      mandantId,
      user,
      { ip: req.ip ?? null, userAgent: this.userAgent(req) },
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}"`,
    );
    res.setHeader('Content-Length', String(buffer.length));
    res.status(200).end(buffer);
  }

  // ===========================================================================
  // Anhang
  // ===========================================================================

  @Post('anhang/:id/generate')
  // PDF-Generierung ist eine Umwandlung (Bestehendes -> PDF), keine
  // Ressourcen-Erstellung: 200 statt Nest-Default 201. Deckt sich mit
  // dem API-Vertrag in USER-GUIDE/RUNBOOK und den e2e-Specs.
  @HttpCode(HttpStatus.OK)
  @RequireMandant()
  @UseGuards(MandantGuard)
  @Roles('STEUERBERATER', 'KANZLEI_ADMIN')
  generateAnhang(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: { mandantId?: string } | undefined,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<PdfGenerationResponse> {
    // `body` ist bei POST ohne Rumpf undefined (Express liefert dann kein
    // Objekt) — `body.mandantId` wäre ein TypeError und ergäbe 500 statt
    // einer verwertbaren Meldung. Der optionale Zugriff greift in vier
    // Generate-Endpunkten.
    const mandantId = body?.mandantId ?? this.extractMandantFromRequest(req);
    return this.pdfService.generateAnhangPdf(id, mandantId, user, {
      ip: req.ip ?? null,
      userAgent: this.userAgent(req),
    });
  }

  @Get('anhang/:id/download')
  @RequireMandant()
  @UseGuards(MandantGuard)
  async downloadAnhang(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @MandantId() mandantId: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.pdfService.downloadForEntity(
      'ANHANG',
      id,
      mandantId,
      user,
      { ip: req.ip ?? null, userAgent: this.userAgent(req) },
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}"`,
    );
    res.setHeader('Content-Length', String(buffer.length));
    res.status(200).end(buffer);
  }

  // ===========================================================================
  // Abschluss (komplett: Bilanz + GuV + Anhang)
  // ===========================================================================

  @Post('abschluss/:id/generate')
  // PDF-Generierung ist eine Umwandlung (Bestehendes -> PDF), keine
  // Ressourcen-Erstellung: 200 statt Nest-Default 201. Deckt sich mit
  // dem API-Vertrag in USER-GUIDE/RUNBOOK und den e2e-Specs.
  @HttpCode(HttpStatus.OK)
  @RequireMandant()
  @UseGuards(MandantGuard)
  @Roles('STEUERBERATER', 'KANZLEI_ADMIN')
  generateAbschluss(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: { mandantId?: string } | undefined,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<PdfGenerationResponse> {
    // `body` ist bei POST ohne Rumpf undefined (Express liefert dann kein
    // Objekt) — `body.mandantId` wäre ein TypeError und ergäbe 500 statt
    // einer verwertbaren Meldung. Der optionale Zugriff greift in vier
    // Generate-Endpunkten.
    const mandantId = body?.mandantId ?? this.extractMandantFromRequest(req);
    return this.pdfService.generateAbschlussPdf(id, mandantId, user, {
      ip: req.ip ?? null,
      userAgent: this.userAgent(req),
    });
  }

  @Get('abschluss/:id/download')
  @RequireMandant()
  @UseGuards(MandantGuard)
  async downloadAbschluss(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @MandantId() mandantId: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.pdfService.downloadForEntity(
      'ABSCHLUSS',
      id,
      mandantId,
      user,
      { ip: req.ip ?? null, userAgent: this.userAgent(req) },
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}"`,
    );
    res.setHeader('Content-Length', String(buffer.length));
    res.status(200).end(buffer);
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private userAgent(req: Request): string | null {
    const ua = req.headers['user-agent'];
    return typeof ua === 'string' ? ua : null;
  }

  private extractMandantFromRequest(req: Request): string {
    return requireMandantId(req);
  }
}