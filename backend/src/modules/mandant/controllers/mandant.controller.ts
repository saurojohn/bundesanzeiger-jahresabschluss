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
  Req,
  UseGuards,
} from '@nestjs/common';
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

@Controller('mandant')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MandantController {
  constructor(private readonly mandantService: MandantService) {}

  /**
   * GET /api/mandant
   * Liefert alle Mandanten, auf die der User Zugriff hat.
   */
  @Get()
  findAll(@CurrentUser() user: AuthUser): ReturnType<MandantService['findAll']> {
    return this.mandantService.findAll(user);
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
   */
  @Delete(':id')
  @Roles('KANZLEI_ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
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
