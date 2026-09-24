import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { BilanzService } from '../services/bilanz.service';
import { CreateBilanzDto } from '../dto/create-bilanz.dto';
import { UpdateBilanzDto } from '../dto/update-bilanz.dto';
import { BilanzValidierungDto } from '../dto/bilanz-validierung.dto';

/**
 * Controller für HGB-Bilanz (Phase 1).
 *
 * Endpoints:
 *   GET    /api/bilanz/schema             — HGB-Schema (öffentlich, authentifiziert)
 *   GET    /api/bilanz                    — Liste (mandant-gefiltert)
 *   GET    /api/bilanz/:id                — Einzelne Bilanz + Positionen
 *   POST   /api/bilanz                    — Anlegen (STEUERBERATER/KANZLEI_ADMIN)
 *   PATCH  /api/bilanz/:id                — Ändern (STEUERBERATER/KANZLEI_ADMIN)
 *   POST   /api/bilanz/:id/validate       — Saldo validieren
 *   DELETE /api/bilanz/:id                — Löschen (nur DRAFT, STEUERBERATER/KANZLEI_ADMIN)
 */
@Controller('bilanz')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BilanzController {
  constructor(private readonly bilanzService: BilanzService) {}

  /**
   * GET /api/bilanz/schema — HGB-Bilanzschema (§ 266 HGB).
   *
   * Authentifiziert, aber ohne Mandant-Bindung (Schema ist statisch).
   */
  @Get('schema')
  getSchema() {
    return this.bilanzService.getHgbSchema();
  }

  /**
   * GET /api/bilanz?mandantId=...&geschaeftsjahr=YYYY&cursor=...&pageSize=20
   *
   * Cursor-Pagination: `cursor` (opak) + `pageSize` (1..100, default 20).
   * Legacy Offset: `page` (1-indexed) + `pageSize`.
   * Ohne Pagination-Parameter: alle Bilanzen des Mandanten (Array).
   *
   * `mandantId` kommt aus Query (oder Header `x-mandant-id`).
   */
  @Get()
  @RequireMandant()
  @UseGuards(MandantGuard)
  findAll(
    @Query('mandantId') mandantId: string,
    @Query('geschaeftsjahr') geschaeftsjahr: string | undefined,
    @Query('cursor') cursor: string | undefined,
    @Query('pageSize') pageSizeRaw: string | undefined,
    @Query('page') pageRaw: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    const jahr =
      typeof geschaeftsjahr === 'string' && geschaeftsjahr.length > 0
        ? Number.parseInt(geschaeftsjahr, 10)
        : undefined;
    const pageSize =
      typeof pageSizeRaw === 'string' && pageSizeRaw.length > 0
        ? Math.min(Number.parseInt(pageSizeRaw, 10), 100)
        : undefined;
    const page =
      typeof pageRaw === 'string' && pageRaw.length > 0
        ? Number.parseInt(pageRaw, 10)
        : undefined;
    return this.bilanzService.findAll(mandantId, user, jahr, {
      cursor,
      pageSize,
      page,
    });
  }

  /**
   * GET /api/bilanz/:id
   */
  @Get(':id')
  @RequireMandant()
  @UseGuards(MandantGuard)
  findOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query('mandantId') mandantId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.bilanzService.findOne(id, mandantId, user);
  }

  /**
   * POST /api/bilanz
   *
   * STEUERBERATER oder KANZLEI_ADMIN (RBAC).
   */
  @Post()
  @RequireMandant()
  @UseGuards(MandantGuard)
  @Roles('STEUERBERATER', 'KANZLEI_ADMIN')
  create(
    @Body() dto: CreateBilanzDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.bilanzService.create(dto, user, {
      ip: req.ip ?? null,
      userAgent: this.userAgent(req),
    });
  }

  /**
   * PATCH /api/bilanz/:id
   */
  @Patch(':id')
  @RequireMandant()
  @UseGuards(MandantGuard)
  @Roles('STEUERBERATER', 'KANZLEI_ADMIN')
  async update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateBilanzDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const mandantId =
      (req.query['mandantId'] as string | undefined) ??
      (typeof req.body?.mandantId === 'string' ? req.body.mandantId : undefined);
    if (!mandantId) {
      throw new Error('mandantId erforderlich (Query oder Body)');
    }
    return this.bilanzService.update(id, mandantId, dto, user, {
      ip: req.ip ?? null,
      userAgent: this.userAgent(req),
    });
  }

  /**
   * POST /api/bilanz/:id/validate
   *
   * Liefert Saldo-Validierung (Aktiva == Passiva).
   */
  @Post(':id/validate')
  @RequireMandant()
  @UseGuards(MandantGuard)
  validate(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query('mandantId') mandantId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<BilanzValidierungDto> {
    return this.bilanzService.validate(id, mandantId, user);
  }

  /**
   * DELETE /api/bilanz/:id — nur DRAFT.
   */
  @Delete(':id')
  @RequireMandant()
  @UseGuards(MandantGuard)
  @Roles('STEUERBERATER', 'KANZLEI_ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query('mandantId') mandantId: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<void> {
    await this.bilanzService.delete(id, mandantId, user, {
      ip: req.ip ?? null,
      userAgent: this.userAgent(req),
    });
  }

  private userAgent(req: Request): string | null {
    const ua = req.headers['user-agent'];
    return typeof ua === 'string' ? ua : null;
  }
}