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
  Query,
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
import { WebhookService } from '../services/webhook.service';
import { KanzleiRepository } from '../../../common/repositories/kanzlei.repository';
import {
  CreateWebhookSubscriptionDto,
  CreateWebhookSubscriptionResponseDto,
  WebhookDeliveryDto,
  WebhookSubscriptionDto,
} from '../dto/webhook-subscription.dto';

/**
 * Admin-Controller für Webhook-Subscription-Management (JWT-authentifiziert).
 *
 * Endpoints:
 *   POST   /api/webhook-subscriptions            — erstellen (KANZLEI_ADMIN)
 *   GET    /api/webhook-subscriptions            — listen (alle User)
 *   GET    /api/webhook-subscriptions/:id/deliveries — Delivery-History
 *   DELETE /api/webhook-subscriptions/:id        — löschen (KANZLEI_ADMIN)
 *   POST   /api/webhook-subscriptions/:id/test   — Test-Delivery (KANZLEI_ADMIN)
 *
 * Mandant-Trennung: jede Subscription bound an genau 1 Kanzlei.
 * Lese-Pfade sind für alle User der Kanzlei offen; Mutations nur für
 * KANZLEI_ADMIN oder SYSTEM_ADMIN.
 */
@ApiTags('webhook-subscriptions')
@ApiBearerAuth()
@Controller('webhook-subscriptions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WebhookController {
  constructor(
    private readonly webhookService: WebhookService,
    private readonly kanzleiRepository: KanzleiRepository,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Webhook-Subscription erstellen' })
  @ApiResponse({
    status: 201,
    description: 'Subscription erstellt; plaintextSecret wird EINMAL zurückgegeben',
    type: CreateWebhookSubscriptionResponseDto,
  })
  @Roles('KANZLEI_ADMIN')
  async create(
    @Body() body: CreateWebhookSubscriptionDto & { kanzleiId: string },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<CreateWebhookSubscriptionResponseDto> {
    return this.webhookService.createSubscription(
      body,
      user,
      this.context(req),
    );
  }

  @Get()
  @ApiOperation({ summary: 'Subscriptions einer Kanzlei auflisten' })
  @ApiResponse({
    status: 200,
    description: 'Liste (maskiert — kein plaintextSecret)',
    type: [WebhookSubscriptionDto],
  })
  async list(@CurrentUser() user: AuthUser): Promise<WebhookSubscriptionDto[]> {
    const kanzleiId = await this.resolveKanzleiId(user);
    return this.webhookService.listSubscriptions(kanzleiId, user);
  }

  @Get(':id/deliveries')
  @ApiOperation({ summary: 'Delivery-History einer Subscription' })
  @ApiResponse({ status: 200, type: [WebhookDeliveryDto] })
  async listDeliveries(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() user: AuthUser,
    @Query('limit') limitRaw?: string,
  ): Promise<WebhookDeliveryDto[]> {
    const kanzleiId = await this.resolveKanzleiId(user);
    const limit =
      typeof limitRaw === 'string' && limitRaw.length > 0
        ? Math.min(Number.parseInt(limitRaw, 10), 200)
        : 50;
    return this.webhookService.listDeliveries(id, kanzleiId, user, limit);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Webhook-Subscription löschen' })
  @Roles('KANZLEI_ADMIN')
  async delete(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<void> {
    const kanzleiId = await this.resolveKanzleiId(user);
    await this.webhookService.deleteSubscription(
      id,
      kanzleiId,
      user,
      this.context(req),
    );
  }

  @Post(':id/test')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Test-Webhook auslösen',
    description: 'Sendet ein "ping"-Webhook und gibt die Delivery-ID zurück.',
  })
  @Roles('KANZLEI_ADMIN')
  async test(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<{ deliveryId: string }> {
    const kanzleiId = await this.resolveKanzleiId(user);
    return this.webhookService.testDelivery(id, kanzleiId, user);
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private context(req: Request): {
    ip: string | null;
    userAgent: string | null;
  } {
    return {
      ip: req.ip ?? null,
      userAgent: this.userAgent(req),
    };
  }

  private userAgent(req: Request): string | null {
    const ua = req.headers['user-agent'];
    return typeof ua === 'string' ? ua : null;
  }

  private async resolveKanzleiId(user: AuthUser): Promise<string> {
    if (user.globalRole === 'SYSTEM_ADMIN') {
      const first = await this.kanzleiRepository.findFirstKanzlei();
      if (!first) throw new ForbiddenException('Keine Kanzlei vorhanden');
      return first.id;
    }
    const firstMandant = user.mandanten[0];
    if (!firstMandant) {
      throw new ForbiddenException('Keine zugängliche Kanzlei');
    }
    const kanzlei = await this.kanzleiRepository.findByMandantId(
      firstMandant.id,
    );
    if (!kanzlei) throw new ForbiddenException('Kanzlei nicht gefunden');
    return kanzlei.id;
  }
}