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
import { AnhangService } from '../services/anhang.service';
import { CreateAnhangDto } from '../dto/create-anhang.dto';
import { UpdateAnhangDto } from '../dto/update-anhang.dto';

/**
 * Controller für Anhang (§ 284-289 HGB).
 */
@Controller('anhang')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AnhangController {
  constructor(private readonly anhangService: AnhangService) {}

  /**
   * GET /api/anhang/templates — Standard-Abschnitts-Templates.
   *
   * Authentifiziert, kein Mandant-Filter (statisch).
   */
  @Get('templates')
  getTemplates() {
    return this.anhangService.getTemplateAbschnitte();
  }

  /**
   * GET /api/anhang?mandantId=&geschaeftsjahr=
   */
  @Get()
  @RequireMandant()
  @UseGuards(MandantGuard)
  findAll(
    @Query('mandantId') mandantId: string,
    @Query('geschaeftsjahr') geschaeftsjahr: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    const jahr =
      typeof geschaeftsjahr === 'string' && geschaeftsjahr.length > 0
        ? Number.parseInt(geschaeftsjahr, 10)
        : undefined;
    return this.anhangService.findAll(mandantId, user, jahr);
  }

  /**
   * GET /api/anhang/:id
   */
  @Get(':id')
  @RequireMandant()
  @UseGuards(MandantGuard)
  findOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query('mandantId') mandantId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.anhangService.findOne(id, mandantId, user);
  }

  /**
   * POST /api/anhang
   */
  @Post()
  @RequireMandant()
  @UseGuards(MandantGuard)
  @Roles('STEUERBERATER', 'KANZLEI_ADMIN')
  create(
    @Body() dto: CreateAnhangDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.anhangService.create(dto, user, {
      ip: req.ip ?? null,
      userAgent: this.userAgent(req),
    });
  }

  /**
   * PATCH /api/anhang/:id
   */
  @Patch(':id')
  @RequireMandant()
  @UseGuards(MandantGuard)
  @Roles('STEUERBERATER', 'KANZLEI_ADMIN')
  async update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateAnhangDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const mandantId =
      (req.query['mandantId'] as string | undefined) ??
      (typeof req.body?.mandantId === 'string' ? req.body.mandantId : undefined);
    if (!mandantId) {
      throw new Error('mandantId erforderlich (Query oder Body)');
    }
    return this.anhangService.update(id, mandantId, dto, user, {
      ip: req.ip ?? null,
      userAgent: this.userAgent(req),
    });
  }

  /**
   * DELETE /api/anhang/:id — nur DRAFT.
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
    await this.anhangService.delete(id, mandantId, user, {
      ip: req.ip ?? null,
      userAgent: this.userAgent(req),
    });
  }

  private userAgent(req: Request): string | null {
    const ua = req.headers['user-agent'];
    return typeof ua === 'string' ? ua : null;
  }
}