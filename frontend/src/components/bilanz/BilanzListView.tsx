'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiFetch, getAccessToken, getActiveMandantId } from '@/lib/api';
import { BilanzForm } from './BilanzForm';
import { PdfActions } from '@/components/pdf/PdfActions';
import { ExportActions } from '@/components/exports/ExportActions';
import { DatevImportDialog } from '@/components/datev-import/DatevImportDialog';
import { Pagination, usePaginationLabels } from '@/components/common/Pagination';

type BilanzPosition = {
  id?: string;
  kontonummer: string;
  bezeichnung: string;
  seite: 'AKTIVA' | 'PASSIVA';
  betragVorjahr: number | null;
  betragAktuell: number;
  reihenfolge: number;
};

type BilanzSummary = {
  id: string;
  geschaeftsjahr: number;
  status: 'DRAFT' | 'VALIDATED' | 'ARCHIVED';
  hinweise: string | null;
  positionen: BilanzPosition[];
  updatedAt: string;
  wormObjectKey: string | null;
};

type BilanzListResponse =
  | BilanzSummary[]
  | {
      items: BilanzSummary[];
      nextCursor: string | null;
      total: number;
      hasMore: boolean;
    };

const PAGE_SIZE = 20;

export function BilanzListView() {
  const t = useTranslations();
  const [bilanzen, setBilanzen] = useState<BilanzSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState<number>(0);
  const [hasMore, setHasMore] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [datevImportOpen, setDatevImportOpen] = useState(false);
  const [datevImportJahr, setDatevImportJahr] = useState<number>(new Date().getFullYear() - 1);

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
      // pageSize aktivieren → Backend liefert cursor-paginierte Response
      const data = await apiFetch<BilanzListResponse>(
        `/bilanz?mandantId=${mandantId}&pageSize=${PAGE_SIZE}`,
        { accessToken: token },
      );
      applyResponse(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.network.message'));
    } finally {
      setLoading(false);
    }
  }

  /**
   * Loescht eine Bilanz (nur DRAFT erlaubt — der Backend-Endpoint prueft das)
   * und laedt die Liste neu.
   *
   * Bugfix 2026-09-29: Der Button referenzierte `onDelete`, eine Funktion, die
   * es in dieser Komponente nie gab — der Klick war ein TypeScript-Fehler und
   * damit toter Code.
   */
  async function handleDelete(id: string): Promise<void> {
    const token = getAccessToken();
    if (!token) return;
    if (!window.confirm(t('common.confirm'))) return;
    try {
      await apiFetch(`/bilanz/${id}`, { method: 'DELETE', accessToken: token });
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.network.message'));
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
      const data = await apiFetch<BilanzListResponse>(
        `/bilanz?mandantId=${mandantId}&pageSize=${PAGE_SIZE}&cursor=${encodeURIComponent(cursor)}`,
        { accessToken: token },
      );
      appendResponse(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.network.message'));
    } finally {
      setLoadingMore(false);
    }
  }

  function applyResponse(data: BilanzListResponse) {
    if (Array.isArray(data)) {
      setBilanzen(data);
      setTotal(data.length);
      setHasMore(false);
      setNextCursor(null);
      return;
    }
    setBilanzen(data.items);
    setTotal(data.total);
    setHasMore(data.hasMore);
    setNextCursor(data.nextCursor);
  }

  function appendResponse(data: BilanzListResponse) {
    if (Array.isArray(data)) {
      setBilanzen((prev) => [...prev, ...data]);
      setHasMore(false);
      setNextCursor(null);
      return;
    }
    setBilanzen((prev) => [...prev, ...data.items]);
    setTotal(data.total);
    setHasMore(data.hasMore);
    setNextCursor(data.nextCursor);
  }

  function summarize(b: BilanzSummary) {
    const aktiva = b.positionen
      .filter((p) => p.seite === 'AKTIVA')
      .reduce((s, p) => s + (p.betragAktuell || 0), 0);
    const passiva = b.positionen
      .filter((p) => p.seite === 'PASSIVA')
      .reduce((s, p) => s + (p.betragAktuell || 0), 0);
    return {
      aktivaSumme: aktiva,
      passivaSumme: passiva,
      saldostimmt: Math.abs(aktiva - passiva) < 0.01,
    };
  }

  if (creatingNew) {
    return (
      <BilanzForm
        onCancel={() => setCreatingNew(false)}
        onSaved={() => {
          setCreatingNew(false);
          void loadList();
        }}
      />
    );
  }

  if (editingId) {
    return (
      <BilanzForm
        bilanzId={editingId}
        onCancel={() => setEditingId(null)}
        onSaved={() => {
          setEditingId(null);
          void loadList();
        }}
      />
    );
  }

  const paginationLabels = usePaginationLabels('bilanz', { count: total, shown: bilanzen.length, total });

  return (
    <div>
      <div className="mb-4 flex justify-between items-center flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setDatevImportOpen(true)}
          className="rounded-md border border-purple-300 bg-white px-3 py-2 text-sm font-medium text-purple-700 hover:bg-purple-50"
        >
          {t('datevImport.action')}
        </button>
        <button
          type="button"
          onClick={() => setCreatingNew(true)}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          {t('bilanz.newBilanz')}
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-slate-500">{t('common.loading')}</div>
      ) : bilanzen.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-500">
          {t('bilanz.noBilanz')}
        </div>
      ) : (
        <div className="space-y-3 md:hidden">
          {/* Mobile: Card-Layout (M4 Sprint 4 Pattern) */}
          {bilanzen.map((b) => {
            const { aktivaSumme, passivaSumme, saldostimmt } = summarize(b);
            return (
              <div
                key={b.id}
                className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-base font-semibold text-slate-900 num-de">
                      {b.geschaeftsjahr}
                    </div>
                    <div className="mt-1">
                      <span
                        className={
                          'inline-flex px-2 py-0.5 rounded text-xs font-medium ' +
                          (b.status === 'DRAFT'
                            ? 'bg-amber-100 text-amber-800'
                            : b.status === 'VALIDATED'
                              ? 'bg-green-100 text-green-800'
                              : 'bg-slate-100 text-slate-700')
                        }
                      >
                        {t(`bilanz.status.${b.status}`)}
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-base font-semibold text-slate-900 num-de">
                      {aktivaSumme.toLocaleString('de-DE', {
                        style: 'currency',
                        currency: 'EUR',
                      })}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      Passiva:{' '}
                      {passivaSumme.toLocaleString('de-DE', {
                        style: 'currency',
                        currency: 'EUR',
                      })}
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
                  <span
                    className={
                      'inline-flex items-center gap-1 text-xs font-medium ' +
                      (saldostimmt ? 'text-green-700' : 'text-red-700')
                    }
                  >
                    {saldostimmt ? '✓ Saldo' : '✗ Saldo'}
                  </span>
                  <div className="flex gap-2">
                    <PdfActions
                      entityType="bilanz"
                      entityId={b.id}
                      wormObjectKey={b.wormObjectKey}
                      onGenerated={() => void loadList()}
                    />
                    <button
                      type="button"
                      onClick={() => setEditingId(b.id)}
                      className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
                    >
                      {t('common.edit')}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(b.id)}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      {t('common.delete')}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Desktop: Table-Layout ab md */}
      {!loading && bilanzen.length > 0 && (
        <div className="hidden md:block bg-white rounded-lg border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-slate-700">
                    {t('bilanz.geschaeftsjahr')}
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-slate-700">
                    Status
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-slate-700 num-de">
                    Aktiva
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-slate-700 num-de">
                    Passiva
                  </th>
                  <th className="px-4 py-3 text-center font-medium text-slate-700">
                    Saldo
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
                {bilanzen.map((b) => {
                  const { aktivaSumme, passivaSumme, saldostimmt } = summarize(b);
                return (
                <tr key={b.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 num-de">{b.geschaeftsjahr}</td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        'inline-flex px-2 py-0.5 rounded text-xs font-medium ' +
                        (b.status === 'DRAFT'
                          ? 'bg-amber-100 text-amber-800'
                          : b.status === 'VALIDATED'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-slate-100 text-slate-700')
                      }
                    >
                      {t(`bilanz.status.${b.status}`)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right num-de">
                    {aktivaSumme.toLocaleString('de-DE', {
                      style: 'currency',
                      currency: 'EUR',
                    })}
                  </td>
                  <td className="px-4 py-3 text-right num-de">
                    {passivaSumme.toLocaleString('de-DE', {
                      style: 'currency',
                      currency: 'EUR',
                    })}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {saldostimmt ? (
                      <span className="inline-flex h-2 w-2 rounded-full bg-green-500" />
                    ) : (
                      <span className="inline-flex h-2 w-2 rounded-full bg-red-500" />
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <PdfActions
                      entityType="bilanz"
                      entityId={b.id}
                      wormObjectKey={b.wormObjectKey}
                      onGenerated={() => void loadList()}
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => setEditingId(b.id)}
                      className="text-sm text-brand-600 hover:text-brand-700"
                    >
                      {t('common.edit')}
                    </button>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {datevImportOpen && (
        <DatevImportDialog
          geschaeftsjahr={datevImportJahr}
          onClose={() => setDatevImportOpen(false)}
          onImported={() => void loadList()}
        />
      )}

      {/* Pagination (M3+ Performance) */}
      {!loading && bilanzen.length > 0 && (
        <Pagination
          hasMore={hasMore}
          nextCursor={nextCursor}
          total={total}
          loadedCount={bilanzen.length}
          onLoadMore={(cursor) => void loadMore(cursor)}
          loading={loadingMore}
          labels={paginationLabels}
        />
      )}
    </div>
  );
}