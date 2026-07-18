import type { CacheErrorType } from './types/cache.ts';

/** Shared-cache and HTTP response TTLs, in seconds. */
export const CACHE_TTLS = {
  CATALOG_HEADER: 10_800,
  CATALOG_STALE_REVALIDATE: 3_600,
  CATALOG_STALE_IF_ERROR: 259_200,
  META_HEADER: 86_400,
  META_STALE_REVALIDATE: 172_800,
  LOGO: 604_800,
  DETAIL: 86_400,
  DISCOVER_PAGE: 86_400,
  FALLBACK: 604_800,
  EXTERNAL_ID: 2_592_000,
  NEGATIVE_LOOKUP: 3_600,
  RPDB_NOT_FOUND: 86_400,
  RPDB_RATING: 86_400,
  TMDB_API_RESPONSE: 3_600,
  TMDB_REFERENCE: 604_800,
  TMDB_WATCH_PROVIDERS: 86_400,
  TMDB_DISCOVER_TOTAL_PAGES: 86_400,
  CATALOG_SERVER_DISCOVER: 10_800,
  CATALOG_SERVER_TRENDING: 10_800,
  ANIME_DISCOVER: 86_400,
  ANIME_TRENDING: 10_800,
  ANIME_ID_MAP: 604_800,
} as const;

/** Process-local cache TTLs, in milliseconds. */
export const LOCAL_CACHE_TTLS = {
  CONFIG: 5 * 60 * 1000,
  MARKETPLACE_SEARCH: 60 * 1000,
  MARKETPLACE_ENTRY: 5 * 60 * 1000,
  MARKETPLACE_WAIT: 5 * 1000,
  ANILIST_TAGS: 24 * 60 * 60 * 1000,
  ANIME_ID_MAP_REFRESH: 24 * 60 * 60 * 1000,
  ARTWORK_CHECK: 24 * 60 * 60 * 1000,
  ARTWORK_CHECK_NEGATIVE: 60 * 60 * 1000,
  TVDB_TOKEN: 25 * 24 * 60 * 60 * 1000,
  TRAKT_CALENDAR: 5 * 60 * 1000,
  TRAKT_CALENDAR_IMMUTABLE: 24 * 60 * 60 * 1000,
  TRAKT_REFERENCE: 24 * 60 * 60 * 1000,
  PBKDF2: 60 * 60 * 1000,
  ERROR_DEDUP: 5 * 60 * 1000,
} as const;

export const CACHE_LIMITS = {
  ERROR_DEDUP_MAX_SIZE: 500,
} as const;

/** Default IMDb cache lifetimes, in seconds. Environment variables may override these. */
export const IMDB_CACHE_TTL_DEFAULTS = {
  DEFAULT_REQUEST: 3_600,
  SEARCH: 86_400,
  DETAIL: 604_800,
  RANKING: 86_400,
  POPULAR: 21_600,
  LIST: 21_600,
  REFERENCE: 2_592_000,
  SUGGESTIONS: 3_600,
} as const;

/** Cache storage lifecycle settings. */
export const CACHE_STORAGE = {
  MEMORY_DEFAULT_TTL: 3_600,
  MEMORY_CHECK_PERIOD: 300,
  WRAPPER_RETENTION_MULTIPLIER: 2.5,
  WRAPPER_STALE_MULTIPLIER: 2,
  IMDB_RESPONSE_RETENTION_MULTIPLIER: 2,
  IMDB_ADVANCED_SEARCH_TTL_DIVISOR: 2,
} as const;

/** Shared-cache error TTLs, in seconds. */
export const CACHE_ERROR_TTLS: Record<CacheErrorType, number> = {
  EMPTY_RESULT: 60,
  RATE_LIMITED: 900,
  TEMPORARY_ERROR: 120,
  PERMANENT_ERROR: 1800,
  NOT_FOUND: 3600,
  CACHE_CORRUPTED: 60,
};

const TRENDING_LIST_TYPES = new Set([
  'trending',
  'now_playing',
  'upcoming',
  'on_the_air',
  'popular',
  'airing_today',
]);

export function catalogServerTtl(listType: string | undefined | null): number {
  return listType && TRENDING_LIST_TYPES.has(listType)
    ? CACHE_TTLS.CATALOG_SERVER_TRENDING
    : CACHE_TTLS.CATALOG_SERVER_DISCOVER;
}
