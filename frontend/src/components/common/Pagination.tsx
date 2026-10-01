'use client';

import { useTranslations } from 'next-intl';

/**
 * Pagination-Komponente für Cursor-basierte Listen.
 *
 * - "Weitere ... laden"-Button wenn `hasMore=true`
 * - "Alle X Elemente geladen"-Hinweis wenn keine weiteren Seiten existieren
 * - Optionaler Total-Counter ({shown} von {total} angezeigt)
 *
 * Sprachversion: 100% deutsche UI-Texte (useTranslations).
 *
 * @example
 *   <Pagination
 *     hasMore={data.hasMore}
 *     nextCursor={data.nextCursor}
 *     total={data.total}
 *     loadedCount={allItems.length}
 *     onLoadMore={async (cursor) => { await fetchNext(cursor); }}
 *     loading={loading}
 *     labels={{ loadMore, loading, allLoaded, showing }}
 *   />
 */
export function Pagination({
  hasMore,
  nextCursor,
  total,
  loadedCount,
  onLoadMore,
  loading,
  labels,
}: {
  hasMore: boolean;
  nextCursor: string | null;
  total: number;
  loadedCount: number;
  onLoadMore: (cursor: string) => void;
  loading: boolean;
  labels: {
    loadMore: string;
    loading: string;
    allLoaded: string;
    showing: string;
  };
}) {
  return (
    <div className="mt-4 flex flex-col items-center gap-2">
      {/* Status-Text: Counter + Hinweis */}
      <div className="text-xs text-slate-500">
        {/* Platzhalter werden bereits in usePaginationLabels() per t() ersetzt. */}
        {total > 0 ? labels.showing : ''}
      </div>

      {/* "Weitere laden"-Button */}
      {hasMore && nextCursor && (
        <button
          type="button"
          onClick={() => onLoadMore(nextCursor)}
          disabled={loading}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          aria-label={labels.loadMore}
        >
          {loading ? (
            <span className="inline-flex items-center gap-2">
              <svg
                className="h-4 w-4 animate-spin text-slate-500"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <circle
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="3"
                  opacity="0.25"
                />
                <path
                  d="M4 12a8 8 0 018-8"
                  stroke="currentColor"
                  strokeWidth="3"
                  opacity="0.75"
                />
              </svg>
              {labels.loading}
            </span>
          ) : (
            labels.loadMore
          )}
        </button>
      )}

      {/* "Alle geladen"-Hinweis wenn nichts mehr nachzuladen ist */}
      {!hasMore && total > 0 && (
        <div className="text-xs text-slate-400 italic">
          {labels.allLoaded}
        </div>
      )}
    </div>
  );
}

/**
 * Hook-Helper: liefert Pagination-Strings aus dem i18n-Catalog.
 *
 * Modul-Spezifische Strings (`bilanz.pagination`, `guv.pagination`,
 * `audit.pagination`, `anhang.pagination`, `wp.notiz.pagination`)
 * mit Fallback auf einen generischen deutschen Strings.
 */
export function usePaginationLabels(
  module: 'bilanz' | 'guv' | 'anhang' | 'audit' | 'wp',
  values: { count?: number; shown?: number; total?: number } = {},
): {
  loadMore: string;
  loading: string;
  allLoaded: string;
  showing: string;
} {
  const t = useTranslations();

  // Warum die Werte HIER und nicht per String.replace() in der Komponente:
  //
  // next-intl validiert ICU-Meldungen beim Rendern. Eine Meldung mit
  // {count}/{shown}/{total} WIRFT "FORMATTING_ERROR", wenn der Wert beim
  // t()-Aufruf nicht mitgegeben wird. Genau das stand am 2026-09-30 im
  // CI-Log. Der alte Code rief t() ohne Werte auf und ersetzte die
  // Platzhalter erst danach in der Komponente — bei `wp` ohne try/catch
  // propagate der Fehler bis in den Render.
  const { count, shown, total } = values;
  const filled =
    typeof count === 'number' && typeof shown === 'number' && typeof total === 'number';

  // Fallback OHNE Platzhalter, solange die Werte fehlen — sonst würde der
  // Fallback selbst erneut einen Formatiierungsfehler auslösen.
  const fallback = {
    loadMore: 'Weitere Einträge laden',
    loading: 'Lade weitere Einträge…',
    allLoaded: filled ? `Alle ${count} Einträge geladen` : 'Alle Einträge geladen',
    showing: filled ? `${shown} von ${total} angezeigt` : '',
  };

  const key = module === 'wp' ? 'wp.notiz.pagination' : `${module}.pagination`;

  // next-intl 4 akzeptiert in Platzhalter-Values keine `undefined`. Solange
  // die Zählwerte fehlen, übergeben wir die neutralen Defaults 0 — die
  // Platzhalter werden in diesem Zustand ohnehin nicht ausgewertet, weil
  // der jeweilige `fallback` greift.
  const vars = {
    count: count ?? 0,
    shown: shown ?? 0,
    total: total ?? 0,
  };

  return {
    loadMore: t(`${key}.loadMore`, { fallback: fallback.loadMore }),
    loading: t(`${key}.loading`, { fallback: fallback.loading }),
    allLoaded: t(`${key}.allLoaded`, { ...vars, fallback: fallback.allLoaded }),
    showing: t(`${key}.showing`, { ...vars, fallback: fallback.showing }),
  };
}