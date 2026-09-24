import { setRequestLocale, getTranslations } from 'next-intl/server';
import { WPView } from '@/components/wp/WPView';

export default async function WPPage({
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
          {t('wp.title')}
        </h1>
        <p className="mt-1 text-sm text-slate-600">{t('wp.subtitle')}</p>
      </div>

      <WPView />
    </div>
  );
}