import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CacheManagerService } from '../../../common/cache/cache-manager.service';
import { AuditService } from '../../audit/services/audit.service';
import { KanzleiRepository } from '../../../common/repositories/kanzlei.repository';
import { BillingProviderService } from './billing-provider.service';
import { FeatureFlagService } from './feature-flag.service';
import type { AuthUser } from '../../auth/types/auth-user.types';
import type { SubscriptionTier, SubscriptionStatus } from '../constants/subscription-tier.constants';
import { ACTIVE_STATUSES } from '../constants/subscription-tier.constants';
import type {
  SubscriptionResponseDto,
  CheckoutResponseDto,
} from '../dto/subscription.dto';

/**
 * Subscription-State in der DB (Prisma).
 *
 * Kanzlei-Tabelle enthält:
 *   - subscriptionTier           ('PILOT' | 'STANDARD' | 'PREMIUM')
 *   - subscriptionStatus         ('TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | ...)
 *   - subscriptionProvider       ('stripe' | 'mock')
 *   - subscriptionProviderId     (Stripe-Subscription-ID 'sub_xxx')
 *   - subscriptionPeriodEnd      (DateTime — nächste Abrechnung)
 *   - subscriptionCancelAtEnd    (Boolean — Kündigung zum Periodenende)
 *
 * Schema-Migration erforderlich vor Sprint 3 Go-Live (siehe TODO).
 */
