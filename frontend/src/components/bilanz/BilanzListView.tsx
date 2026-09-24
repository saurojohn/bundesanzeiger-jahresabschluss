'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiFetch, getAccessToken, getActiveMandantId } from '@/lib/api';
import { BilanzForm } from './BilanzForm';
import { PdfActions } from '@/components/pdf/PdfActions';
import { ExportActions } from '@/components/exports/ExportActions';
import { DatevImportDialog } from '@/components/datev-import/DatevImportDialog';

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

export function BilanzListView() {
  const t = useTranslations();
  const [bilanzen, setBilanzen] = useState<BilanzSummary[]>([]);
  const [loading, setLoading] = useState(true);
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
      const data = await apiFetch<BilanzSummary[]>(
        `/bilanz?mandantId=${mandantId}`,
        { accessToken: token },
      );
      setBilanzen(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.network.message'));
    } finally {
      setLoading(false);
    }
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
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
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
      )}

      {datevImportOpen && (
        <DatevImportDialog
          geschaeftsjahr={datevImportJahr}
          onClose={() => setDatevImportOpen(false)}
          onImported={() => void loadList()}
        />
      )}
    </div>
  );
}