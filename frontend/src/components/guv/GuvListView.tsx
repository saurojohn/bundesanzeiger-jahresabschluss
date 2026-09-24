'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiFetch, getAccessToken, getActiveMandantId } from '@/lib/api';
import { PdfActions } from '@/components/pdf/PdfActions';
import { Pagination, usePaginationLabels } from '@/components/common/Pagination';

type GuvPosition = {
  id?: string;
  kontonummer: string;
  bezeichnung: string;
  kategorie: 'ERLOES' | 'MATERIAL' | 'PERSONAL' | 'ABSCHREIBUNG' | 'SONSTIGE' | 'STEUER' | 'FINANZ';
  betragVorjahr: number | null;
  betragAktuell: number;
  reihenfolge: number;
  bemerkung?: string | null;
};

type Guv = {
  id: string;
  mandantId: string;
  bilanzId: string | null;
  geschaeftsjahr: number;
  verfahren: 'GKV' | 'UKV';
  status: 'DRAFT' | 'VALIDATED' | 'ARCHIVED';
  hinweise: string | null;
  ergebnis: number;
  positionen: GuvPosition[];
  wormObjectKey: string | null;
};

type GuvListResponse =
  | Guv[]
  | {
      items: Guv[];
      nextCursor: string | null;
      total: number;
      hasMore: boolean;
    };

const PAGE_SIZE = 20;

