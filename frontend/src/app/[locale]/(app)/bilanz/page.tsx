import { setRequestLocale } from 'next-intl/server';
import { getTranslations } from 'next-intl/server';
import { BilanzListView } from '@/components/bilanz/BilanzListView';

export default async function BilanzPage({
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
          {t('bilanz.title')}
        </h1>
        <p className="mt-1 text-sm text-slate-600">{t('bilanz.subtitle')}</p>
      </div>

      <BilanzListView />
    </div>
  );
}