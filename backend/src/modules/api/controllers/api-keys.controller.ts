import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/types/auth-user.types';
import { ApiKeyService } from '../services/api-key.service';
import { KanzleiRepository } from '../../../common/repositories/kanzlei.repository';
import {
  ApiKeyDto,
  CreateApiKeyDto,
  CreateApiKeyResponseDto,
} from '../dto/api-key.dto';

/**
 * Admin-Controller für API-Key-Management (JWT-authentifiziert).
 *
 * Endpoints:
 *   POST   /api/api-keys          — neuen Key erstellen (KANZLEI_ADMIN/SYSTEM_ADMIN)
 *   GET    /api/api-keys          — Liste der Keys der Kanzlei
 *   DELETE /api/api-keys/:id      — Key widerrufen (KANZLEI_ADMIN/SYSTEM_ADMIN)
 *
 * Mandant-Trennung: Jeder Key ist an genau 1 Kanzlei gebunden. KANZLEI_ADMIN
 * darf nur eigene Kanzlei verwalten; SYSTEM_ADMIN darf jede Kanzlei.
 *
 * Bei Create: Plaintext-Secret wird EINMAL zurückgegeben — danach nicht
 * mehr lesbar. Der Hash bleibt in der DB (keyHash).
 */
@ApiTags('api-keys')
@ApiBearerAuth()
@Controller('api-keys')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('KANZLEI_ADMIN')
export class ApiKeysController {
  constructor(
    private readonly apiKeyService: ApiKeyService,
    private readonly kanzleiRepository: KanzleiRepository,
  ) {}

  /**
   * POST /api/api-keys
   *
   * `kanzleiId` wird im Body übergeben. SYSTEM_ADMIN darf jede Kanzlei
   * adressieren; KANZLEI_ADMIN nur die eigene.
   */
  @Post()
  @ApiOperation({
    summary: 'API-Key erstellen',
    description:
      'Erstellt einen neuen API-Key für die angegebene Kanzlei. ' +
      'Plaintext-Secret wird EINMAL zurückgegeben — sicher kopieren!',
  })
  @ApiResponse({
    status: 201,
    description: 'API-Key erfolgreich erstellt',
    type: CreateApiKeyResponseDto,
  })
  async create(
    @Body() body: CreateApiKeyDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<CreateApiKeyResponseDto> {
    return this.apiKeyService.createApiKey(body, user, this.context(req));
  }

  /**
   * GET /api/api-keys
   */
  @Get()
  @ApiOperation({
    summary: 'API-Keys einer Kanzlei auflisten',
  })
  @ApiResponse({
    status: 200,
    description: 'Liste der API-Keys (maskiert — kein plaintextSecret)',
    type: [ApiKeyDto],
  })
  async list(@CurrentUser() user: AuthUser): Promise<ApiKeyDto[]> {
    const kanzleiId = await this.resolveKanzleiId(user);
    return this.apiKeyService.listApiKeys(kanzleiId, user);
  }

  /**
   * DELETE /api/api-keys/:id
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'API-Key widerrufen',
  })
  @ApiResponse({ status: 204, description: 'Key widerrufen' })
  async revoke(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<void> {
    await this.apiKeyService.revokeApiKey(id, user, this.context(req));
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

  /**
   * Bestimmt die Kanzlei-ID des aktuellen Users.
   *
   * - SYSTEM_ADMIN: erste Kanzlei der DB (Pilot-Single-Tenant-Annahme).
   * - KANZLEI_ADMIN: Kanzlei des ersten zugänglichen Mandanten.
   */
  private async resolveKanzleiId(user: AuthUser): Promise<string> {
    if (user.globalRole === 'SYSTEM_ADMIN') {
      const firstKanzlei = await this.kanzleiRepository.findFirstKanzlei();
      if (!firstKanzlei) {
        throw new ForbiddenException('Keine Kanzlei vorhanden');
      }
      return firstKanzlei.id;
    }
    const firstMandant = user.mandanten[0];
    if (!firstMandant) {
      throw new ForbiddenException('Keine zugängliche Kanzlei');
    }
    const kanzlei = await this.kanzleiRepository.findByMandantId(
      firstMandant.id,
    );
    if (!kanzlei) {
      throw new ForbiddenException('Kanzlei nicht gefunden');
    }
    return kanzlei.id;
  }
}