export function GuvListView() {
  const t = useTranslations();
  const paginationLabels = usePaginationLabels('guv');
  const [guvs, setGuvs] = useState<Guv[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState<number>(0);
  const [hasMore, setHasMore] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadList();
  }, []);

  async function loadList() {
    setLoading(true);
    setError(null);
    try {
      const mandantId = getActiveMandantId();
      const token = getAccessToken();
      if (!mandantId || !token) return;
      const data = await apiFetch<GuvListResponse>(
        `/guv?mandantId=${mandantId}&pageSize=${PAGE_SIZE}`,
        { accessToken: token },
      );
      applyResponse(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.network.message'));
    } finally {
      setLoading(false);
    }
  }

  async function loadMore(cursor: string) {
    if (loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const mandantId = getActiveMandantId();
      const token = getAccessToken();
      if (!mandantId || !token) return;
      const data = await apiFetch<GuvListResponse>(
        `/guv?mandantId=${mandantId}&pageSize=${PAGE_SIZE}&cursor=${encodeURIComponent(cursor)}`,
        { accessToken: token },
      );
      appendResponse(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.network.message'));
    } finally {
      setLoadingMore(false);
    }
  }

  function applyResponse(data: GuvListResponse) {
    if (Array.isArray(data)) {
      setGuvs(data);
      setTotal(data.length);
      setHasMore(false);
      setNextCursor(null);
      return;
    }
    setGuvs(data.items);
    setTotal(data.total);
    setHasMore(data.hasMore);
    setNextCursor(data.nextCursor);
  }

  function appendResponse(data: GuvListResponse) {
    if (Array.isArray(data)) {
      setGuvs((prev) => [...prev, ...data]);
      setHasMore(false);
      setNextCursor(null);
      return;
    }
    setGuvs((prev) => [...prev, ...data.items]);
    setTotal(data.total);
    setHasMore(data.hasMore);
    setNextCursor(data.nextCursor);
  }

  if (creatingNew || editingId) {
    return (
      <GuvForm
        guvId={editingId ?? undefined}
        onCancel={() => {
          setEditingId(null);
          setCreatingNew(false);
        }}
        onSaved={() => {
          setEditingId(null);
          setCreatingNew(false);
          void loadList();
        }}
      />
    );
  }

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <button
          type="button"
          onClick={() => setCreatingNew(true)}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          {t('guv.newGuv')}
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-slate-500">{t('common.loading')}</div>
      ) : guvs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-500">
          {t('guv.noGuv')}
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-slate-700">
                  {t('guv.geschaeftsjahr')}
                </th>
                <th className="px-4 py-3 text-left font-medium text-slate-700">
                  {t('guv.verfahren')}
                </th>
                <th className="px-4 py-3 text-right font-medium text-slate-700 num-de">
                  {t('guv.validation.jahresueberschuss')}
                </th>
                <th className="px-4 py-3 text-left font-medium text-slate-700">
                  Status
                </th>
                <th className="px-4 py-3 text-center font-medium text-slate-700">
                  PDF
                </th>
                <th className="px-4 py-3 text-right font-medium text-slate-700">
                  {t('common.actions')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {guvs.map((g) => (
                <tr key={g.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 num-de">{g.geschaeftsjahr}</td>
                  <td className="px-4 py-3">{t(`guv.${g.verfahren}`)}</td>
                  <td className="px-4 py-3 text-right num-de">
                    {g.ergebnis.toLocaleString('de-DE', {
                      style: 'currency',
                      currency: 'EUR',
                    })}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        'inline-flex px-2 py-0.5 rounded text-xs font-medium ' +
                        (g.status === 'DRAFT'
                          ? 'bg-amber-100 text-amber-800'
                          : g.status === 'VALIDATED'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-slate-100 text-slate-700')
                      }
                    >
                      {t(`bilanz.status.${g.status}`)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <PdfActions
                      entityType="guv"
                      entityId={g.id}
                      wormObjectKey={g.wormObjectKey}
                      onGenerated={() => void loadList()}
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => setEditingId(g.id)}
                      className="text-sm text-brand-600 hover:text-brand-700"
                    >
                      {t('common.edit')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination (M3+ Performance) */}
      {!loading && guvs.length > 0 && (
        <Pagination
          hasMore={hasMore}
          nextCursor={nextCursor}
          total={total}
          loadedCount={guvs.length}
          onLoadMore={(cursor) => void loadMore(cursor)}
          loading={loadingMore}
          labels={paginationLabels}
        />
      )}
    </div>
  );
}

function GuvForm({
  guvId,
  onCancel,
  onSaved,
}: {
  guvId?: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations();
  const [schema, setSchema] = useState<{
    verfahren: 'GKV' | 'UKV';
    positionen: Array<{ kontonummer: string; bezeichnung: string; kategorie: GuvPosition['kategorie'] }>;
  } | null>(null);
  const [geschaeftsjahr, setGeschaeftsjahr] = useState<number>(
    new Date().getFullYear(),
  );
  const [verfahren, setVerfahren] = useState<'GKV' | 'UKV'>('GKV');
  const [positionen, setPositionen] = useState<GuvPosition[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void init();
  }, [guvId]);

  async function init() {
    try {
      const token = getAccessToken();
      if (!token) return;
      if (guvId) {
        const data = await apiFetch<Guv>(`/guv/${guvId}`, {
          accessToken: token,
        });
        setGeschaeftsjahr(data.geschaeftsjahr);
        setVerfahren(data.verfahren);
        setPositionen(data.positionen);
        const schemaData = await apiFetch<typeof schema>(
          `/guv/schema?verfahren=${data.verfahren}`,
          { accessToken: token },
        );
        setSchema(schemaData);
      } else {
        const schemaData = await apiFetch<typeof schema>(
          `/guv/schema?verfahren=GKV`,
          { accessToken: token },
        );
        setSchema(schemaData);
        setPositionen(
          schemaData.positionen.map((p, idx) => ({
            kontonummer: p.kontonummer,
            bezeichnung: p.bezeichnung,
            kategorie: p.kategorie,
            betragVorjahr: null,
            betragAktuell: 0,
            reihenfolge: idx + 1,
          })),
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.network.message'));
    }
  }

  const ergebnis = useMemo(() => {
    const erloese = positionen
      .filter((p) => p.kategorie === 'ERLOES' || (p.kategorie === 'FINANZ' && p.betragAktuell > 0))
      .reduce((s, p) => s + (p.betragAktuell || 0), 0);
    const aufwendungen = positionen
      .filter(
        (p) =>
          p.kategorie === 'MATERIAL' ||
          p.kategorie === 'PERSONAL' ||
          p.kategorie === 'ABSCHREIBUNG' ||
          (p.kategorie === 'SONSTIGE' && p.betragAktuell < 0) ||
          (p.kategorie === 'STEUER') ||
          (p.kategorie === 'FINANZ' && p.betragAktuell < 0),
      )
      .reduce((s, p) => s + Math.abs(p.betragAktuell || 0), 0);
    return erloese - aufwendungen;
  }, [positionen]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const token = getAccessToken();
      const mandantId = getActiveMandantId();
      if (!token || !mandantId) return;
      const payload = {
        mandantId,
        geschaeftsjahr,
        verfahren,
        positionen: positionen.map((p, idx) => ({
          kontonummer: p.kontonummer,
          bezeichnung: p.bezeichnung,
          kategorie: p.kategorie,
          betragVorjahr: p.betragVorjahr,
          betragAktuell: p.betragAktuell,
          reihenfolge: idx + 1,
          bemerkung: p.bemerkung,
        })),
      };
      if (guvId) {
        await apiFetch(`/guv/${guvId}`, {
          method: 'PATCH',
          accessToken: token,
          body: JSON.stringify(payload),
        });
      } else {
        await apiFetch('/guv', {
          method: 'POST',
          accessToken: token,
          body: JSON.stringify(payload),
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.network.message'));
    } finally {
      setSaving(false);
    }
  }

  function updatePosition(idx: number, patch: Partial<GuvPosition>) {
    setPositionen((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  }

  if (!schema) {
    return <div className="text-sm text-slate-500">{t('common.loading')}</div>;
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">
          {guvId ? t('guv.editGuv') : t('guv.newGuv')}
        </h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {t('guv.actions.save')}
          </button>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            {t('guv.geschaeftsjahr')}
          </label>
          <input
            type="number"
            value={geschaeftsjahr}
            onChange={(e) => setGeschaeftsjahr(Number(e.target.value))}
            disabled={!!guvId}
            className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm num-de focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            {t('guv.verfahren')}
          </label>
          <select
            value={verfahren}
            onChange={(e) => setVerfahren(e.target.value as 'GKV' | 'UKV')}
            disabled={!!guvId}
            className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            <option value="GKV">{t('guv.GKV')}</option>
            <option value="UKV">{t('guv.UKV')}</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div
        className={
          'mb-4 rounded-md p-3 text-sm flex items-center justify-between border ' +
          (ergebnis >= 0
            ? 'bg-green-50 border-green-200 text-green-800'
            : 'bg-red-50 border-red-200 text-red-800')
        }
      >
        <span className="font-medium">
          {ergebnis >= 0
            ? t('guv.validation.jahresueberschuss')
            : t('guv.validation.jahresfehlbetrag')}
          :
        </span>
        <span className="font-semibold num-de">
          {Math.abs(ergebnis).toLocaleString('de-DE', {
            style: 'currency',
            currency: 'EUR',
          })}
        </span>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium text-slate-600 w-24">
                Konto
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium text-slate-600">
                {t('guv.fields.bezeichnung')}
              </th>
              <th className="px-3 py-2 text-right text-xs font-medium text-slate-600 w-32">
                {t('guv.fields.betragVorjahr')}
              </th>
              <th className="px-3 py-2 text-right text-xs font-medium text-slate-600 w-32">
                {t('guv.fields.betragAktuell')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {positionen.map((p, idx) => (
              <tr key={idx}>
                <td className="px-3 py-1.5 num-de text-slate-600">
                  {p.kontonummer}
                </td>
                <td className="px-3 py-1.5 text-slate-900">{p.bezeichnung}</td>
                <td className="px-3 py-1.5">
                  <input
                    type="number"
                    step="0.01"
                    value={p.betragVorjahr ?? ''}
                    onChange={(e) =>
                      updatePosition(idx, {
                        betragVorjahr: e.target.value
                          ? Number(e.target.value)
                          : null,
                      })
                    }
                    className="block w-full text-right rounded border border-slate-200 px-2 py-1 text-sm num-de"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <input
                    type="number"
                    step="0.01"
                    value={p.betragAktuell || ''}
                    onChange={(e) =>
                      updatePosition(idx, {
                        betragAktuell: Number(e.target.value) || 0,
                      })
                    }
                    className="block w-full text-right rounded border border-slate-200 px-2 py-1 text-sm num-de"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}