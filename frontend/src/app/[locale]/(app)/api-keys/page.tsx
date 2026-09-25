import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ApiKeysView } from '@/components/api-keys/ApiKeysView';

/**
 * API-Keys-Management-Seite (M4 Sprint 1).
 *
 * Nur sichtbar für KANZLEI_ADMIN und SYSTEM_ADMIN. RBAC-Check erfolgt
 * client-seitig in der AppShell / per Server-Render.
 */
export default async function ApiKeysPage({
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
          {t('apiKeys.title')}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {t('apiKeys.subtitle')}
        </p>
      </div>

      <ApiKeysView />
    </div>
  );
}