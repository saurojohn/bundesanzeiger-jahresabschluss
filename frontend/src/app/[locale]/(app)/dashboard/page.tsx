import { useTranslations } from 'next-intl';

export default function DashboardPage() {
  const t = useTranslations();

  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900 mb-6">
        {t('dashboard.title')}
      </h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { key: 'aktiveMandanten', value: '—' },
          { key: 'offeneAbschluesse', value: '—' },
          { key: 'eingereichtDiesesJahr', value: '—' },
          { key: 'faelligeFristen', value: '—' },
        ].map((stat) => (
          <div
            key={stat.key}
            className="bg-white rounded-lg border border-slate-200 p-4"
          >
            <div className="text-xs uppercase tracking-wide text-slate-500">
              {t(`dashboard.stats.${stat.key}`)}
            </div>
            <div className="mt-2 text-3xl font-semibold text-slate-900 num-de">
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      <section className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg border border-slate-200 p-6">
          <h2 className="text-lg font-medium text-slate-900 mb-4">
            {t('dashboard.recentActivity')}
          </h2>
          <p className="text-sm text-slate-500">
            Sprint 2: Aktivitäten werden aus dem Audit-Log geladen.
          </p>
        </div>

        <div className="bg-white rounded-lg border border-slate-200 p-6">
          <h2 className="text-lg font-medium text-slate-900 mb-4">
            {t('dashboard.upcomingDeadlines')}
          </h2>
          <p className="text-sm text-slate-500">
            Sprint 2: BAnz-Fristen werden automatisch berechnet.
          </p>
        </div>
      </section>
    </div>
  );
}