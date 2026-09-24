'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiFetch, getAccessToken, getActiveMandantId } from '@/lib/api';
import { PdfActions } from '@/components/pdf/PdfActions';
import { Pagination, usePaginationLabels } from '@/components/common/Pagination';

type AnhangAbschnitt = {
  id?: string;
  titel: string;
  inhalt: string;
  reihenfolge: number;
};

type Anhang = {
  id: string;
  mandantId: string;
  geschaeftsjahr: number;
  status: 'DRAFT' | 'VALIDATED' | 'ARCHIVED';
  bilanzierungsMethoden: string | null;
  bewertungsMethoden: string | null;
  sonstigePflichtangaben: string | null;
  abschnitte: AnhangAbschnitt[];
  wormObjectKey: string | null;
};

type AnhangListResponse =
  | Anhang[]
  | {
      items: Anhang[];
      nextCursor: string | null;
      total: number;
      hasMore: boolean;
    };

const STANDARD_TITEL = [
  'allgemeineAngaben',
  'bilanzierungsMethoden',
  'erlauterungenBilanz',
  'erlauterungenGuV',
  'sonstigePflichtangaben',
] as const;

const PAGE_SIZE = 20;

export function AnhangListView() {
  const t = useTranslations();
  const paginationLabels = usePaginationLabels('anhang');
  const [anhaenge, setAnhaenge] = useState<Anhang[]>([]);
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
      const data = await apiFetch<AnhangListResponse>(
        `/anhang?mandantId=${mandantId}&pageSize=${PAGE_SIZE}`,
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
      const data = await apiFetch<AnhangListResponse>(
        `/anhang?mandantId=${mandantId}&pageSize=${PAGE_SIZE}&cursor=${encodeURIComponent(cursor)}`,
        { accessToken: token },
      );
      appendResponse(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.network.message'));
    } finally {
      setLoadingMore(false);
    }
  }

  function applyResponse(data: AnhangListResponse) {
    if (Array.isArray(data)) {
      setAnhaenge(data);
      setTotal(data.length);
      setHasMore(false);
      setNextCursor(null);
      return;
    }
    setAnhaenge(data.items);
    setTotal(data.total);
    setHasMore(data.hasMore);
    setNextCursor(data.nextCursor);
  }

  function appendResponse(data: AnhangListResponse) {
    if (Array.isArray(data)) {
      setAnhaenge((prev) => [...prev, ...data]);
      setHasMore(false);
      setNextCursor(null);
      return;
    }
    setAnhaenge((prev) => [...prev, ...data.items]);
    setTotal(data.total);
    setHasMore(data.hasMore);
    setNextCursor(data.nextCursor);
  }

  if (creatingNew || editingId) {
    return (
      <AnhangForm
        anhangId={editingId ?? undefined}
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
          {t('anhang.newAnhang')}
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-slate-500">{t('common.loading')}</div>
      ) : anhaenge.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-500">
          {t('anhang.noAnhang')}
        </div>
      ) : (
        <div className="space-y-3">
          {anhaenge.map((a) => (
            <div
              key={a.id}
              className="bg-white rounded-lg border border-slate-200 p-4 flex items-center justify-between gap-4"
            >
              <div className="flex-1">
                <div className="font-medium text-slate-900 num-de">
                  {t('anhang.geschaeftsjahr')}: {a.geschaeftsjahr}
                </div>
                <div className="text-xs text-slate-500">
                  {a.abschnitte.length}{' '}
                  {a.abschnitte.length === 1 ? 'Abschnitt' : 'Abschnitte'} · Status:{' '}
                  {t(`bilanz.status.${a.status}`)}
                </div>
              </div>
              <PdfActions
                entityType="anhang"
                entityId={a.id}
                wormObjectKey={a.wormObjectKey}
                onGenerated={() => void loadList()}
              />
              <button
                type="button"
                onClick={() => setEditingId(a.id)}
                className="text-sm text-brand-600 hover:text-brand-700"
              >
                {t('common.edit')}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Pagination (M3+ Performance) */}
      {!loading && anhaenge.length > 0 && (
        <Pagination
          hasMore={hasMore}
          nextCursor={nextCursor}
          total={total}
          loadedCount={anhaenge.length}
          onLoadMore={(cursor) => void loadMore(cursor)}
          loading={loadingMore}
          labels={paginationLabels}
        />
      )}
    </div>
  );
}

function AnhangForm({
  anhangId,
  onCancel,
  onSaved,
}: {
  anhangId?: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations();
  const [geschaeftsjahr, setGeschaeftsjahr] = useState<number>(
    new Date().getFullYear(),
  );
  const [abschnitte, setAbschnitte] = useState<AnhangAbschnitt[]>(
    STANDARD_TITEL.map((key, idx) => ({
      titel: t(`anhang.standardAbschnitte.${key}`),
      inhalt: '',
      reihenfolge: idx + 1,
    })),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (anhangId) void init();
  }, [anhangId]);

  async function init() {
    try {
      const token = getAccessToken();
      if (!anhangId || !token) return;
      const data = await apiFetch<Anhang>(`/anhang/${anhangId}`, {
        accessToken: token,
      });
      setGeschaeftsjahr(data.geschaeftsjahr);
      setAbschnitte(
        data.abschnitte.length > 0
          ? data.abschnitte
          : STANDARD_TITEL.map((key, idx) => ({
              titel: t(`anhang.standardAbschnitte.${key}`),
              inhalt: '',
              reihenfolge: idx + 1,
            })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.network.message'));
    }
  }

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
        abschnitte: abschnitte.map((a, idx) => ({
          titel: a.titel,
          inhalt: a.inhalt,
          reihenfolge: idx + 1,
        })),
      };
      if (anhangId) {
        await apiFetch(`/anhang/${anhangId}`, {
          method: 'PATCH',
          accessToken: token,
          body: JSON.stringify(payload),
        });
      } else {
        await apiFetch('/anhang', {
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

  function updateAbschnitt(idx: number, patch: Partial<AnhangAbschnitt>) {
    setAbschnitte((prev) =>
      prev.map((a, i) => (i === idx ? { ...a, ...patch } : a)),
    );
  }

  function removeAbschnitt(idx: number) {
    setAbschnitte((prev) => prev.filter((_, i) => i !== idx));
  }

  function addAbschnitt() {
    setAbschnitte((prev) => [
      ...prev,
      { titel: '', inhalt: '', reihenfolge: prev.length + 1 },
    ]);
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">
          {anhangId ? t('anhang.editAnhang') : t('anhang.newAnhang')}
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
            {t('anhang.actions.save')}
          </button>
        </div>
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium text-slate-700 mb-1">
          {t('anhang.geschaeftsjahr')}
        </label>
        <input
          type="number"
          value={geschaeftsjahr}
          onChange={(e) => setGeschaeftsjahr(Number(e.target.value))}
          disabled={!!anhangId}
          className="block w-48 rounded-md border border-slate-300 px-3 py-2 text-sm num-de"
        />
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="space-y-4">
        {abschnitte.map((a, idx) => (
          <div
            key={idx}
            className="bg-white rounded-lg border border-slate-200 p-4"
          >
            <div className="flex items-start justify-between gap-3 mb-2">
              <input
                type="text"
                value={a.titel}
                onChange={(e) => updateAbschnitt(idx, { titel: e.target.value })}
                placeholder={t('anhang.fields.titel')}
                className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              <button
                type="button"
                onClick={() => removeAbschnitt(idx)}
                className="text-xs text-red-600 hover:text-red-700"
              >
                {t('anhang.actions.deleteAbschnitt')}
              </button>
            </div>
            <textarea
              rows={4}
              value={a.inhalt}
              onChange={(e) => updateAbschnitt(idx, { inhalt: e.target.value })}
              placeholder={t('anhang.placeholders.allgemeineAngaben')}
              className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
        ))}
      </div>

      <div className="mt-4">
        <button
          type="button"
          onClick={addAbschnitt}
          className="rounded-md border border-dashed border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          {t('anhang.actions.addAbschnitt')}
        </button>
      </div>
    </div>
  );
}