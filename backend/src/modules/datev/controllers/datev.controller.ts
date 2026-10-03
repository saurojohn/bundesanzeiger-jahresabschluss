import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { MandantGuard } from '../../auth/guards/mandant.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { MandantId } from '../../auth/decorators/mandant-id.decorator';
import { RequireMandant } from '../../auth/decorators/require-mandant.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/types/auth-user.types';
import { DatevExportService } from '../services/datev-export.service';
import {
  GenerateDatevDto,
  GenerateSachkontenDto,
} from '../dto/generate-datev.dto';
import type {
  DatevMappingPreviewResponse,
  GenerateDatevResponse,
  GenerateSachkontenResponse,
} from '../dto/datev-response.dto';

/**
 * Controller für DATEV-Export (Buchungsstapel + Sachkontenbeschriftungen).
 *
 * Endpoints:
 *   POST /api/datev/generate-buchungsstapel   — CSV-Buchungsstapel (Base64)
 *   POST /api/datev/generate-sachkonten       — Kontenplan-Beschreibungen
 *   GET  /api/datev/preview/:guvId            — Mapping-Preview GuV → DATEV
 *
 * RBAC: STEUERBERATER / WIRTSCHAFTSPRUEFER / KANZLEI_ADMIN.
 */
@Controller('datev')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DatevController {
  constructor(private readonly datevExportService: DatevExportService) {}

  /**
   * POST /api/datev/generate-buchungsstapel
   *
   * Body: { guvId, bilanzId?, skrPlan?, beraternummer, mandantennummer,
   *         sachkontenlaenge?, vonDatum?, bisDatum? }
   * Query: ?mandantId=...
   *
   * Response: { csvBase64, filename, metadata }
   */
  @Post('generate-buchungsstapel')
  @RequireMandant()
  @UseGuards(MandantGuard)
  @Roles('STEUERBERATER', 'WIRTSCHAFTSPRUEFER', 'KANZLEI_ADMIN')
  @HttpCode(HttpStatus.OK)
  async generateBuchungsstapel(
    @Body() dto: GenerateDatevDto,
    @MandantId() mandantId: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<GenerateDatevResponse> {
    return this.datevExportService.generateBuchungsstapel(
      {
        ...dto,
        mandantId,
      },
      user,
      {
        ip: req.ip ?? null,
        userAgent: this.userAgent(req),
      },
    );
  }

  /**
   * POST /api/datev/generate-sachkonten
   *
   * Body: { usedKonten: string[], skrPlan, beraternummer, mandantennummer }
   *
   * Response: { csvBase64, filename, anzahlKonten }
   *
   * KEIN Mandant-Guard — diese Funktion erzeugt nur Konto-Bezeichnungen
   * und benötigt keinen Mandant-Kontext. Die Berater-/Mandantennummern
   * sind fest vorgegeben und werden nicht aus Mandanten-Stammdaten
   * abgeleitet (Mandant-Stammdaten haben aktuell keine DATEV-Berater-
   * Nummer).
   */
  @Post('generate-sachkonten')
  @Roles('STEUERBERATER', 'WIRTSCHAFTSPRUEFER', 'KANZLEI_ADMIN')
  @HttpCode(HttpStatus.OK)
  async generateSachkonten(
    @Body() dto: GenerateSachkontenDto,
  ): Promise<GenerateSachkontenResponse> {
    return this.datevExportService.generateSachkontobeschriftungen(dto);
  }

  /**
   * GET /api/datev/preview/:guvId?mandantId=...&skrPlan=SKR04
   *
   * Mapping-Preview: zeigt, welche GuV-Position auf welches DATEV-Konto
   * gemappt wird (vor der Generierung).
   */
  @Get('preview/:guvId')
  @RequireMandant()
  @UseGuards(MandantGuard)
  @Roles('STEUERBERATER', 'WIRTSCHAFTSPRUEFER', 'KANZLEI_ADMIN')
  async preview(
    @Param('guvId', new ParseUUIDPipe({ version: '4' })) guvId: string,
    @MandantId() mandantId: string,
    @Query('skrPlan') skrPlan: 'SKR03' | 'SKR04' | undefined,
    @CurrentUser() user: AuthUser,
  ): Promise<DatevMappingPreviewResponse> {
    return this.datevExportService.previewMapping({
      guvId,
      mandantId,
      skrPlan,
      user,
    });
  }

  private userAgent(req: Request): string | null {
    const ua = req.headers['user-agent'];
    return typeof ua === 'string' ? ua : null;
  }
}