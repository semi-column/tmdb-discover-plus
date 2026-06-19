import { useState, useCallback, useRef, useEffect } from 'react';
import { api } from '../services/api';

const DEBOUNCE_MS = 300;
const DEFAULT_LIMIT = 24;

/**
 * Resolve the identifier of a marketplace entry/card. Search cards expose
 * `marketplaceId`; detail entries may expose `id`.
 */
const entryId = (entry) => entry?.marketplaceId ?? entry?.id ?? null;

/**
 * Dispatch a marketplace entry to the matching per-source preview method on
 * the api singleton. TMDB (and any unknown source) falls back to the generic
 * `/preview` pipeline. (Requirements 12.1, 12.2)
 */
function previewBySource(entry, apiKey) {
  const { source, type, filters } = entry;
  switch (source) {
    case 'imdb':
      return api.previewImdbCatalog(type, filters);
    case 'anilist':
      return api.previewAnilistCatalog(type, filters);
    case 'mal':
      return api.previewMalCatalog(type, filters);
    case 'kitsu':
      return api.previewKitsuCatalog(type, filters);
    case 'simkl':
      return api.previewSimklCatalog(type, filters);
    case 'trakt':
      return api.previewTraktCatalog(type, filters);
    case 'tmdb':
    default:
      return api.preview(apiKey, type, filters);
  }
}

/**
 * Hook backing the catalog marketplace search/preview/install/like UI.
 *
 * @param {object} [options]
 * @param {string|null} [options.userId]      Active user id used as the install target.
 * @param {Function|null} [options.refreshConfig] Callback invoked after a successful install
 *                                                 to reload the user's config (e.g. useConfig.loadConfig).
 * @param {string|null} [options.apiKey]       TMDB api key forwarded to the generic preview pipeline.
 */
export function useMarketplace({ userId = null, refreshConfig = null, apiKey = null } = {}) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [total, setTotal] = useState(0);
  // Zero-based page index — matches the server's pagination contract (page 0 is
  // the first page). `loadMore` advances to page + 1.
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  // Latest query parameters used by `search`; reused by `loadMore`.
  const queryRef = useRef({
    q: '',
    source: undefined,
    type: undefined,
    genres: [],
    sort: undefined,
    limit: DEFAULT_LIMIT,
  });
  const debounceRef = useRef(null);
  // Monotonic request id used to drop stale (out-of-order) search responses.
  const requestIdRef = useRef(0);
  // Mirror of `results` so async handlers can read current state without stale closures.
  const resultsRef = useRef([]);
  // Number of items currently loaded across pages.
  const loadedCountRef = useRef(0);

  useEffect(() => {
    resultsRef.current = results;
  }, [results]);

  // Clear any pending debounce timer on unmount.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const runSearch = useCallback(async (params) => {
    const requestId = ++requestIdRef.current;
    const query = {
      q: params.q ?? '',
      source: params.source,
      type: params.type,
      genres: Array.isArray(params.genres) ? params.genres : [],
      sort: params.sort,
      limit: params.limit ?? DEFAULT_LIMIT,
    };
    queryRef.current = query;
    setLoading(true);
    setError(null);
    try {
      const result = await api.searchMarketplace({ ...query, page: 0 });
      if (requestId !== requestIdRef.current) return; // superseded by a newer search
      const items = result?.items ?? [];
      const totalCount = typeof result?.total === 'number' ? result.total : items.length;
      loadedCountRef.current = items.length;
      setResults(items);
      setPage(result?.page ?? 0);
      setTotal(totalCount);
      setHasMore(items.length > 0 && loadedCountRef.current < totalCount);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(err.message);
      setResults([]);
      loadedCountRef.current = 0;
      setHasMore(false);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  // Debounced search: resets to the first page and replaces results. (Requirement 6.1)
  const search = useCallback(
    (params = {}) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        runSearch(params);
      }, DEBOUNCE_MS);
    },
    [runSearch]
  );

  // Fetch the next page and append it to the existing results. (Requirement 9.1)
  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return;
    const requestId = requestIdRef.current; // do not bump: loadMore extends the current search
    const nextPage = page + 1;
    setLoading(true);
    setError(null);
    try {
      const result = await api.searchMarketplace({ ...queryRef.current, page: nextPage });
      if (requestId !== requestIdRef.current) return; // a new search superseded this load
      const items = result?.items ?? [];
      const totalCount = typeof result?.total === 'number' ? result.total : total;
      const newLoaded = loadedCountRef.current + items.length;
      loadedCountRef.current = newLoaded;
      setResults((prev) => [...prev, ...items]);
      setPage(result?.page ?? nextPage);
      setTotal(totalCount);
      setHasMore(items.length > 0 && newLoaded < totalCount);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(err.message);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [loading, hasMore, page, total]);

  // Preview an entry via the matching per-source pipeline. The search card omits
  // filter internals, so fetch the full entry when filters are absent. (Requirements 12.1, 12.2)
  const previewEntry = useCallback(
    async (entry) => {
      if (!entry) return null;
      let full = entry;
      if (!entry.filters) {
        full = await api.getMarketplaceEntry(entryId(entry));
      }
      return previewBySource(full, apiKey);
    },
    [apiKey]
  );

  // Install (clone) an entry into the target config, then refresh the user config. (Requirement 13.1)
  const install = useCallback(
    async (entry, targetUserId = userId) => {
      const id = entryId(entry);
      setError(null);
      try {
        const result = await api.installMarketplaceCatalog(id, targetUserId);
        if (result && typeof result.installs === 'number') {
          setResults((prev) =>
            prev.map((it) =>
              entryId(it) === id
                ? { ...it, engagement: { ...it.engagement, installs: result.installs } }
                : it
            )
          );
        }
        if (typeof refreshConfig === 'function') {
          await refreshConfig();
        }
        return result;
      } catch (err) {
        setError(err.message);
        throw err;
      }
    },
    [userId, refreshConfig]
  );

  // Optimistically toggle a like with rollback on failure. (Requirements 15.1, 15.3)
  const toggleLike = useCallback(async (entry) => {
    const id = entryId(entry);
    const current = resultsRef.current.find((it) => entryId(it) === id);
    if (!current) return undefined;

    const willLike = !current.liked;
    const delta = willLike ? 1 : -1;
    const optimistic = {
      ...current,
      liked: willLike,
      engagement: {
        ...current.engagement,
        likes: Math.max(0, (current.engagement?.likes ?? 0) + delta),
      },
    };
    setResults((prev) => prev.map((it) => (entryId(it) === id ? optimistic : it)));

    try {
      const res = willLike
        ? await api.likeMarketplaceCatalog(id)
        : await api.unlikeMarketplaceCatalog(id);
      // Reconcile with the authoritative like count when the server returns one.
      if (res && typeof res.likes === 'number') {
        setResults((prev) =>
          prev.map((it) =>
            entryId(it) === id
              ? { ...it, liked: willLike, engagement: { ...it.engagement, likes: res.likes } }
              : it
          )
        );
      }
      return res;
    } catch (err) {
      // Roll back to the pre-toggle snapshot.
      setResults((prev) => prev.map((it) => (entryId(it) === id ? current : it)));
      setError(err.message);
      throw err;
    }
  }, []);

  return {
    results,
    search,
    loadMore,
    previewEntry,
    install,
    toggleLike,
    loading,
    error,
    hasMore,
    total,
    page,
  };
}
