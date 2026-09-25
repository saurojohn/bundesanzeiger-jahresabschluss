import { setRequestLocale, getTranslations } from 'next-intl/server';
import { BrandingEditor } from '@/components/branding/BrandingEditor';

/**
 * Branding-Konfigurationsseite (M3 Sprint 4+5).
 *
 * Nur sichtbar für KANZLEI_ADMIN und SYSTEM_ADMIN. Der RBAC-Check
 * passiert client-seitig in der AppShell — serverseitig gibt es hier
 * keine Auth (das Layout ist statisch, das Component fetcht selbst).
 */
export default async function BrandingPage({
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
          {t('branding.title')}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {t('branding.subtitle')}
        </p>
      </div>

      <BrandingEditor />
    </div>
  );
}