import { setRequestLocale, getTranslations } from 'next-intl/server';
import { KonsolidierungView } from '@/components/konsolidierung/KonsolidierungView';

export default async function KonsolidierungPage({
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
          {t('konsolidierung.title')}
        </h1>
        <p className="mt-1 text-sm text-slate-600">{t('konsolidierung.subtitle')}</p>
      </div>

      <KonsolidierungView />
    </div>
  );
}