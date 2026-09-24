/**
 * Controller für DATEV-Import (Reverse — CSV → Bilanz/GuV).
 *
 * Endpoints:
 *   POST /api/datev-import/preview — Mapping-Vorschau (ohne DB-Write)
 *   POST /api/datev-import/execute — Tatsächlicher Import
 *
 * RBAC: STEUERBERATER, KANZLEI_ADMIN.
 * Mandant-Trennung: Service-intern via MandantGuard + assertMandantAccess.
 */
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { MandantGuard } from '../../auth/guards/mandant.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RequireMandant } from '../../auth/decorators/require-mandant.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/types/auth-user.types';
import { DatevImportService } from '../services/datev-import.service';
import { PreviewDatevImportDto } from '../dto/preview-datev-import.dto';
import { ImportDatevDto } from '../dto/import-datev.dto';
import type {
  ImportPreviewDto,
  ImportResultDto,
} from '../dto/datev-import-response.dto';

@Controller('datev-import')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DatevImportController {
  constructor(private readonly datevImportService: DatevImportService) {}

  /**
   * POST /api/datev-import/preview
   *
   * Parst CSV und liefert Mapping-Vorschau (Saldovortrag + Auto-Mapping +
   * Liste unmapped Konten). Schreibt KEINE Daten.
   */
  @Post('preview')
  @RequireMandant()
  @UseGuards(MandantGuard)
  @Roles('STEUERBERATER', 'KANZLEI_ADMIN')
  @HttpCode(HttpStatus.OK)
  async preview(
    @Body() dto: PreviewDatevImportDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ImportPreviewDto> {
    return this.datevImportService.previewImport(dto, user);
  }

  /**
   * POST /api/datev-import/execute
   *
   * Tatsächlicher Import: parst CSV, baut Bilanz + GuV, persistiert.
   */
  @Post('execute')
  @RequireMandant()
  @UseGuards(MandantGuard)
  @Roles('STEUERBERATER', 'KANZLEI_ADMIN')
  @HttpCode(HttpStatus.CREATED)
  async execute(
    @Body() dto: ImportDatevDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<ImportResultDto> {
    return this.datevImportService.importFromDatev(dto, user, {
      ip: req.ip ?? null,
      userAgent: this.userAgent(req),
    });
  }

  private userAgent(req: Request): string | null {
    const ua = req.headers['user-agent'];
    return typeof ua === 'string' ? ua : null;
  }
}