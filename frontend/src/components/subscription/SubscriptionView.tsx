'use client';

import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { apiFetch, getAccessToken } from '@/lib/api';

type SubscriptionTier = 'PILOT' | 'STANDARD' | 'PREMIUM';
type SubscriptionStatus =
  | 'TRIALING'
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'CANCELED'
  | 'INCOMPLETE'
  | 'INCOMPLETE_EXPIRED'
  | 'UNPAID'
  | 'PAUSED';

interface SubscriptionResponse {
  kanzleiId: string;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  providerName: 'stripe' | 'mock';
  providerSubscriptionId: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  maxMandanten: number;
  features: readonly string[];
  updatedAt: string;
}

interface TierConfig {
  tier: SubscriptionTier;
  displayName: string;
  description: string;
  pricePerMonthEur: number;
  maxMandanten: number;
  features: ReadonlySet<string>;
}

interface TierListResponse {
  tiers: TierConfig[];
}

/**
 * Subscription-View (M4 Sprint 3).
 *
 * 3 Bereiche:
 *   1. Aktueller Status (Tier, Features, Max-Mandanten)
 *   2. Pricing-Tabelle (3 Tiers zum Vergleich)
 *   3. Upgrade-Button (Stripe-Checkout oder Mock-Aktivierung)
 *
 * Wenn Provider = 'mock' (Dev/Pilot ohne Stripe-Key): Direkt-Aktivierung
 * via POST /api/subscription/:kanzleiId/mock-activate.
 *
 * Wenn Provider = 'stripe': Stripe-Checkout-URL → Redirect.
 */
