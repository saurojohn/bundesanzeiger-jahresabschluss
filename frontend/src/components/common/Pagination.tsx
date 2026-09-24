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
        {total > 0
          ? labels.showing
              .replace('{shown}', String(loadedCount))
              .replace('{total}', String(total))
          : ''}
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
          {labels.allLoaded.replace('{count}', String(total))}
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
): {
  loadMore: string;
  loading: string;
  allLoaded: string;
  showing: string;
} {
  const t = useTranslations();
  // Fallback-Strings (falls Modul-spezifische nicht vorhanden)
  const fallback = {
    loadMore: 'Weitere Einträge laden',
    loading: 'Lade weitere Einträge…',
    allLoaded: 'Alle {count} Einträge geladen',
    showing: '{shown} von {total} angezeigt',
  };
  if (module === 'wp') {
    return {
      loadMore: t('wp.notiz.pagination.loadMore', { fallback: fallback.loadMore }),
      loading: t('wp.notiz.pagination.loading', { fallback: fallback.loading }),
      allLoaded: t('wp.notiz.pagination.allLoaded', { fallback: fallback.allLoaded }),
      showing: t('wp.notiz.pagination.showing', { fallback: fallback.showing }),
    };
  }
  // module === 'bilanz' | 'guv' | 'anhang' | 'audit'
  const key = `${module}.pagination`;
  try {
    return {
      loadMore: t(`${key}.loadMore`, { fallback: fallback.loadMore }),
      loading: t(`${key}.loading`, { fallback: fallback.loading }),
      allLoaded: t(`${key}.allLoaded`, { fallback: fallback.allLoaded }),
      showing: t(`${key}.showing`, { fallback: fallback.showing }),
    };
  } catch {
    return fallback;
  }
}