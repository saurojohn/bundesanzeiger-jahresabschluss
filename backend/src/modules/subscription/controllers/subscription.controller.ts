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
   */
  @Get('tiers')
  @HttpCode(HttpStatus.OK)
  getTiers(): { tiers: ReturnType<FeatureFlagService['getAllTierConfigs']> } {
    return { tiers: this.featureFlags.getAllTierConfigs() };
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