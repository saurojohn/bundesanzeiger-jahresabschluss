import { setRequestLocale, getTranslations } from 'next-intl/server';
import { WebhooksView } from '@/components/webhooks/WebhooksView';

/**
 * Webhooks-Management-Seite (M4 Sprint 1).
 *
 * Erlaubt das Erstellen / Listen / Testen / Löschen von
 * Webhook-Subscriptions pro Kanzlei.
 */
export default async function WebhooksPage({
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
          {t('webhooks.title')}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {t('webhooks.subtitle')}
        </p>
      </div>

      <WebhooksView />
    </div>
  );
}