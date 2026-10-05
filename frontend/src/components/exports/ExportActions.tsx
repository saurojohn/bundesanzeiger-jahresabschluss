'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiFetch, getAccessToken, getActiveMandantId } from '@/lib/api';
import { P12UploadDialog } from '@/components/signatur/P12UploadDialog';

type EntityType = 'bilanz' | 'guv' | 'anhang' | 'abschluss';
type ExportKind = 'ebilanz' | 'datev' | 'signatur';

export function ExportActions({
  entityType,
  entityId,
  guvId,
  bilanzId,
  anhangId,
  canSign = false,
}: {
  entityType: EntityType;
  entityId: string;
  guvId?: string;
  bilanzId?: string;
  anhangId?: string;
  canSign?: boolean;
}) {
  const t = useTranslations();
  const [busy, setBusy] = useState<ExportKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signOpen, setSignOpen] = useState(false);

  async function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function handleEbilanzGenerate() {
    setBusy('ebilanz');
    setError(null);
    try {
      const token = getAccessToken();
      const mandantId = getActiveMandantId();
      if (!token || !mandantId) return;
      if (!bilanzId || !guvId || !anhangId) {
        setError('Bilanz, GuV und Anhang erforderlich');
        return;
      }
      const result = await apiFetch<{ xbrlBase64: string; metadata: Record<string, unknown> }>(
        '/ebilanz/generate',
        {
          method: 'POST',
          accessToken: token,
          body: JSON.stringify({ bilanzId, guvId, anhangId }),
        },
      );
      const blob = await fetch(
        `data:application/xml;base64,${result.xbrlBase64}`,
      ).then((r) => r.blob());
      await downloadBlob(
        blob,
        `ebilanz-${mandantId.slice(0, 8)}-${entityId.slice(0, 8)}.xbrl`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t('exports.ebilanz.error'));
    } finally {
      setBusy(null);
    }
  }

  async function handleDatevGenerate() {
    setBusy('datev');
    setError(null);
    try {
      const token = getAccessToken();
      const mandantId = getActiveMandantId();
      if (!token || !mandantId || !guvId) return;

      // Beraternummer + Mandantennummer vom User erfragen
      const berater = window.prompt(
        t('exports.datev.beraternummer'),
        '12345',
      );
      if (!berater) return;
      const mandant = window.prompt(
        t('exports.datev.mandantennummer'),
        '67890',
      );
      if (!mandant) return;

      const result = await apiFetch<{ csvBase64: string; metadata: Record<string, unknown> }>(
        '/datev/generate-buchungsstapel',
        {
          method: 'POST',
          accessToken: token,
          body: JSON.stringify({
            guvId,
            mandantId,
            skrPlan: 'SKR04',
            beraternummer: berater,
            mandantennummer: mandant,
            sachkontenlaenge: 4,
          }),
        },
      );
      const blob = await fetch(
        `data:text/csv;charset=utf-8;base64,${result.csvBase64}`,
      ).then((r) => r.blob());
      await downloadBlob(
        blob,
        `EXTF_Buchungsstapel-${entityId.slice(0, 8)}.csv`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t('exports.datev.error'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4">
      <h3 className="text-sm font-semibold text-slate-900 mb-3">
        {t('exports.section')}
      </h3>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleEbilanzGenerate}
          disabled={busy !== null}
          className="rounded-md border border-blue-300 bg-white px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
        >
          {busy === 'ebilanz'
            ? t('exports.ebilanz.generating')
            : t('exports.ebilanz.generate')}
        </button>

        <button
          type="button"
          onClick={handleDatevGenerate}
          disabled={busy !== null || !guvId}
          className="rounded-md border border-purple-300 bg-white px-3 py-1.5 text-xs font-medium text-purple-700 hover:bg-purple-50 disabled:opacity-50"
        >
          {busy === 'datev'
            ? t('exports.datev.generating')
            : t('exports.datev.generate')}
        </button>

        {canSign && (
          <button
            type="button"
            onClick={() => setSignOpen(true)}
            disabled={busy !== null}
            className="rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
          >
            {t('exports.signatur.sign')}
          </button>
        )}
      </div>

      {error && (
        <div className="mt-3 rounded-md bg-red-50 border border-red-200 p-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {signOpen && (
        <P12UploadDialog
          bilanzId={bilanzId}
          guvId={guvId}
          anhangId={anhangId}
          jahresabschlussId={entityType === 'abschluss' ? entityId : undefined}
          // Das Signaturziel explizit mitgeben (Bugfix 2026-10-05): sonst
          // waehlt der Dialog per Prioritaet und wuerde im Bilanz-Formular —
          // wo guvId/anhangId fuer den DATEV-Export mitgegeben werden — die
          // GuV signieren statt der Bilanz, die der Anwender vor sich hat.
          signTarget={entityType}
          onClose={() => setSignOpen(false)}
        />
      )}
    </div>
  );
}