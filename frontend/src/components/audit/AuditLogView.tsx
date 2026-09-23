'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiFetch, getAccessToken, getActiveMandantId } from '@/lib/api';

type AuditEntry = {
  id: string;
  createdAt: string;
  userId: string | null;
  mandantId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
};

type AuditFilter = {
  action?: string;
  entityType?: string;
  from?: string;
  to?: string;
};

const ACTION_KEYS = [
  'GENERATE_PDF',
  'READ_PDF',
  'CREATE',
  'UPDATE',
  'DELETE',
  'LOGIN',
  'LOGOUT',
  'SIGN',
];

const ENTITY_KEYS = [
  'Mandant',
  'Bilanz',
  'GuV',
  'Anhang',
  'Jahresabschluss',
  'User',
  'WormObject',
];

export function AuditLogView() {
  const t = useTranslations();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<AuditFilter>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter.action, filter.entityType, filter.from, filter.to]);

  async function loadEntries() {
    setLoading(true);
    setError(null);
    try {
      const token = getAccessToken();
      const mandantId = getActiveMandantId();
      if (!token) return;
      const params = new URLSearchParams();
      if (mandantId) params.set('mandantId', mandantId);
      if (filter.action) params.set('action', filter.action);
      if (filter.entityType) params.set('entityType', filter.entityType);
      if (filter.from) params.set('from', filter.from);
      if (filter.to) params.set('to', filter.to);
      const result = await apiFetch<{ items: AuditEntry[]; total: number }>(
        `/audit?${params.toString()}`,
        { accessToken: token },
      );
      setEntries(result.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.network.message'));
    } finally {
      setLoading(false);
    }
  }

  function resetFilter() {
    setFilter({});
  }

  return (
    <div>
      {/* Filter */}
      <div className="bg-white rounded-lg border border-slate-200 p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              {t('audit.filters.action')}
            </label>
            <select
              value={filter.action ?? ''}
              onChange={(e) =>
                setFilter((f) => ({
                  ...f,
                  action: e.target.value || undefined,
                }))
              }
              className="block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="">— Alle —</option>
              {ACTION_KEYS.map((a) => (
                <option key={a} value={a}>
                  {t(`audit.actions.${a}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              {t('audit.filters.entityType')}
            </label>
            <select
              value={filter.entityType ?? ''}
              onChange={(e) =>
                setFilter((f) => ({
                  ...f,
                  entityType: e.target.value || undefined,
                }))
              }
              className="block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="">— Alle —</option>
              {ENTITY_KEYS.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              {t('audit.filters.from')}
            </label>
            <input
              type="date"
              value={filter.from ?? ''}
              onChange={(e) =>
                setFilter((f) => ({
                  ...f,
                  from: e.target.value || undefined,
                }))
              }
              className="block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              {t('audit.filters.to')}
            </label>
            <input
              type="date"
              value={filter.to ?? ''}
              onChange={(e) =>
                setFilter((f) => ({
                  ...f,
                  to: e.target.value || undefined,
                }))
              }
              className="block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
        </div>
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={resetFilter}
            className="text-sm text-slate-600 hover:text-slate-900"
          >
            {t('audit.filters.reset')}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-slate-500">{t('common.loading')}</div>
      ) : entries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-500">
          {t('audit.noEntries')}
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-slate-700">
                  {t('audit.columns.timestamp')}
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-slate-700">
                  {t('audit.columns.user')}
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-slate-700">
                  {t('audit.columns.action')}
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-slate-700">
                  {t('audit.columns.entity')}
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-slate-700">
                  {t('audit.columns.mandant')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {entries.map((e) => (
                <tr key={e.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 num-de text-slate-600">
                    {new Date(e.createdAt).toLocaleString('de-DE')}
                  </td>
                  <td className="px-4 py-2 text-slate-900">
                    {e.userId ? `${e.userId.slice(0, 8)}…` : '—'}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={
                        'inline-flex px-2 py-0.5 rounded text-xs font-medium ' +
                        (e.action === 'GENERATE_PDF' || e.action === 'SIGN'
                          ? 'bg-blue-100 text-blue-800'
                          : e.action === 'DELETE'
                            ? 'bg-red-100 text-red-800'
                            : e.action === 'LOGIN' || e.action === 'LOGOUT'
                              ? 'bg-slate-100 text-slate-700'
                              : 'bg-green-100 text-green-800')
                      }
                    >
                      {ACTION_KEYS.includes(e.action)
                        ? t(`audit.actions.${e.action}`)
                        : e.action}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-slate-700">
                    <div className="text-xs">{e.entityType}</div>
                    {e.entityId && (
                      <div className="text-[10px] text-slate-400 font-mono">
                        {e.entityId.slice(0, 8)}…
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-500">
                    {e.mandantId ? `${e.mandantId.slice(0, 8)}…` : '—'}
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