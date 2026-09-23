import { setRequestLocale, getTranslations } from 'next-intl/server';
import { AnhangListView } from '@/components/anhang/AnhangListView';

export default async function AnhangPage({
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
          {t('anhang.title')}
        </h1>
        <p className="mt-1 text-sm text-slate-600">{t('anhang.subtitle')}</p>
      </div>

      <AnhangListView />
    </div>
  );
}