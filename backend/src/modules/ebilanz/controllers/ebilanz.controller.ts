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
import { RequireMandant } from '../../auth/decorators/require-mandant.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/types/auth-user.types';
import { XbrlGeneratorService } from '../services/xbrl-generator.service';
import { XbrlValidatorService } from '../services/xbrl-validator.service';
import { GenerateEbilanzDto, ValidateEbilanzDto } from '../dto/generate-ebilanz.dto';
import type {
  GenerateEbilanzResponse,
  ValidationResultDto,
  MappingPreviewResponse,
} from '../dto/validation-result.dto';

/**
 * Controller für E-Bilanz-XBRL-Generierung und -Validierung.
 *
 * Endpoints:
 *   POST /api/ebilanz/generate                   — XBRL generieren
 *   POST /api/ebilanz/validate                   — XBRL validieren
 *   GET  /api/ebilanz/preview/:bilanzId/:guvId/:anhangId
 *
 * RBAC: STEUERBERATER / WIRTSCHAFTSPRUEFER / KANZLEI_ADMIN.
 */
@Controller('ebilanz')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EbilanzController {
  constructor(
    private readonly generatorService: XbrlGeneratorService,
    private readonly validatorService: XbrlValidatorService,
  ) {}

  /**
   * POST /api/ebilanz/generate
   *
   * Erzeugt eine XBRL-Instance nach HGB-Kerntaxonomie v6.
   */
  @Post('generate')
  @RequireMandant()
  @UseGuards(MandantGuard)
  @Roles('STEUERBERATER', 'WIRTSCHAFTSPRUEFER', 'KANZLEI_ADMIN')
  @HttpCode(HttpStatus.OK)
  async generate(
    @Body() dto: GenerateEbilanzDto,
    @Query('mandantId') mandantId: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<GenerateEbilanzResponse> {
    return this.generatorService.generateEbilanzXbrl(
      {
        bilanzId: dto.bilanzId,
        guvId: dto.guvId,
        anhangId: dto.anhangId,
        mandantId,
        preparer: dto.preparer,
      },
      user,
      {
        ip: req.ip ?? null,
        userAgent: this.userAgent(req),
      },
    );
  }

  /**
   * POST /api/ebilanz/validate
   *
   * Validiert eine vorhandene XBRL-Datei (base64-kodiert). Erfordert
   * keinen Mandant-Context, da die Datei beliebig sein kann.
   */
  @Post('validate')
  @Roles('STEUERBERATER', 'WIRTSCHAFTSPRUEFER', 'KANZLEI_ADMIN')
  @HttpCode(HttpStatus.OK)
  async validate(
    @Body() dto: ValidateEbilanzDto,
  ): Promise<ValidationResultDto> {
    return this.validatorService.validateXbrl(dto.xbrlBase64);
  }

  /**
   * GET /api/ebilanz/preview/:bilanzId/:guvId/:anhangId?mandantId=...
   *
   * Liefert ein Mapping-Preview, das zeigt, welche Bilanz-/GuV-Positionen
   * auf welche Taxonomie-Codes gemappt werden.
   */
  @Get('preview/:bilanzId/:guvId/:anhangId')
  @RequireMandant()
  @UseGuards(MandantGuard)
  @Roles('STEUERBERATER', 'WIRTSCHAFTSPRUEFER', 'KANZLEI_ADMIN')
  async preview(
    @Param('bilanzId', new ParseUUIDPipe({ version: '4' })) bilanzId: string,
    @Param('guvId', new ParseUUIDPipe({ version: '4' })) guvId: string,
    @Param('anhangId', new ParseUUIDPipe({ version: '4' })) anhangId: string,
    @Query('mandantId') mandantId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<MappingPreviewResponse> {
    return this.generatorService.previewMapping({
      bilanzId,
      guvId,
      anhangId,
      mandantId,
      user,
    });
  }

  private userAgent(req: Request): string | null {
    const ua = req.headers['user-agent'];
    return typeof ua === 'string' ? ua : null;
  }
}