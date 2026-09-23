'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiFetch, getAccessToken, getActiveMandantId } from '@/lib/api';

type EntityType = 'bilanz' | 'guv' | 'anhang' | 'abschluss';

export function PdfActions({
  entityType,
  entityId,
  wormObjectKey,
  onGenerated,
}: {
  entityType: EntityType;
  entityId: string;
  wormObjectKey: string | null;
  onGenerated?: (key: string) => void;
}) {
  const t = useTranslations();
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const token = getAccessToken();
      const mandantId = getActiveMandantId();
      if (!token || !mandantId) return;
      const result = await apiFetch<{ wormObjectKey: string }>(
        `/pdf/${entityType}/${entityId}/generate`,
        {
          method: 'POST',
          accessToken: token,
          body: JSON.stringify({ mandantId }),
        },
      );
      onGenerated?.(result.wormObjectKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('pdf.error'));
    } finally {
      setGenerating(false);
    }
  }

  function handleView() {
    setPreviewing(true);
    const token = getAccessToken();
    if (!token) return;
    const mandantId = getActiveMandantId();
    const url = `/api/pdf/${entityType}/${entityId}/download?mandantId=${mandantId}`;
    const w = window.open(url, '_blank');
    if (!w) {
      setError(t('pdf.downloadError'));
      setPreviewing(false);
    }
    // Note: opening in new tab means token must be sent as Authorization header.
    // fetch() is required to set headers; window.open can't.
    // Better approach: use a hidden form POST or stream download.
    fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.blob())
      .then((blob) => {
        const blobUrl = URL.createObjectURL(blob);
        window.open(blobUrl, '_blank');
        setPreviewing(false);
      })
      .catch(() => {
        setError(t('pdf.downloadError'));
        setPreviewing(false);
      });
  }

  function handleDownload() {
    const token = getAccessToken();
    const mandantId = getActiveMandantId();
    if (!token || !mandantId) return;
    fetch(`/api/pdf/${entityType}/${entityId}/download?mandantId=${mandantId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${entityType}-${entityId}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      })
      .catch(() => {
        setError(t('pdf.downloadError'));
      });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating}
          className="rounded-md border border-brand-300 bg-white px-3 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-50"
        >
          {generating ? t('pdf.generating') : t('pdf.generate')}
        </button>
        {wormObjectKey && (
          <>
            <button
              type="button"
              onClick={handleView}
              disabled={previewing}
              className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              {t('pdf.view')}
            </button>
            <button
              type="button"
              onClick={handleDownload}
              className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              {t('pdf.download')}
            </button>
          </>
        )}
      </div>
      {wormObjectKey && (
        <span className="text-[10px] text-slate-500">{t('pdf.wormHint')}</span>
      )}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}