export function SubscriptionView() {
  const t = useTranslations();
  const [kanzleiId, setKanzleiId] = useState<string | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionResponse | null>(null);
  const [tiers, setTiers] = useState<TierConfig[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // ===========================================================================
  // Lade Daten
  // ===========================================================================
  useEffect(() => {
    async function load() {
      try {
        // Kanzlei-ID via /api/auth/me
        const meRes = await apiFetch('/api/auth/me');
        if (meRes.ok) {
          const me = (await meRes.json()) as { mandanten: { kanzleiId: string }[] };
          const firstKanzlei = me.mandanten[0]?.kanzleiId;
          if (firstKanzlei) setKanzleiId(firstKanzlei);
        }
        // Tiers
        const tiersRes = await apiFetch('/api/subscription/tiers');
        if (tiersRes.ok) {
          const data = (await tiersRes.json()) as TierListResponse;
          // Backend liefert Sets als Plain-Objects → in echte Sets konvertieren
          const normalized = data.tiers.map((t) => ({
            ...t,
            features: new Set(t.features as unknown as string[]),
          }));
          setTiers(normalized);
        }
        // Subscription (falls kanzleiId schon da)
        if (firstKanzlei) {
          const subRes = await apiFetch(`/api/subscription/${firstKanzlei}`);
          if (subRes.ok) {
            setSubscription((await subRes.json()) as SubscriptionResponse);
          }
        }
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  // Reload subscription (nach Upgrade/Cancel)
  const reloadSubscription = useCallback(async () => {
    if (!kanzleiId) return;
    const subRes = await apiFetch(`/api/subscription/${kanzleiId}`);
    if (subRes.ok) {
      setSubscription((await subRes.json()) as SubscriptionResponse);
    }
  }, [kanzleiId]);

  // ===========================================================================
  // Aktionen
  // ===========================================================================
  const handleUpgrade = useCallback(
    async (tier: SubscriptionTier) => {
      if (!kanzleiId) return;
      setError(null);
      setInfo(null);
      setActionLoading(true);
      try {
        const token = getAccessToken();
        const successUrl = `${window.location.origin}/einstellungen/subscription?upgrade=success`;
        const cancelUrl = `${window.location.origin}/einstellungen/subscription?upgrade=cancel`;

        const res = await apiFetch(`/api/subscription/${kanzleiId}/checkout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ tier, successUrl, cancelUrl }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.message ?? `Fehler ${res.status}`);
        }
        const data = (await res.json()) as { url: string; providerName: 'stripe' | 'mock' };

        if (data.providerName === 'mock') {
          // Mock-Mode: Direkt-Aktivierung statt Redirect
          const mockSession = new URL(data.url).searchParams.get('mock_session') ?? '';
          const activateRes = await apiFetch(
            `/api/subscription/${kanzleiId}/mock-activate`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
              },
              body: JSON.stringify({ tier, mockSession }),
            },
          );
          if (!activateRes.ok) {
            const body = await activateRes.json().catch(() => ({}));
            throw new Error(body.message ?? `Fehler ${activateRes.status}`);
          }
          setInfo(t('subscription.mockActivated'));
          await reloadSubscription();
        } else {
          // Stripe-Mode: Redirect zu Checkout
          window.location.href = data.url;
        }
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setActionLoading(false);
      }
    },
    [kanzleiId, reloadSubscription, t],
  );

  const handleCancel = useCallback(async () => {
    if (!kanzleiId) return;
    if (!window.confirm(t('subscription.confirmCancel'))) return;
    setError(null);
    setActionLoading(true);
    try {
      const token = getAccessToken();
      const res = await apiFetch(`/api/subscription/${kanzleiId}/cancel`, {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `Fehler ${res.status}`);
      }
      setInfo(t('subscription.canceled'));
      await reloadSubscription();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionLoading(false);
    }
  }, [kanzleiId, reloadSubscription, t]);

  // ===========================================================================
  // Render
  // ===========================================================================
  if (loading) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <p className="text-sm text-slate-600">{t('subscription.loading')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Status */}
      {subscription && (
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">
            {t('subscription.currentTitle')}
          </h2>
          <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-slate-500">{t('subscription.tier')}</dt>
              <dd className="mt-1 text-base font-medium text-slate-900">
                {subscription.tier}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">{t('subscription.status')}</dt>
              <dd className="mt-1 text-base font-medium text-slate-900">
                {subscription.status}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">{t('subscription.maxMandanten')}</dt>
              <dd className="mt-1 text-base font-medium text-slate-900">
                {subscription.maxMandanten === -1
                  ? t('subscription.unlimited')
                  : subscription.maxMandanten}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">{t('subscription.provider')}</dt>
              <dd className="mt-1 text-base font-medium text-slate-900">
                {subscription.providerName}
              </dd>
            </div>
          </dl>

          {subscription.status === 'ACTIVE' && !subscription.cancelAtPeriodEnd && (
            <button
              type="button"
              onClick={handleCancel}
              disabled={actionLoading}
              className="mt-6 rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('subscription.cancelButton')}
            </button>
          )}
        </div>
      )}

      {/* Pricing */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
        {tiers?.map((tier) => {
          const isCurrent = subscription?.tier === tier.tier;
          return (
            <div
              key={tier.tier}
              className={`rounded-lg border p-6 shadow-sm ${
                isCurrent
                  ? 'border-blue-300 bg-blue-50 ring-2 ring-blue-500'
                  : 'border-slate-200 bg-white'
              }`}
            >
              <h3 className="text-base font-semibold text-slate-900">
                {tier.displayName}
              </h3>
              <p className="mt-1 text-2xl font-bold text-slate-900">
                {tier.pricePerMonthEur === 0
                  ? t('subscription.freeLabel')
                  : `${tier.pricePerMonthEur} €`}
                {tier.pricePerMonthEur > 0 && (
                  <span className="text-sm font-normal text-slate-500">
                    {' '}
                    / {t('subscription.month')}
                  </span>
                )}
              </p>
              <p className="mt-2 text-sm text-slate-600">{tier.description}</p>
              <ul className="mt-4 space-y-2 text-sm text-slate-700">
                {Array.from(tier.features).map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <svg
                      className="mt-0.5 h-4 w-4 flex-none text-green-600"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              {!isCurrent && (
                <button
                  type="button"
                  onClick={() => handleUpgrade(tier.tier)}
                  disabled={actionLoading}
                  className="mt-6 w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t('subscription.upgradeButton', { tier: tier.displayName })}
                </button>
              )}
              {isCurrent && (
                <p className="mt-6 text-center text-xs font-medium text-blue-700">
                  {t('subscription.currentBadge')}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Messages */}
      {info && (
        <div className="rounded-md border border-green-200 bg-green-50 p-3">
          <p className="text-sm text-green-800">{info}</p>
        </div>
      )}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}
    </div>
  );
}