import {
  Body,
  Controller,
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
import { MandantGuard } from '../../auth/guards/mandant.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RequireMandant } from '../../auth/decorators/require-mandant.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/types/auth-user.types';
import {
  CreateWPNotizDto,
  UpdateWPNotizStatusDto,
} from '../dto/create-wp-notiz.dto';
import {
  BilanzPruefungsResultDto,
  FinalizeWPPruefungDto,
  StartWPPruefungDto,
  WPNotizDto,
  WPPruefungDto,
  WPPruefungsReportDto,
} from '../dto/wp-pruefung.dto';
import type {
  BilanzPruefungsResultEntity,
  WPNotizEntity,
} from '../wp.repository';
import { IdwPruefungService } from '../services/idw-pruefung.service';
import { WPNotizService } from '../services/wp-notiz.service';
import { WPPruefungService } from '../services/wp-pruefung.service';
import { pageSizePipe } from '../../../common/dto/pagination.dto';

/**
 * Controller für Wirtschaftsprüfung (IDW PS 880).
 *
 * Endpoints:
 *   POST   /api/wp/notizen                  — Notiz erstellen (WP)
 *   PATCH  /api/wp/notizen/:id/status       — Notiz bestätigen (jeder mit Zugriff)
 *   GET    /api/wp/notizen                  — Notizen auflisten
 *   POST   /api/wp/pruefungen               — WP-Prüfung starten (WP)
 *   GET    /api/wp/pruefungen/:id           — Prüfung inkl. Ergebnisse + Notizen
 *   POST   /api/wp/pruefungen/:id/finalize  — Prüfung abschließen (WP)
 *   GET    /api/wp/pruefungen/:id/report    — Markdown-Bericht
 *   GET    /api/wp/bilanz/:id/regeln        — Aktuelle Plausi-Ergebnisse
 *   POST   /api/wp/bilanz/:id/regeln/run    — Plausi neu ausführen
 */
@Controller('wp')
@UseGuards(JwtAuthGuard, RolesGuard, MandantGuard)
export class WPController {
  constructor(
    private readonly wpNotizService: WPNotizService,
    private readonly wpPruefungService: WPPruefungService,
    private readonly idwPruefungService: IdwPruefungService,
  ) {}

  // ===========================================================================
  // Notizen
  // ===========================================================================

  @Post('notizen')
  // Audit-Befund M-1: MandantGuard war bereits per @UseGuards auf der
  // Klasse registriert, steigt aber bei `if (!required) return true`
  // aus. Ohne dieses Decorator lief die Mandantenpruefung fuer diese
  // Route gar nicht — nur der Service hat sie (ueber die referenzierte
  // Entitaet) gerettet. Defense-in-Depth: Guard ZUERST, Service als
  // zweite Schicht.
  @RequireMandant()
  @Roles('WIRTSCHAFTSPRUEFER')
  @HttpCode(HttpStatus.CREATED)
  async createNotiz(
    @Body() dto: CreateWPNotizDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<WPNotizDto> {
    const notiz = await this.wpNotizService.createNotiz(dto, user, {
      ip: req.ip ?? null,
      userAgent: this.userAgent(req),
    });
    return toNotizDto(notiz);
  }

  @Patch('notizen/:id/status')
  // Audit-Befund M-1: MandantGuard war bereits per @UseGuards auf der
  // Klasse registriert, steigt aber bei `if (!required) return true`
  // aus. Ohne dieses Decorator lief die Mandantenpruefung fuer diese
  // Route gar nicht — nur der Service hat sie (ueber die referenzierte
  // Entitaet) gerettet. Defense-in-Depth: Guard ZUERST, Service als
  // zweite Schicht.
  @RequireMandant()
  @Roles('WIRTSCHAFTSPRUEFER', 'STEUERBERATER', 'KANZLEI_ADMIN', 'GF')
  @HttpCode(HttpStatus.OK)
  async updateNotizStatus(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateWPNotizStatusDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<WPNotizDto> {
    const updated = await this.wpNotizService.updateStatus(id, dto.status, user, {
      ip: req.ip ?? null,
      userAgent: this.userAgent(req),
    });
    return toNotizDto(updated);
  }

  @Get('notizen')
  // Audit-Befund M-1: MandantGuard war bereits per @UseGuards auf der
  // Klasse registriert, steigt aber bei `if (!required) return true`
  // aus. Ohne dieses Decorator lief die Mandantenpruefung fuer diese
  // Route gar nicht — nur der Service hat sie (ueber die referenzierte
  // Entitaet) gerettet. Defense-in-Depth: Guard ZUERST, Service als
  // zweite Schicht.
  @RequireMandant()
  async listNotizen(
    @Query('bilanzId') bilanzId: string | undefined,
    @Query('guvId') guvId: string | undefined,
    @Query('status') status: string | undefined,
    @Query('cursor') cursor: string | undefined,
    @Query('pageSize', pageSizePipe) pageSize: number | undefined,
    @CurrentUser() user: AuthUser,
  ): Promise<unknown> {
    const result = await this.wpNotizService.listNotizen(
      {
        bilanzId,
        guvId,
        status:
          status === 'PENDING' ||
          status === 'APPROVED' ||
          status === 'REJECTED' ||
          status === 'NEEDS_REVISION'
            ? status
            : undefined,
        cursor,
        pageSize,
      },
      user,
    );
    // Backwards-Compat: ohne Pagination = Array, mit = PaginatedResult
    if (Array.isArray(result)) {
      return result.map(toNotizDto);
    }
    return {
      ...result,
      items: result.items.map(toNotizDto),
    };
  }

  // ===========================================================================
  // Plausi-Prüfung
  // ===========================================================================

  @Post('bilanz/:bilanzId/regeln/run')
  @RequireMandant()
  @Roles('WIRTSCHAFTSPRUEFER', 'STEUERBERATER', 'KANZLEI_ADMIN')
  async runPruefung(
    @Param('bilanzId', new ParseUUIDPipe({ version: '4' })) bilanzId: string,
    @Body() body: { guvId?: string } | undefined,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<BilanzPruefungsResultDto[]> {
    const results = await this.idwPruefungService.runPruefung(
      { bilanzId, guvId: body?.guvId },
      user,
      { ip: req.ip ?? null, userAgent: this.userAgent(req) },
    );
    return results.map(toResultDto);
  }

  @Get('bilanz/:bilanzId/regeln')
  @RequireMandant()
  async getPruefungsResults(
    @Param('bilanzId', new ParseUUIDPipe({ version: '4' })) bilanzId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<BilanzPruefungsResultDto[]> {
    const results = await this.idwPruefungService.getResults(bilanzId, user);
    return results.map(toResultDto);
  }

  // ===========================================================================
  // WP-Prüfung-Vorgang
  // ===========================================================================

  @Post('pruefungen')
  // Audit-Befund M-1: MandantGuard war bereits per @UseGuards auf der
  // Klasse registriert, steigt aber bei `if (!required) return true`
  // aus. Ohne dieses Decorator lief die Mandantenpruefung fuer diese
  // Route gar nicht — nur der Service hat sie (ueber die referenzierte
  // Entitaet) gerettet. Defense-in-Depth: Guard ZUERST, Service als
  // zweite Schicht.
  @RequireMandant()
  @Roles('WIRTSCHAFTSPRUEFER')
  @HttpCode(HttpStatus.CREATED)
  async startPruefung(
    @Body() dto: StartWPPruefungDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<WPPruefungDto> {
    const pruefung = await this.wpPruefungService.startPruefung(dto, user, {
      ip: req.ip ?? null,
      userAgent: this.userAgent(req),
    });
    const data = await this.wpPruefungService.findOne(pruefung.id, user);
    return toPruefungDto(data.pruefung, data.results, data.notizen);
  }

  @Get('pruefungen/:id')
  // Audit-Befund M-1: MandantGuard war bereits per @UseGuards auf der
  // Klasse registriert, steigt aber bei `if (!required) return true`
  // aus. Ohne dieses Decorator lief die Mandantenpruefung fuer diese
  // Route gar nicht — nur der Service hat sie (ueber die referenzierte
  // Entitaet) gerettet. Defense-in-Depth: Guard ZUERST, Service als
  // zweite Schicht.
  @RequireMandant()
  async findPruefung(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<WPPruefungDto> {
    const data = await this.wpPruefungService.findOne(id, user);
    return toPruefungDto(data.pruefung, data.results, data.notizen);
  }

  @Post('pruefungen/:id/finalize')
  // Audit-Befund M-1: MandantGuard war bereits per @UseGuards auf der
  // Klasse registriert, steigt aber bei `if (!required) return true`
  // aus. Ohne dieses Decorator lief die Mandantenpruefung fuer diese
  // Route gar nicht — nur der Service hat sie (ueber die referenzierte
  // Entitaet) gerettet. Defense-in-Depth: Guard ZUERST, Service als
  // zweite Schicht.
  @RequireMandant()
  @Roles('WIRTSCHAFTSPRUEFER')
  @HttpCode(HttpStatus.OK)
  async finalizePruefung(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: FinalizeWPPruefungDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<WPPruefungDto> {
    const pruefung = await this.wpPruefungService.finalizePruefung(
      id,
      dto,
      user,
      { ip: req.ip ?? null, userAgent: this.userAgent(req) },
    );
    const data = await this.wpPruefungService.findOne(pruefung.id, user);
    return toPruefungDto(data.pruefung, data.results, data.notizen);
  }

  @Get('pruefungen/:id/report')
  // Audit-Befund M-1: MandantGuard war bereits per @UseGuards auf der
  // Klasse registriert, steigt aber bei `if (!required) return true`
  // aus. Ohne dieses Decorator lief die Mandantenpruefung fuer diese
  // Route gar nicht — nur der Service hat sie (ueber die referenzierte
  // Entitaet) gerettet. Defense-in-Depth: Guard ZUERST, Service als
  // zweite Schicht.
  @RequireMandant()
  async getReport(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<WPPruefungsReportDto> {
    const markdown = await this.wpPruefungService.generateReport(id, user);
    return { pruefungId: id, markdownReport: markdown };
  }

  @Get('bilanz/:bilanzId/pruefungen')
  // Audit-Befund M-1: MandantGuard war bereits per @UseGuards auf der
  // Klasse registriert, steigt aber bei `if (!required) return true`
  // aus. Ohne dieses Decorator lief die Mandantenpruefung fuer diese
  // Route gar nicht — nur der Service hat sie (ueber die referenzierte
  // Entitaet) gerettet. Defense-in-Depth: Guard ZUERST, Service als
  // zweite Schicht.
  @RequireMandant()
  async listPruefungenByBilanz(
    @Param('bilanzId', new ParseUUIDPipe({ version: '4' })) bilanzId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<Array<{
    id: string;
    status: string;
    startedAt: string;
    completedAt: string | null;
  }>> {
    const pruefungen = await this.wpPruefungService.listByBilanz(bilanzId, user);
    return pruefungen.map((p) => ({
      id: p.id,
      status: p.status,
      startedAt: p.startedAt.toISOString(),
      completedAt: p.completedAt?.toISOString() ?? null,
    }));
  }

  private userAgent(req: Request): string | null {
    const ua = req.headers['user-agent'];
    return typeof ua === 'string' ? ua : null;
  }
}

// ----------------------------------------------------------------------------
// Mapping helpers
// ----------------------------------------------------------------------------

function toNotizDto(n: WPNotizEntity): WPNotizDto {
  return {
    id: n.id,
    bilanzId: n.bilanzId,
    guvId: n.guvId,
    bilanzPositionId: n.bilanzPositionId,
    guvPositionId: n.guvPositionId,
    wpUserId: n.wpUserId,
    notizText: n.notizText,
    status: n.status as WPNotizDto['status'],
    createdAt: n.createdAt.toISOString(),
    updatedAt: n.updatedAt.toISOString(),
    acknowledgedAt: n.acknowledgedAt?.toISOString() ?? null,
    acknowledgedById: n.acknowledgedById,
  };
}

function toResultDto(r: BilanzPruefungsResultEntity): BilanzPruefungsResultDto {
  return {
    regelCode: r.regelCode,
    status: r.status as BilanzPruefungsResultDto['status'],
    berechneterWert: r.berechneterWert ? Number(r.berechneterWert) : 0,
    schwellwert: r.schwellwert ? Number(r.schwellwert) : 0,
    meldung: r.meldung,
    geprueftAm: r.geprueftAm.toISOString(),
  };
}

function toPruefungDto(
  pruefung: { id: string; bilanzId: string; guvId: string | null; wpUserId: string; status: string; zusammenfassung: string | null; startedAt: Date; completedAt: Date | null },
  results: BilanzPruefungsResultEntity[],
  notizen: WPNotizEntity[],
): WPPruefungDto {
  return {
    id: pruefung.id,
    bilanzId: pruefung.bilanzId,
    guvId: pruefung.guvId,
    wpUserId: pruefung.wpUserId,
    status: pruefung.status as WPPruefungDto['status'],
    zusammenfassung: pruefung.zusammenfassung,
    startedAt: pruefung.startedAt.toISOString(),
    completedAt: pruefung.completedAt?.toISOString() ?? null,
    pruefungsResults: results.map(toResultDto),
    notizen: notizen.map(toNotizDto),
  };
}