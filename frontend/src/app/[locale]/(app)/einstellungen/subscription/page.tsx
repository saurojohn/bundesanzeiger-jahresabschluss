import { setRequestLocale, getTranslations } from 'next-intl/server';
import { SubscriptionView } from '@/components/subscription/SubscriptionView';

/**
 * Subscription-/Pricing-Seite (M4 Sprint 3).
 *
 * Zeigt aktuellen Subscription-Status + Tier-Vergleich + Upgrade-Button.
 * RBAC: KANZLEI_ADMIN oder SYSTEM_ADMIN kann upgraden, andere User sehen
 * nur den Status.
 */
export default async function SubscriptionPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">
          {t('subscription.title')}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {t('subscription.subtitle')}
        </p>
      </div>

      <SubscriptionView />
    </div>
  );
}