export interface KanzleiSubscriptionData {
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  providerName: 'stripe' | 'mock';
  providerSubscriptionId: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheManagerService,
    private readonly kanzleiRepository: KanzleiRepository,
    private readonly auditService: AuditService,
    private readonly billingProvider: BillingProviderService,
    private readonly featureFlags: FeatureFlagService,
  ) {}

  /**
   * Liest die Subscription einer Kanzlei (mit Cache).
   *
   * Wenn die Kanzlei keine Subscription-Daten hat (Migration noch nicht
   * gelaufen), wird PILOT als Default zurückgegeben.
   */
  async getSubscription(kanzleiId: string, user: AuthUser): Promise<SubscriptionResponseDto> {
    await this.assertKanzleiAccess(kanzleiId, user);
    return this.cache.memoize(
      `subscription:${kanzleiId}`,
      5 * 60 * 1000, // 5 min
      async () => this.loadSubscriptionFromDb(kanzleiId),
    );
  }

  /**
   * Erstellt eine Checkout-Session für einen Tier-Wechsel.
   *
   * Rückgabe enthält die URL zur Stripe-Checkout-Page (oder Mock-URL).
   * Frontend leitet den User dorthin weiter.
   */
  async createCheckout(
    kanzleiId: string,
    user: AuthUser,
    tier: SubscriptionTier,
    successUrl: string,
    cancelUrl: string,
    context: { ip?: string | null; userAgent?: string | null },
  ): Promise<CheckoutResponseDto> {
    await this.assertKanzleiAdminAccess(kanzleiId, user);

    const kanzlei = await this.kanzleiRepository.findById(kanzleiId);
    if (!kanzlei) throw new NotFoundException('Kanzlei nicht gefunden');

    const session = await this.billingProvider
      .getProvider()
      .createCheckoutSession({
        kanzleiId,
        kanzleiName: kanzlei.name,
        tier,
        successUrl,
        cancelUrl,
      });

    // Audit-Trail (Subscription-Checkout gestartet)
    void this.auditService.record({
      userId: user.id,
      kanzleiId,
      action: 'CREATE',
      entityType: 'Subscription',
      entityId: kanzleiId,
      newState: {
        event: 'CHECKOUT_INITIATED',
        tier,
        providerName: this.billingProvider.getProviderName(),
        sessionId: session.sessionId,
      },
      ipAddress: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return {
      url: session.url,
      sessionId: session.sessionId,
      providerName: this.billingProvider.getProviderName(),
    };
  }

  /**
   * Mock-Mode Direkt-Aktivierung (Dev/Pilot only).
   *
   * Setzt den Tier direkt ohne Stripe-Checkout. Sicherheit: nur wenn
   * der Provider-Name 'mock' ist und ein gültiger Mock-Session-Token
   * vorliegt.
   */
  async mockActivate(
    kanzleiId: string,
    user: AuthUser,
    tier: SubscriptionTier,
    mockSession: string,
    context: { ip?: string | null; userAgent?: string | null },
  ): Promise<SubscriptionResponseDto> {
    await this.assertKanzleiAdminAccess(kanzleiId, user);
    if (this.billingProvider.getProviderName() !== 'mock') {
      throw new BadRequestException(
        'mockActivate ist nur im Mock-Provider-Mode verfügbar (STRIPE_SECRET_KEY nicht gesetzt)',
      );
    }
    if (!mockSession.startsWith('mock_')) {
      throw new BadRequestException('Ungültiger Mock-Session-Token');
    }

    await this.applyTierChange(kanzleiId, tier, 'ACTIVE', 'mock', mockSession);

    void this.auditService.record({
      userId: user.id,
      kanzleiId,
      action: 'UPDATE',
      entityType: 'Subscription',
      entityId: kanzleiId,
      newState: { event: 'MOCK_ACTIVATED', tier, mockSession },
      ipAddress: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    await this.cache.invalidate(`subscription:${kanzleiId}`);
    return this.loadSubscriptionFromDb(kanzleiId);
  }

  /**
   * Customer-Portal — User verwaltet seine Subscription selbst.
   * (Stripe-Customer-Portal-URL oder Mock-URL).
   */
  async getPortalUrl(kanzleiId: string, user: AuthUser, returnUrl: string): Promise<{ url: string }> {
    await this.assertKanzleiAdminAccess(kanzleiId, user);
    const kanzlei = await this.kanzleiRepository.findById(kanzleiId);
    if (!kanzlei) throw new NotFoundException('Kanzlei nicht gefunden');
    const providerCustomerId = (kanzlei as unknown as { providerCustomerId?: string }).providerCustomerId;
    if (!providerCustomerId) {
      // Fallback im Mock-Mode
      if (this.billingProvider.getProviderName() === 'mock') {
        return { url: '/api/subscription?mock_portal=1' };
      }
      throw new BadRequestException('Keine aktive Stripe-Customer-ID für diese Kanzlei hinterlegt');
    }
    return this.billingProvider.getProvider().createCustomerPortalSession({
      providerCustomerId,
      returnUrl,
    });
  }

  /**
   * Kündigt die Subscription (zum Periodenende, falls aktiv).
   */
  async cancelSubscription(
    kanzleiId: string,
    user: AuthUser,
    context: { ip?: string | null; userAgent?: string | null },
  ): Promise<{ canceled: boolean; effectiveAt: Date }> {
    await this.assertKanzleiAdminAccess(kanzleiId, user);
    const kanzlei = await this.kanzleiRepository.findById(kanzleiId);
    if (!kanzlei) throw new NotFoundException('Kanzlei nicht gefunden');
    const providerSubId = (kanzlei as unknown as { subscriptionProviderId?: string | null })
      .subscriptionProviderId;
    if (!providerSubId) {
      throw new BadRequestException('Keine aktive Subscription zum Kündigen');
    }
    await this.billingProvider.getProvider().cancelSubscription(providerSubId);

    const effectiveAt = (kanzlei as unknown as { subscriptionPeriodEnd?: Date | null })
      .subscriptionPeriodEnd ?? new Date();

    void this.auditService.record({
      userId: user.id,
      kanzleiId,
      action: 'UPDATE',
      entityType: 'Subscription',
      entityId: kanzleiId,
      newState: { event: 'CANCELED', effectiveAt: effectiveAt.toISOString(), providerSubscriptionId: providerSubId },
      ipAddress: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    await this.cache.invalidate(`subscription:${kanzleiId}`);
    return { canceled: true, effectiveAt };
  }

  /**
   * Wendet einen Tier-Wechsel an (vom Webhook-Service aufgerufen).
   *
   * Wenn der neue Status nicht in ACTIVE_STATUSES ist → Kanzlei wird
   * auf PILOT zurückgestuft (graceful degradation).
   */
  async applyTierChange(
    kanzleiId: string,
    tier: SubscriptionTier,
    status: SubscriptionStatus,
    providerName: 'stripe' | 'mock',
    _providerSubscriptionId: string | null,
    _periodEnd?: Date | null,
  ): Promise<void> {
    // Graceful degradation: wenn Status nicht aktiv, fallen wir auf PILOT zurück
    // (User behält Read-Zugriff, aber keine Premium-Features mehr)
    const effectiveTier: SubscriptionTier =
      status === 'CANCELED' || status === 'UNPAID' || status === 'INCOMPLETE_EXPIRED'
        ? 'PILOT'
        : tier;

    await this.prisma.kanzlei.update({
      where: { id: kanzleiId },
      data: {
        // Bugfix 2026-10-05: `data` war LEER. Der Tier-Wechsel schrieb
        // nichts; das `.catch()` darunter schluckte jeden Fehler und
        // meldete Erfolg. Folge: `mockActivate`, `checkout`, der
        // Stripe-Webhook und `cancel` waren stille No-Ops mit HTTP 200 —
        // eine Kanzlei konnte nie einen bezahlten Tarif erreichen.
        //
        // Die Feldnamen stammen aus dem Prisma-Schema (model Kanzlei):
        // `subscriptionTier`, `subscriptionStatus`, … NICHT `tier`/`status` —
        // siehe das weiter unten liegende `KanzleiSubscriptionData`, das die
        // Logik in der Domäne abbildet, nicht den DB-Spaltennamen.
        subscriptionTier: effectiveTier,
        subscriptionStatus: status,
        subscriptionProvider: providerName,
        subscriptionProviderId: _providerSubscriptionId,
        ...( _periodEnd !== undefined
          ? { subscriptionPeriodEnd: _periodEnd }
          : {}),
      },
    }).catch((err: unknown) => {
      // Kein Verschlucken mehr: ein fehlgeschlagener Tier-Wechsel ist ein
      // Serverfehler, kein Grund fuer eine Erfolgsmeldung. Wir protokollieren
      // und werfen weiter.
      this.logger.error(
        `Subscription-Update fuer ${kanzleiId} fehlgeschlagen: ${String(err)}`,
      );
      throw err;
    });

    await this.cache.invalidate(`subscription:${kanzleiId}`);
    this.logger.log(
      `Subscription-Update: kanzleiId=${kanzleiId} tier=${effectiveTier} status=${status} provider=${providerName}`,
    );
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  private async loadSubscriptionFromDb(kanzleiId: string): Promise<SubscriptionResponseDto> {
    const kanzlei = await this.kanzleiRepository.findById(kanzleiId);
    if (!kanzlei) throw new NotFoundException('Kanzlei nicht gefunden');

    // Bugfix 2026-10-05: Der Read griff auf `data.tier` / `data.status`
    // zu. Die DB-Spalten heißen `subscriptionTier` / `subscriptionStatus`
    // (model Kanzlei, schema.prisma) und werden NICHT umbenannt. Damit
    // war `tier` immer undefined und es griffen durchweg die
    // Spalten-Defaults (PILOT/TRIALING) — ein gespeicherter Premium-Tier
    // wäre nie angekommen. `KanzleiSubscriptionData` bildet die Domaene ab,
    // nicht die DB-Struktur; deshalb wird hier bewusst direkt gelesen.
    const k = kanzlei as unknown as {
      subscriptionTier?: string | null;
      subscriptionStatus?: string | null;
      subscriptionProvider?: string | null;
      subscriptionProviderId?: string | null;
      subscriptionPeriodEnd?: Date | null;
      subscriptionCancelAtEnd?: boolean | null;
    };
    const tier = (k.subscriptionTier ?? 'PILOT') as SubscriptionTier;
    const status = (k.subscriptionStatus ?? 'TRIALING') as SubscriptionStatus;
    const tierConfig = this.featureFlags.getTierConfig(tier);

    return {
      kanzleiId,
      tier,
      status,
      providerName:
        (k.subscriptionProvider as 'stripe' | 'mock' | null | undefined) ??
        this.billingProvider.getProviderName(),
      providerSubscriptionId: k.subscriptionProviderId ?? null,
      currentPeriodEnd: k.subscriptionPeriodEnd ?? null,
      cancelAtPeriodEnd: k.subscriptionCancelAtEnd ?? false,
      maxMandanten: tierConfig.maxMandanten === Number.POSITIVE_INFINITY ? -1 : tierConfig.maxMandanten,
      features: this.featureFlags.getFeatures(tier),
      updatedAt: new Date(),
    };
  }

  /**
   * Zugriff auf die Kanzlei — MANDANT-genau, nicht kanzleiweit.
   *
   * Bugfix 2026-10-05: Der Check war `void` und lief über
   * `.then((m) => { if (!m) throw new ForbiddenException(...) })`. Der `throw`
   * landete in einer VERWAISTEN Promise: die Pruefung wirkte nicht, UND die
   * Rejection war ein `unhandledRejection` — Node >=15 beendet den Prozess
   * damit. Ein angemeldeter Benutzer konnte den Dienst also durch einen
   * normalen Leseaufruf auf eine fremde Kanzlei stilllegen (empirisch
   * reproduziert: Prozess beendet, Socket geschlossen).
   *
   * Davor stand zusaetzlich `m.id === kanzleiId` — ein Vergleich einer
   * Mandant-UUID mit einer Kanzlei-UUID — und `m.rolle === 'KANZLEI_ADMIN'`
   * haette jedem Admin Zugriff auf JEDE Kanzlei gegeben. Beides ist durch
   * einen einzigen, ehrlich awaiteten DB-Lookup ersetzt.
   */
  private async assertKanzleiAccess(
    kanzleiId: string,
    user: AuthUser,
  ): Promise<void> {
    if (user.globalRole === 'SYSTEM_ADMIN') return;
    const mandant = await this.prisma.mandant.findFirst({
      where: { kanzleiId, id: { in: user.mandanten.map((m) => m.id) } },
      select: { id: true },
    });
    if (!mandant) {
      throw new ForbiddenException('Kein Zugriff auf diese Kanzlei');
    }
  }

  /**
   * Schreibzugriff: KANZLEI_ADMIN oder SYSTEM_ADMIN, und ausschliesslich
   * fuer die eigene Kanzlei. Dieselbe Behebung (await statt void-Promise).
   */
  private async assertKanzleiAdminAccess(
    kanzleiId: string,
    user: AuthUser,
  ): Promise<void> {
    if (user.globalRole === 'SYSTEM_ADMIN') return;
    const isAdmin = user.mandanten.some((m) => m.rolle === 'KANZLEI_ADMIN');
    if (!isAdmin) {
      throw new ForbiddenException(
        'Nur KANZLEI_ADMIN oder SYSTEM_ADMIN darf Subscription ändern',
      );
    }
    await this.assertKanzleiAccess(kanzleiId, user);
  }
}

/**
 * Re-export für Tests + externe Importe.
 */
export { ACTIVE_STATUSES };
