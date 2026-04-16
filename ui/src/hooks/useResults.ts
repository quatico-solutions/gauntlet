import { useState, useEffect, useCallback } from "react";
import { api, type VetResult } from "../lib/api";

const DEFAULT_PAGE_SIZE = 50;

export interface UseResultsParams {
  /** Rows per page. Defaults to 50; server caps at 200. */
  limit?: number;
  /** Narrow the listing to a single card's runs. */
  cardId?: string;
}

/**
 * Fetches a page of results from `GET /api/results`. Page-at-a-time: on
 * `loadMore`, the next page is fetched and *appended* to `results`. The
 * hook does not re-fetch prior pages; `refresh()` resets to page 0.
 *
 * Chose page-at-a-time append over cursor-style replace because the UI
 * treats results as a scrolling list (RunsList), and hiding older rows
 * when a user loads more would be surprising.
 */
export function useResults(params?: UseResultsParams) {
  const limit = params?.limit ?? DEFAULT_PAGE_SIZE;
  const cardId = params?.cardId;

  const [results, setResults] = useState<VetResult[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPage = useCallback(
    async (nextOffset: number, append: boolean) => {
      try {
        setLoading(true);
        setError(null);
        const page = await api.results.list({ limit, offset: nextOffset, cardId });
        setTotal(page.total);
        setOffset(nextOffset);
        setResults((prev) => (append ? [...prev, ...page.results] : page.results));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load results");
      } finally {
        setLoading(false);
      }
    },
    [limit, cardId],
  );

  // Reset to page 0 whenever filter/limit changes.
  const refresh = useCallback(() => loadPage(0, false), [loadPage]);

  const loadMore = useCallback(() => {
    const nextOffset = offset + limit;
    if (nextOffset >= total) return;
    return loadPage(nextOffset, true);
  }, [loadPage, offset, limit, total]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const hasMore = results.length < total;

  return { results, total, loading, error, refresh, loadMore, hasMore };
}
