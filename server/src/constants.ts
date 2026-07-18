export const TIMEOUTS = {
  REQUEST_MS: 30_000,
  IMDB_FETCH_MS: 10_000,
  TMDB_FETCH_MS: 10_000,
  ANILIST_FETCH_MS: 10_000,
  MAL_FETCH_MS: 10_000,
  SIMKL_FETCH_MS: 10_000,
  TRAKT_FETCH_MS: 10_000,
  KITSU_FETCH_MS: 10_000,
  NOMINATIM_FETCH_MS: 8_000,
  RPDB_FETCH_MS: 1_500,
  SHUTDOWN_MS: 30_000,
} as const;

export const CONCURRENCY = {
  TMDB_DETAIL: 10,
  IMDB_SEASON: 5,
  ENRICHMENT: 10,
  RESOLVE: 10,
  MAX_IN_FLIGHT: 5_000,
} as const;

export const CIRCUIT_BREAKER_DEFAULTS = {
  THRESHOLD: 10,
  WINDOW_MS: 60_000,
  COOLDOWN_MS: 30_000,
} as const;

export const DISPLAY = {
  CAST_FULL: 20,
  CAST_EXTRAS: 15,
  CAST_DETAILED: 10,
  CAST_LINKS: 5,
  TMDB_PAGE_SIZE: 20,
  IMDB_PAGE_SIZE: 20,
  ANIME_PAGE_SIZE: 20,
  IMDB_EPISODE_PAGE_LIMIT: 250,
  IMDB_EPISODE_PAGE_MAX: 4,
} as const;

export const EXTERNAL_URLS = {
  METAHUB_BASE: 'https://images.metahub.space',
} as const;

export const HEAP_WARN_THRESHOLD_MB = 384;

export function metahubUrl(type: 'poster' | 'background' | 'logo', imdbId: string): string {
  return `${EXTERNAL_URLS.METAHUB_BASE}/${type}/medium/${imdbId}/img`;
}

export function buildStremioSearchUrl(query: string): string {
  return `stremio:///search?search=${encodeURIComponent(query)}`;
}

export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/$/, '');
}

export function buildCatalogId(prefix: string, catalog: { _id?: string; name?: string }): string {
  return `${prefix}-${catalog._id || (catalog.name || 'catalog').toLowerCase().replace(/\s+/g, '-')}`;
}

// --- Catalog Marketplace tunable constants ---------------------------------

/**
 * Composite-score ranking weights and popularity/trending tuning for marketplace
 * search and matching. See design "Search & Matching Strategy".
 *
 *   score = W_TEXT  * textRelevance(query)
 *         + W_FUZZY * trigramSimilarity(name, q)
 *         + W_FACET * facetOverlap(query, entry)
 *         + W_POP   * popularityBoost(entry)
 *
 *   popularityBoost(e) = log10(1 + installs) * POP_INSTALLS_WEIGHT
 *                      + log10(1 + likes)    * POP_LIKES_WEIGHT
 *   trendingScore(e)   = (installs_window + 2 * likes_window)
 *                      / (hoursSincePublished + 2) ^ TRENDING_GRAVITY
 */
export const MARKETPLACE_RANKING = {
  W_TEXT: 1.0,
  W_FUZZY: 0.5,
  W_FACET: 0.3,
  W_POP: 0.2,
  POP_INSTALLS_WEIGHT: 0.6,
  POP_LIKES_WEIGHT: 0.4,
  TRENDING_GRAVITY: 1.5,
  // Minimum normalized fuzzy similarity (0.00–1.00) for an entry to be included.
  FUZZY_THRESHOLD: 0.7,
} as const;

/** Pagination and scale bounds for marketplace search. */
export const MARKETPLACE_PAGINATION = {
  DEFAULT_PAGE_SIZE: 24,
  MIN_PAGE_SIZE: 1,
  MAX_PAGE_SIZE: 50,
  // Total match count is estimated and capped at this maximum.
  TOTAL_COUNT_CAP: 1_000,
  // A storage adapter returns at most this many entries per search request,
  // while still reporting the full match count independent of this cap.
  ADAPTER_RESPONSE_CAP: 100,
} as const;

/** Input and time-window limits for marketplace search and trending. */
export const MARKETPLACE_LIMITS = {
  // Search queries longer than this are truncated before matching.
  MAX_QUERY_LENGTH: 256,
  // Trailing window (in hours) for trending recency. 168h = 7 days.
  RECENCY_WINDOW_HOURS: 168,
} as const;

/** Valid sort modes accepted by marketplace search. */
export const MARKETPLACE_SORT_MODES = [
  'relevance',
  'popular',
  'most-installed',
  'newest',
  'trending',
] as const;
export type MarketplaceSortMode = (typeof MARKETPLACE_SORT_MODES)[number];

/** Valid catalog sources for marketplace entries (case-sensitive). */
export const MARKETPLACE_SOURCES = [
  'tmdb',
  'imdb',
  'anilist',
  'mal',
  'simkl',
  'trakt',
  'kitsu',
] as const;
export type MarketplaceSource = (typeof MARKETPLACE_SOURCES)[number];

/** Valid catalog types for marketplace entries (case-sensitive). */
export const MARKETPLACE_TYPES = ['movie', 'series', 'anime', 'collection'] as const;
export type MarketplaceType = (typeof MARKETPLACE_TYPES)[number];

/**
 * Secret field-name denylist. A public projection MUST NOT contain any of these
 * field names. The explicit names cover known secrets; MARKETPLACE_SECRET_PATTERN
 * additionally rejects any field whose name ends in `Encrypted`.
 */
export const MARKETPLACE_SECRET_DENYLIST = [
  'tmdbApiKeyEncrypted',
  'malClientIdEncrypted',
  'simklApiKeyEncrypted',
  'traktClientIdEncrypted',
  'apiKey',
  'apiKeys',
  'clientId',
  'tmdbApiKey',
  'preferences',
] as const;

/** Matches any field name ending in `Encrypted` (e.g. `*Encrypted` secrets). */
export const MARKETPLACE_SECRET_PATTERN = /Encrypted$/;
