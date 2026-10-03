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
import { MandantId } from '../../auth/decorators/mandant-id.decorator';
import { RequireMandant } from '../../auth/decorators/require-mandant.decorator';
import { requireMandantId } from '../../auth/utils/resolve-mandant-id';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/types/auth-user.types';
import { GuVService } from '../services/guv.service';
import { CreateGuVDto } from '../dto/create-guv.dto';
import { UpdateGuVDto } from '../dto/update-guv.dto';
import { GuVValidierungDto } from '../dto/guv-validierung.dto';
import { pageSizePipe } from '../../../common/dto/pagination.dto';

/**
 * Controller für GuV (§ 275 HGB).
 */
@Controller('guv')
@UseGuards(JwtAuthGuard, RolesGuard)
export class GuVController {
  constructor(private readonly guvService: GuVService) {}

  /**
   * GET /api/guv/schema?verfahren=GKV|UKV
   */
  @Get('schema')
  getSchema(@Query('verfahren') verfahren?: string) {
    if (verfahren === 'GKV' || verfahren === 'UKV') {
      return this.guvService.getHgbSchema(verfahren);
    }
    // Default: GKV
    return this.guvService.getHgbSchema('GKV');
  }

  /**
   * GET /api/guv?mandantId=&geschaeftsjahr=&cursor=&pageSize=&page=
   *
   * Cursor-Pagination: `cursor` + `pageSize` (1..100, default 20).
   * Legacy Offset: `page` + `pageSize`.
   */
  @Get()
  @RequireMandant()
  @UseGuards(MandantGuard)
  findAll(
    @MandantId() mandantId: string,
    @Query('geschaeftsjahr') geschaeftsjahr: string | undefined,
    @Query('cursor') cursor: string | undefined,
    @Query('pageSize', pageSizePipe) pageSize: number | undefined,
    @Query('page') pageRaw: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    const jahr =
      typeof geschaeftsjahr === 'string' && geschaeftsjahr.length > 0
        ? Number.parseInt(geschaeftsjahr, 10)
        : undefined;
    const page =
      typeof pageRaw === 'string' && pageRaw.length > 0
        ? Number.parseInt(pageRaw, 10)
        : undefined;
    return this.guvService.findAll(mandantId, user, jahr, {
      cursor,
      pageSize,
      page,
    });
  }

  /**
   * GET /api/guv/:id
   */
  @Get(':id')
  @RequireMandant()
  @UseGuards(MandantGuard)
  findOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @MandantId() mandantId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.guvService.findOne(id, mandantId, user);
  }

  /**
   * POST /api/guv
   */
  @Post()
  @RequireMandant()
  @UseGuards(MandantGuard)
  @Roles('STEUERBERATER', 'KANZLEI_ADMIN')
  create(
    @Body() dto: CreateGuVDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.guvService.create(dto, user, {
      ip: req.ip ?? null,
      userAgent: this.userAgent(req),
    });
  }

  /**
   * PATCH /api/guv/:id
   */
  @Patch(':id')
  @RequireMandant()
  @UseGuards(MandantGuard)
  @Roles('STEUERBERATER', 'KANZLEI_ADMIN')
  async update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateGuVDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const mandantId = requireMandantId(req);
    return this.guvService.update(id, mandantId, dto, user, {
      ip: req.ip ?? null,
      userAgent: this.userAgent(req),
    });
  }

  /**
   * POST /api/guv/:id/validate
   */
  @Post(':id/validate')
  // Validierung ist eine read-only Auswertung, keine Resource-Erstellung:
  // Nest wuerde fuer @Post sonst 201 Created zurueckgeben. Der API-Vertrag
  // (und die e2e-Specs) erwarten 200 OK.
  @HttpCode(HttpStatus.OK)
  @RequireMandant()
  @UseGuards(MandantGuard)
  validate(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @MandantId() mandantId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<GuVValidierungDto> {
    return this.guvService.validate(id, mandantId, user);
  }

  /**
   * DELETE /api/guv/:id — nur DRAFT.
   */
  @Delete(':id')
  @RequireMandant()
  @UseGuards(MandantGuard)
  @Roles('STEUERBERATER', 'KANZLEI_ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @MandantId() mandantId: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<void> {
    await this.guvService.delete(id, mandantId, user, {
      ip: req.ip ?? null,
      userAgent: this.userAgent(req),
    });
  }

  private userAgent(req: Request): string | null {
    const ua = req.headers['user-agent'];
    return typeof ua === 'string' ? ua : null;
  }
}