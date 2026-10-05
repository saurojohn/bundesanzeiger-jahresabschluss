'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiFetch, getAccessToken, getActiveMandantId } from '@/lib/api';

type JahresabschlussSummary = {
  id: string;
  geschaeftsjahr: number;
  status: 'DRAFT' | 'FINALIZED' | 'SIGNED' | 'SUBMITTED' | 'PUBLISHED';
  bilanzsumme: number;
  guvErgebnis: number;
  abgeschlossenAm: string | null;
  signiertAm: string | null;
  wormObjectKey: string | null;
};

export function JahresabschlussView() {
  const t = useTranslations();
  const [list, setList] = useState<JahresabschlussSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadList();
  }, []);

  async function loadList() {
    setLoading(true);
    try {
      const token = getAccessToken();
      const mandantId = getActiveMandantId();
      if (!token || !mandantId) return;
      // Bugfix 2026-10-05: Das `.catch(() => [])` hier hat JEDEN
      // Serverfehler in eine leere Liste verwandelt. Ein Ausfall, ein 500
      // oder ein fehlgeschlagener Aufruf sah für den Anwender exakt aus wie
      // „noch kein Jahresabschluss vorhanden" — und das äußere `catch`
      // darunter war toter Code.
      //
      // Der Endpoint existiert weiterhin nicht (404). Der Unterschied:
      // ein 404 ist der erwartete Fall und wird als Leerzustand gezeigt,
      // jeder ANDERE Fehler ist ein Fehler und wird als solcher gemeldet.
      // Der Benutzer muss unterscheiden können zwischen „gibt es noch
      // keinen" und „das System ist gerade ausgefallen".
      const result = await apiFetch<JahresabschlussSummary[]>(
        `/jahresabschluss?mandantId=${mandantId}`,
        { accessToken: token },
      ).catch((err: unknown) => {
        const status = (err as { status?: number }).status;
        if (status === 404) return []; // erwartet: Endpunkt existiert noch nicht
        throw err;
      });
      setList(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.network.message'));
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return <div className="text-sm text-slate-500">{t('common.loading')}</div>;
  }

  return (
    <div>
      {error && (
        <div className="mb-4 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {list.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center">
          <p className="text-sm text-slate-500">
            {t('jahresabschluss.noAbschluss')}
          </p>
          <p className="mt-2 text-xs text-slate-400">
            Erstellen Sie zunächst Bilanz + GuV + Anhang für ein Geschäftsjahr,
            dann wird hier der kombinierte Jahresabschluss angezeigt.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-slate-700">
                  {t('jahresabschluss.fields.geschaeftsjahr')}
                </th>
                <th className="px-4 py-3 text-left font-medium text-slate-700">
                  {t('jahresabschluss.fields.status')}
                </th>
                <th className="px-4 py-3 text-right font-medium text-slate-700 num-de">
                  {t('jahresabschluss.fields.bilanzSumme')}
                </th>
                <th className="px-4 py-3 text-right font-medium text-slate-700 num-de">
                  {t('jahresabschluss.fields.guvErgebnis')}
                </th>
                <th className="px-4 py-3 text-right font-medium text-slate-700">
                  {t('jahresabschluss.fields.actions')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.map((j) => (
                <tr key={j.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 num-de">{j.geschaeftsjahr}</td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        'inline-flex px-2 py-0.5 rounded text-xs font-medium ' +
                        (j.status === 'DRAFT'
                          ? 'bg-amber-100 text-amber-800'
                          : j.status === 'SIGNED'
                            ? 'bg-emerald-100 text-emerald-800'
                            : j.status === 'PUBLISHED'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-slate-100 text-slate-700')
                      }
                    >
                      {t(`jahresabschluss.status.${j.status}`)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right num-de">
                    {j.bilanzsumme.toLocaleString('de-DE', {
                      style: 'currency',
                      currency: 'EUR',
                    })}
                  </td>
                  <td className="px-4 py-3 text-right num-de">
                    {j.guvErgebnis.toLocaleString('de-DE', {
                      style: 'currency',
                      currency: 'EUR',
                    })}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      className="text-sm text-brand-600 hover:text-brand-700"
                    >
                      {t('jahresabschluss.actions.signAbschluss')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}