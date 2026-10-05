import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/types/auth-user.types';
import { BrandingService } from '../services/branding.service';
import { UpdateBrandingDto } from '../dto/update-branding.dto';
import { UploadLogoDto } from '../dto/upload-logo.dto';

/**
 * Controller für White-Label-Branding (M3 Sprint 4+5).
 *
 * Endpoints:
 *   GET    /api/branding/:kanzleiId          — Branding lesen (alle Rollen)
 *   PATCH  /api/branding/:kanzleiId          — Branding aktualisieren (KANZLEI_ADMIN/SYSTEM_ADMIN)
 *   POST   /api/branding/:kanzleiId/logo     — Logo hochladen (KANZLEI_ADMIN/SYSTEM_ADMIN)
 *   DELETE /api/branding/:kanzleiId/logo     — Logo löschen (KANZLEI_ADMIN/SYSTEM_ADMIN)
 *   GET    /api/branding/:kanzleiId/logo/blob — Logo-Binary lesen (alle Rollen, mit Mandant-Trennung)
 *
 * Mandant-Trennung: Die Kanzlei-Trennung wird im BrandingService durchgesetzt
 * (assertKanzleiAccess). Für Lesen reicht ein Kanzlei-Match (User muss
 * mindestens einen Mandanten dieser Kanzlei haben).
 */
@Controller('branding')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BrandingController {
  private readonly logger = new Logger(BrandingController.name);

  constructor(private readonly brandingService: BrandingService) {}

  /**
   * GET /api/branding/:kanzleiId
   */
  @Get(':kanzleiId')
  getBranding(
    @Param('kanzleiId', new ParseUUIDPipe({ version: '4' })) kanzleiId: string,
    @CurrentUser() user: AuthUser,
  ): ReturnType<BrandingService['getBranding']> {
    // Bugfix 2026-10-05: `user` wurde als `_user` empfangen und verworfen —
    // der Lese-Pfad prüfte die Kanzlei-Zugehörigkeit nicht.
    return this.brandingService.getBranding(kanzleiId, user);
  }

  /**
   * PATCH /api/branding/:kanzleiId
   */
  @Patch(':kanzleiId')
  @Roles('KANZLEI_ADMIN')
  updateBranding(
    @Param('kanzleiId', new ParseUUIDPipe({ version: '4' })) kanzleiId: string,
    @Body() dto: UpdateBrandingDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): ReturnType<BrandingService['updateBranding']> {
    return this.brandingService.updateBranding(
      kanzleiId,
      dto,
      user,
      this.context(req),
    );
  }

  /**
   * POST /api/branding/:kanzleiId/logo
   */
  @Post(':kanzleiId/logo')
  @Roles('KANZLEI_ADMIN')
  @HttpCode(HttpStatus.OK)
  async uploadLogo(
    @Param('kanzleiId', new ParseUUIDPipe({ version: '4' })) kanzleiId: string,
    @Body() dto: UploadLogoDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<{ logoUrl: string; logoWormKey: string }> {
    if (!dto.logoBase64 || !dto.mimeType || !dto.filename) {
      throw new BadRequestException(
        'logoBase64, mimeType und filename sind erforderlich',
      );
    }
    return this.brandingService.uploadLogo(
      kanzleiId,
      {
        logoBase64: dto.logoBase64,
        mimeType: dto.mimeType,
        filename: dto.filename,
      },
      user,
      this.context(req),
    );
  }

  /**
   * DELETE /api/branding/:kanzleiId/logo
   */
  @Delete(':kanzleiId/logo')
  @Roles('KANZLEI_ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteLogo(
    @Param('kanzleiId', new ParseUUIDPipe({ version: '4' })) kanzleiId: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<void> {
    await this.brandingService.deleteLogo(kanzleiId, user, this.context(req));
  }

  /**
   * GET /api/branding/:kanzleiId/logo/blob
   *
   * Liefert das Logo-Binary (PNG/JPEG/SVG).
   *
   * Wird vom Frontend (Header) und PDF-Service verwendet.
   */
  @Get(':kanzleiId/logo/blob')
  async getLogoBlob(
    @Param('kanzleiId', new ParseUUIDPipe({ version: '4' })) kanzleiId: string,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ): Promise<void> {
    const logo = await this.brandingService.getLogoBuffer(kanzleiId, user);
    if (!logo) {
      res.status(HttpStatus.NO_CONTENT).end();
      return;
    }
    res.setHeader('Content-Type', logo.contentType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.status(HttpStatus.OK).end(logo.buffer);
  }

  private context(req: Request): { ip: string | null; userAgent: string | null } {
    return {
      ip: req.ip ?? null,
      userAgent: this.userAgent(req),
    };
  }

  private userAgent(req: Request): string | null {
    const ua = req.headers['user-agent'];
    return typeof ua === 'string' ? ua : null;
  }
}