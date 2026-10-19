import { setRequestLocale, getTranslations } from 'next-intl/server';
import { MfaSettings } from '@/components/auth/MfaSettings';

/**
 * Sicherheitseinstellungen (MFA).
 *
 * BEFUND 2026-10-19 (Nachtrag 48, TODO-8.20): Die TOTP-Routen des Backends
 * waren vorhanden, korrekt abgesichert — und von der Oberflaeche aus
 * **nicht erreichbar**. `grep -rn "totp" frontend/src` fand nur die
 * Verwendung im Login.
 *
 * Diese Seite schliesst die Luecke. Sie gehoert neben die Subscription
 * (Einstellungen → Sicherheit), weil beide die Frage beantworten "wie
 * sieht mein Zugang aus".
 */
export default async function SicherheitPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">
          {t('auth.mfa.pageTitle')}
        </h1>
        <p className="mt-1 text-sm text-slate-600">{t('auth.mfa.pageDescription')}</p>
      </div>
      <MfaSettings />
    </div>
  );
}
