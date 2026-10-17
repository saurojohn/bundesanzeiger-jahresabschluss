import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { MandantGuard } from '../../auth/guards/mandant.guard';
import { RequireMandant } from '../../auth/decorators/require-mandant.decorator';
import { MandantId } from '../../auth/decorators/mandant-id.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/types/auth-user.types';
import { AbschlussService } from '../services/abschluss.service';
import { CreateJahresabschlussDto } from '../dto/create-jahresabschluss.dto';
import { FinalizeJahresabschlussDto } from '../dto/finalize-jahresabschluss.dto';

/**
 * Jahresabschluss (§ 314 HGB).
 *
 * BEFUND 2026-10-17: Diese Routen existierten nicht — `GET /api/jahresabschluss`
 * lieferte 404, und die Oberflaeche behandelte das als "leere Liste". Die
 * Anlage fehlte vollstaendig.
 *
 * Umfang: **Anlegen und Lesen.** `finalize` fehlt bewusst und haengt an der
 * offenen Entscheidung zum Bilanz-GuV-Saldoabgleich (Nachtrag 22).
 */
@Controller('jahresabschluss')
@UseGuards(MandantGuard)
export class AbschlussController {
  constructor(private readonly abschlussService: AbschlussService) {}

  /**
   * POST /api/jahresabschluss
   *
   * Verknuepft die drei vorhandenen Saetze des Mandanten und Jahres. Fehlt
   * einer, ist das ein 409 (§ 314 HGB) — kein 400, die Anfrage war richtig.
   */
  @Post()
  @RequireMandant()
  async create(
    @Body() dto: CreateJahresabschlussDto,
    @MandantId() mandantId: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    // Der DTO nennt mandantId, der Guard loest sie auf. Sie muessen
    // uebereinstimmen — sonst wuerde der Aufrufer einen Abschluss fuer einen
    // Mandanten anlegen, den die Berechtigung nicht abdeckt.
    if (dto.mandantId !== mandantId) {
      throw new BadRequestException(
        'mandantId im Body weicht vom Mandanten-Kontext ab',
      );
    }
    return this.abschlussService.create(dto, user, {
      ip: req.ip ?? null,
      userAgent: (req.headers['user-agent'] as string) ?? null,
    });
  }

  /**
   * GET /api/jahresabschluss
   *
   * Bis eben 404. Die Oberflaeche fing das als leere Liste ab und zeigte
   * dadurch eine Seite, die nie Inhalt haben konnte.
   */
  @Get()
  @RequireMandant()
  async findAll(
    @MandantId() mandantId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.abschlussService.findAll(mandantId, user);
  }

  /**
   * POST /api/jahresabschluss/:id/finalize
   *
   * Die letzte Instanz vor der Veroeffentlichung: prueft die
   * Vollstaendigkeit und schliesst den Abschluss ab.
   */
  @Post(':id/finalize')
  @RequireMandant()
  async finalize(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: FinalizeJahresabschlussDto,
    @MandantId() mandantId: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.abschlussService.finalize(id, mandantId, dto, user, {
      ip: req.ip ?? null,
      userAgent: (req.headers['user-agent'] as string) ?? null,
    });
  }

  @Get(':id')
  @RequireMandant()
  async findOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @MandantId() mandantId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.abschlussService.findOne(id, mandantId, user);
  }
}
