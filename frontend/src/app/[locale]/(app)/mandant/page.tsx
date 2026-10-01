import { setRequestLocale, getTranslations } from 'next-intl/server';
import { MandantForm } from '@/components/mandant/MandantForm';

/**
 * Mandanten-Verwaltung (M4).
 *
 * Anlegen, Liste und Löschen von Mandanten (GmbHs) je Kanzlei.
 * Die Stammdaten — insbesondere die Steuernummer des Finanzamts — sind für
 * die E-Bilanz Pflicht und lassen sich hier pflegen.
 */
export default async function MandantPage({
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
        <h1 className="text-2xl font-semibold text-slate-900">{t('mandant.title')}</h1>
        <p className="mt-1 text-sm text-slate-600">{t('mandant.subtitle')}</p>
      </div>

      <MandantForm />
    </div>
  );
}
