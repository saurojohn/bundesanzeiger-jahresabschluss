import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { SubscriptionService } from '../services/subscription.service';
import { FeatureFlagService } from '../services/feature-flag.service';
import type { AuthUser } from '../../auth/types/auth-user.types';
import {
  CancelResponseDto,
  CheckoutResponseDto,
  CreateCheckoutDto,
  MockActivateDto,
  PortalResponseDto,
  SubscriptionResponseDto,
} from '../dto/subscription.dto';
import type { SubscriptionTier } from '../constants/subscription-tier.constants';

/**
 * Subscription-Controller (M4 Sprint 3).
 *
 * Endpoints:
 *   - GET    /api/subscription/tiers                       — Pricing-Page (öffentlich)
 *   - GET    /api/subscription/:kanzleiId                  — Aktuelle Subscription
 *   - POST   /api/subscription/:kanzleiId/checkout         — Stripe-Checkout starten
 *   - POST   /api/subscription/:kanzleiId/mock-activate    — Mock-Direkt-Aktivierung (Dev)
 *   - GET    /api/subscription/:kanzleiId/portal           — Stripe-Customer-Portal
 *   - POST   /api/subscription/:kanzleiId/cancel           — Kündigen
 *
 * RBAC:
 *   - GET: alle User der Kanzlei
 *   - POST: nur KANZLEI_ADMIN oder SYSTEM_ADMIN
 */
@Controller('subscription')
@SkipThrottle() // Pricing-Page wird oft von Bots gecrawlt
export class SubscriptionController {
  constructor(
    private readonly subscriptionService: SubscriptionService,
    private readonly featureFlags: FeatureFlagService,
  ) {}

  /**
   * Public Pricing-Page — liefert alle Tier-Configs.
   *
   * `features` ist intern ein `ReadonlySet`, und `Set` ist in JSON nicht
   * serialisierbar: `JSON.stringify(new Set(['a']))` ergibt `{}`. Bis
   * 2026-10-03 kam deshalb `features: {}` an den Client — die Pricing-Seite
   * zeigte keine einzige Feature-Zeile, ohne dass ein Fehler auftrat.
   * Hier wird deshalb explizit auf ein Array abgebildet.
   */
  @Get('tiers')
  @HttpCode(HttpStatus.OK)
  getTiers(): {
    tiers: Array<{
      tier: string;
      displayName: string;
      description: string;
      pricePerMonthEur: number;
      maxMandanten: number;
      features: string[];
    }>;
  } {
    return {
      tiers: this.featureFlags.getAllTierConfigs().map((t) => ({
        tier: t.tier,
        displayName: t.displayName,
        description: t.description,
        pricePerMonthEur: t.pricePerMonthEur,
        // `Number.POSITIVE_INFINITY` ist in JSON ebenfalls `null`.
        maxMandanten: Number.isFinite(t.maxMandanten) ? t.maxMandanten : -1,
        features: Array.from(t.features),
      })),
    };
  }

  @Get(':kanzleiId')
  @HttpCode(HttpStatus.OK)
  async getSubscription(
    @Param('kanzleiId', new ParseUUIDPipe()) kanzleiId: string,
    @Req() req: Request,
  ): Promise<SubscriptionResponseDto> {
    return this.subscriptionService.getSubscription(kanzleiId, req.user as AuthUser);
  }

  @Post(':kanzleiId/checkout')
  @HttpCode(HttpStatus.OK)
  async createCheckout(
    @Param('kanzleiId', new ParseUUIDPipe()) kanzleiId: string,
    @Body() dto: CreateCheckoutDto,
    @Req() req: Request,
  ): Promise<CheckoutResponseDto> {
    return this.subscriptionService.createCheckout(
      kanzleiId,
      req.user as AuthUser,
      dto.tier,
      dto.successUrl,
      dto.cancelUrl,
      { ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined },
    );
  }

  @Post(':kanzleiId/mock-activate')
  @HttpCode(HttpStatus.OK)
  async mockActivate(
    @Param('kanzleiId', new ParseUUIDPipe()) kanzleiId: string,
    @Body() dto: MockActivateDto,
    @Req() req: Request,
  ): Promise<SubscriptionResponseDto> {
    return this.subscriptionService.mockActivate(
      kanzleiId,
      req.user as AuthUser,
      dto.tier as SubscriptionTier,
      dto.mockSession,
      { ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined },
    );
  }

  @Get(':kanzleiId/portal')
  @HttpCode(HttpStatus.OK)
  async getPortal(
    @Param('kanzleiId', new ParseUUIDPipe()) kanzleiId: string,
    @Query('returnUrl') returnUrl: string,
    @Req() req: Request,
  ): Promise<PortalResponseDto> {
    const result = await this.subscriptionService.getPortalUrl(
      kanzleiId,
      req.user as AuthUser,
      returnUrl ?? '/einstellungen/subscription',
    );
    return { url: result.url };
  }

  @Post(':kanzleiId/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @Param('kanzleiId', new ParseUUIDPipe()) kanzleiId: string,
    @Req() req: Request,
  ): Promise<CancelResponseDto> {
    const result = await this.subscriptionService.cancelSubscription(
      kanzleiId,
      req.user as AuthUser,
      { ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined },
    );
    return { canceled: result.canceled, effectiveAt: result.effectiveAt };
  }
}