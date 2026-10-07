import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/types/auth-user.types';
import { KonsolidierungService } from '../services/konsolidierung.service';
import { CreateKonsolidierungEinheitDto } from '../dto/create-konsolidierung-einheit.dto';
import type {
  ApplyKonsolidierungResponseDto,
  KonsolidierungEinheitDto,
  KonsolidierungsBuchungDto,
  KonzernSaldenDto,
} from '../dto/konsolidierung-response.dto';

/**
 * Controller für Konzern-Konsolidierung (PublG §11).
 *
 * Endpoints:
 *   GET    /api/konsolidierung/einheiten
 *     — Liste der Konsolidierungs-Einheiten der User-Kanzlei
 *   GET    /api/konsolidierung/einheiten/:id
 *     — Einheit + Buchungen
 *   POST   /api/konsolidierung/einheiten
 *     — Neue Einheit anlegen (WIRTSCHAFTSPRUEFER + KANZLEI_ADMIN)
 *   POST   /api/konsolidierung/einheiten/:id/calculate
 *     — Eliminations-Buchungen automatisch generieren (Vorschau + Insert)
 *   POST   /api/konsolidierung/einheiten/:id/apply
 *     — Konsolidierung anwenden → Konzern-Bilanz + GuV
 *   POST   /api/konsolidierung/einheiten/:id/finalize
 *     — WP-Freigabe (COMPLETED → VALIDATED)
 *   GET    /api/konsolidierung/einheiten/:id/salden
 *     — Aktuelle Konzern-Salden (Aktiva/Passiva/GuV/Goodwill/Badwill)
 */
@Controller('konsolidierung')
@UseGuards(JwtAuthGuard, RolesGuard)
export class KonsolidierungController {
  constructor(private readonly konsolidierungService: KonsolidierungService) {}

  /**
   * GET /api/konsolidierung/einheiten
   */
  @Get('einheiten')
  findAll(@CurrentUser() user: AuthUser): Promise<KonsolidierungEinheitDto[]> {
    return this.konsolidierungService.findAll(user);
  }

  /**
   * GET /api/konsolidierung/einheiten/:id
   */
  @Get('einheiten/:id')
  findOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<KonsolidierungEinheitDto> {
    return this.konsolidierungService.findOne(id, user);
  }

  /**
   * POST /api/konsolidierung/einheiten
   *
   * Nur WIRTSCHAFTSPRUEFER oder KANZLEI_ADMIN.
   */
  @Post('einheiten')
  @Roles('WIRTSCHAFTSPRUEFER', 'KANZLEI_ADMIN')
  async create(
    @Body() dto: CreateKonsolidierungEinheitDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<KonsolidierungEinheitDto> {
    return this.konsolidierungService.createEinheit(dto, user, {
      ip: req.ip ?? null,
      userAgent: this.userAgent(req),
    });
  }

  /**
   * POST /api/konsolidierung/einheiten/:id/calculate
   *
   * Berechnet Eliminations-Buchungen und persistiert sie.
   * Nur WIRTSCHAFTSPRUEFER + KANZLEI_ADMIN.
   */
  // Berechnung erzeugt kein neues Resource — Nest wuerde sonst 201
  // zurueckgeben. Der API-Vertrag (und die e2e-Spec) erwarten 200.
  @HttpCode(HttpStatus.OK)
  @Post('einheiten/:id/calculate')
  @Roles('WIRTSCHAFTSPRUEFER', 'KANZLEI_ADMIN')
  async calculate(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<KonsolidierungsBuchungDto[]> {
    return this.konsolidierungService.calculateBuchungen(id, user, {
      ip: req.ip ?? null,
      userAgent: this.userAgent(req),
    });
  }

  /**
   * POST /api/konsolidierung/einheiten/:id/apply
   *
   * Erzeugt Konzern-Bilanz + Konzern-GuV.
   * Nur WIRTSCHAFTSPRUEFER + KANZLEI_ADMIN.
   */
  @Post('einheiten/:id/apply')
  @Roles('WIRTSCHAFTSPRUEFER', 'KANZLEI_ADMIN')
  async apply(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<ApplyKonsolidierungResponseDto> {
    return this.konsolidierungService.applyKonsolidierung(id, user, {
      ip: req.ip ?? null,
      userAgent: this.userAgent(req),
    });
  }

  /**
   * POST /api/konsolidierung/einheiten/:id/finalize
   *
   * WP-Freigabe: COMPLETED → VALIDATED.
   */
  @Post('einheiten/:id/finalize')
  @Roles('WIRTSCHAFTSPRUEFER', 'KANZLEI_ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  async finalize(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<void> {
    await this.konsolidierungService.finalizeEinheit(id, user, {
      ip: req.ip ?? null,
      userAgent: this.userAgent(req),
    });
  }

  /**
   * DELETE /api/konsolidierung/einheiten/:id
   *
   * Bugfix 2026-10-07 (fehlte vollstaendig). `@@unique([mutterMandantId,
   * geschaeftsjahr])` bedeutet: eine Einheit belegt dieses Jahr
   * dauerhaft. Nach einem abgebrochenen Versuch — z.B. wenn `apply`
   * fachlich nicht anwendbar war — gab es keinen Weg zurueck und kein
   * Weg, fuer dasselbe Jahr neu zu beginnen.
   *
   * Nur im Entwurfszustand (DRAFT / IN_PROGRESS). Ab COMPLETED
   * existieren Konzern-Bilanz und Konzern-GuV; das ist ein
   * Aufzeichnungsstand nach § 147 AO und wird nicht entfernt.
   */
  @Delete('einheiten/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('WIRTSCHAFTSPRUEFER', 'KANZLEI_ADMIN')
  async deleteEinheit(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<void> {
    await this.konsolidierungService.deleteEinheit(id, user, {
      ip: req.ip ?? null,
      userAgent: this.userAgent(req),
    });
  }

  /**
   * GET /api/konsolidierung/einheiten/:id/salden
   */
  @Get('einheiten/:id/salden')
  getSalden(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<KonzernSaldenDto> {
    return this.konsolidierungService.calculateKonzernSalden(id, user);
  }

  private userAgent(req: Request): string | null {
    const ua = req.headers['user-agent'];
    return typeof ua === 'string' ? ua : null;
  }
}