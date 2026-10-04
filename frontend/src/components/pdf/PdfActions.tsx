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

  /**
   * PDF ansehen: als Blob laden (mit Authorization-Header) und anzeigen.
   *
   * Bugfix 2026-10-04 — zwei Fehler, dieselbe Funktion:
   *
   * 1. `window.open(url, '_blank')` auf die geschützte Download-URL. Der
   *    Endpunkt antwortet 401, weil `window.open` keinen
   *    `Authorization`-Header setzen kann. Der Kommentar im Code benannte
   *    das Problem, der Aufruf blieb trotzdem stehen: jeder Klick öffnete
   *    zwei Tabs, der erste zeigte die 401-Seite.
   * 2. Der verbleibende Aufruf lief NACH dem `fetch`, also nicht mehr im
   *    Klick-Kontext — und wurde vom Popup-Blocker geschluckt. Gemessen:
   *    0 neue Tabs, der Anwender sah gar nichts.
   *
   * Richtig ist: den Tab synchron im Klick öffnen (kein Popup-Block) und
   * ihn dann auf die Blob-URL navigieren.
   */
  function handleView() {
    setPreviewing(true);
    const token = getAccessToken();
    if (!token) {
      setPreviewing(false);
      return;
    }
    const mandantId = getActiveMandantId();
    const url = `/api/pdf/${entityType}/${entityId}/download?mandantId=${mandantId}`;

    // Synchron im Klick-Handler: Popup-Blocker lassen window.open hier
    // durch, weil es noch eine Benutzeraktion ist.
    const fenster = window.open('', '_blank');
    if (!fenster) {
      setError(t('pdf.downloadError'));
      setPreviewing(false);
      return;
    }
    fenster.document.body.textContent = t('pdf.generating');

    fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => {
        if (!r.ok) {
          // 401/403 als Fehler melden, statt eine Fehlerseite zu öffnen.
          throw new Error(`HTTP ${r.status}`);
        }
        return r.blob();
      })
      .then((blob) => {
        const blobUrl = URL.createObjectURL(blob);
        fenster.location.href = blobUrl;
        setPreviewing(false);
      })
      .catch(() => {
        fenster.close();
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
      .then((r) => {
        // Ohne diese Prüfung landet die 401-JSON-Antwort als "PDF" in der
        // Datei — der Download schlägt dann still fehl.
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.blob();
      })
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