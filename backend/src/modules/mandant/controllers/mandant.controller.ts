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
import { ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { MandantGuard } from '../../auth/guards/mandant.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/types/auth-user.types';
import { CreateMandantDto } from '../dto/create-mandant.dto';
import { UpdateMandantDto } from '../dto/update-mandant.dto';
import { MandantService } from '../services/mandant.service';
import { pageSizePipe } from '../../../common/dto/pagination.dto';

@Controller('mandant')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MandantController {
  constructor(private readonly mandantService: MandantService) {}

  /**
   * GET /api/mandant?cursor=&pageSize=&kanzleiId=
   *
   * Ohne Pagination: alle Mandanten des Users (Array, Backwards-Compat).
   * Mit `cursor` oder `pageSize`: cursor-paginierte Antwort.
   */
  @Get()
  findAll(
    @CurrentUser() user: AuthUser,
    @Query('cursor') cursor?: string,
    @Query('pageSize', pageSizePipe) pageSize?: number,
    @Query('kanzleiId') kanzleiId?: string,
  ): ReturnType<MandantService['findAll']> {
    return this.mandantService.findAll(user, {
      cursor,
      pageSize,
      kanzleiId,
    });
  }

  /**
   * GET /api/mandant/:id
   */
  @Get(':id')
  findOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() user: AuthUser,
  ): ReturnType<MandantService['findOne']> {
    return this.mandantService.findOne(id, user);
  }

  /**
   * POST /api/mandant — nur KANZLEI_ADMIN oder SYSTEM_ADMIN.
   */
  @Post()
  @UseGuards(MandantGuard)
  @Roles('KANZLEI_ADMIN')
  create(
    @Body() dto: CreateMandantDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): ReturnType<MandantService['create']> {
    return this.mandantService.create(dto, user, {
      ip: req.ip ?? null,
      userAgent: this.userAgent(req),
    });
  }

  /**
   * PATCH /api/mandant/:id
   */
  @Patch(':id')
  @Roles('KANZLEI_ADMIN')
  update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateMandantDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): ReturnType<MandantService['update']> {
    return this.mandantService.update(id, dto, user, {
      ip: req.ip ?? null,
      userAgent: this.userAgent(req),
    });
  }

  /**
   * DELETE /api/mandant/:id
   *
   * 409, sobald aufbewahrungsrelevante Daten existieren (Jahresabschluss,
   * Bilanz, GuV, Anhang, Bundesanzeiger-Einreichung). Ein Loeschen wuerde
   * per `onDelete: Cascade` die Buchhaltungshistorie und die qeS-Signaturen
   * mit vernichten (§ 147 AO). Siehe Befund 2026-10-09 im Service.
   */
  @Delete(':id')
  @Roles('KANZLEI_ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiResponse({ status: 204, description: 'Mandant geloescht (ohne Buchhaltungsdaten)' })
  @ApiResponse({
    status: 409,
    description:
      'Mandant traegt Buchhaltungsdaten und ist nach § 147 AO nicht loeschbar',
  })
  async delete(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<void> {
    await this.mandantService.delete(id, user, {
      ip: req.ip ?? null,
      userAgent: this.userAgent(req),
    });
  }

  private userAgent(req: Request): string | null {
    const ua = req.headers['user-agent'];
    return typeof ua === 'string' ? ua : null;
  }
}
