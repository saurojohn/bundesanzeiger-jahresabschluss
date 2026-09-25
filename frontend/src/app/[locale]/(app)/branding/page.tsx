import { setRequestLocale, getTranslations } from 'next-intl/server';
import { BrandingEditor } from '@/components/branding/BrandingEditor';
import { CustomDomainWizard } from '@/components/dns/CustomDomainWizard';

/**
 * Branding-Konfigurationsseite (M3 Sprint 4+5 + M4 Sprint 3).
 *
 * Zeigt:
 *   - Branding-Editor: Logo, Farben (M3)
 *   - Custom-Domain-Wizard: DNS-Verifikation + Let's Encrypt Cert (M4 Sprint 3)
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
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">
          {t('branding.title')}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {t('branding.subtitle')}
        </p>
      </div>

      <BrandingEditor />

      <div className="border-t border-slate-200 pt-8">
        <h2 className="text-xl font-semibold text-slate-900">
          {t('customDomain.sectionTitle')}
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          {t('customDomain.sectionSubtitle')}
        </p>
        <div className="mt-6">
          <CustomDomainWizard />
        </div>
      </div>
    </div>
  );
}