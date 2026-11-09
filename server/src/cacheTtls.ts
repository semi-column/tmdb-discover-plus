import 'dotenv/config';
import type { CacheErrorType } from './types/cache.ts';

function ttlOverrides<T extends Record<string, number>>(defaults: T): Record<keyof T, number> {
  const values: Record<keyof T, number> = { ...defaults };
  for (const name of Object.keys(defaults) as Array<keyof T & string>) {
    const key = `CACHE_TTL_${name}`;
    const raw = process.env[key];
    if (raw === undefined) continue;
    const seconds = Number(raw);
    if (
      !/^\d+$/.test(raw) ||
      !Number.isSafeInteger(seconds) ||
      seconds < 1 ||
      seconds > 31_536_000
    ) {
      throw new Error(`${key} must be an integer from 1 to 31536000 seconds`);
    }
    values[name] = seconds;
  }
  return values;
}

/** Shared-cache and HTTP response TTLs, in seconds. */
export const CACHE_TTLS = Object.freeze(
  ttlOverrides({
    CATALOG_HEADER: 10_800,
    CATALOG_STALE_REVALIDATE: 3_600,
    CATALOG_STALE_IF_ERROR: 259_200,
    META_HEADER: 86_400,
    META_ACTIVE_SERIES: 21_600,
    META_STALE_REVALIDATE: 172_800,
    LOGO: 604_800,
    DETAIL: 86_400,
    SEASON_COMPLETED: 1_209_600,
    IMDB_HISTORICAL_MAX_AGE: 1_814_400,
    DISCOVER_PAGE: 86_400,
    FALLBACK: 604_800,
    EXTERNAL_ID: 2_592_000,
    NEGATIVE_LOOKUP: 3_600,
    TMDB_API_RESPONSE: 86_400,
    TMDB_API_KEY_STATUS: 60,
    TMDB_RECENT_DETAIL: 21_600,
    TMDB_MOVIE_DETAIL: 86_400,
    TMDB_ACTIVE_SERIES: 21_600,
    TMDB_DISCOVER_STABLE: 86_400,
    TMDB_REFERENCE: 604_800,
    TMDB_WATCH_PROVIDERS: 86_400,
    TMDB_DISCOVER_TOTAL_PAGES: 86_400,
    CATALOG_SERVER_DISCOVER: 10_800,
    CATALOG_SERVER_TRENDING: 10_800,
    ANIME_DISCOVER: 86_400,
    ANIME_TRENDING: 10_800,
    ANIME_ID_MAP: 604_800,
  })
);

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

export function catalogServerTtl(
  listType: string | undefined | null,
  filters?: {
    sortBy?: unknown;
    datePreset?: unknown;
    releaseDateFrom?: unknown;
    releaseDateTo?: unknown;
    airDateFrom?: unknown;
    airDateTo?: unknown;
    firstAirDateFrom?: unknown;
    firstAirDateTo?: unknown;
    yearFrom?: unknown;
    yearTo?: unknown;
    releasedOnly?: unknown;
    lastXYears?: unknown;
  }
): number {
  if (filters && (!listType || listType === 'discover')) {
    const { sortBy, datePreset } = filters;
    return discoveryTtl(
      typeof sortBy === 'string' ? sortBy.replace(/^release_date\./, 'primary_release_date.') : '',
      Boolean(datePreset && datePreset !== 'custom') ||
        [
          filters.releaseDateFrom,
          filters.releaseDateTo,
          filters.airDateFrom,
          filters.airDateTo,
          filters.firstAirDateFrom,
          filters.firstAirDateTo,
          filters.yearFrom,
          filters.yearTo,
          filters.releasedOnly,
          filters.lastXYears,
        ].some(Boolean)
    );
  }
  return listType && TRENDING_LIST_TYPES.has(listType)
    ? CACHE_TTLS.CATALOG_SERVER_TRENDING
    : CACHE_TTLS.CATALOG_SERVER_DISCOVER;
}

function discoveryTtl(sort: string, dateFiltered: boolean): number {
  return !dateFiltered &&
    [
      'original_title.asc',
      'original_title.desc',
      'title.asc',
      'title.desc',
      'primary_release_date.asc',
      'first_air_date.asc',
      'revenue.asc',
      'revenue.desc',
    ].includes(sort)
    ? CACHE_TTLS.TMDB_DISCOVER_STABLE
    : CACHE_TTLS.CATALOG_SERVER_TRENDING;
}

export function tmdbResponseTtl(
  endpoint: string,
  data: unknown,
  params = new URLSearchParams()
): number {
  if (data === null || data === undefined || (Array.isArray(data) && data.length === 0))
    return CACHE_ERROR_TTLS.EMPTY_RESULT;
  const details = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  if (Array.isArray(details.results) && details.results.length === 0)
    return CACHE_ERROR_TTLS.EMPTY_RESULT;
  if (/^\/find\//.test(endpoint)) {
    const results = [
      'movie_results',
      'tv_results',
      'person_results',
      'tv_episode_results',
      'tv_season_results',
    ]
      .map((key) => details[key])
      .filter(Array.isArray);
    if (results.length && results.every((items) => items.length === 0))
      return CACHE_ERROR_TTLS.EMPTY_RESULT;
  }
  if (/^\/discover\/(movie|tv)$/.test(endpoint)) {
    return discoveryTtl(
      params.get('sort_by') || '',
      [...params.keys()].some((key) =>
        /^(air_date|first_air_date|release_date|primary_release_date)\.(gte|lte)$/.test(key)
      )
    );
  }
  if (
    /^\/trending\/|^\/(movie|tv)\/(popular|now_playing|upcoming|on_the_air|airing_today)$/.test(
      endpoint
    )
  )
    return CACHE_TTLS.CATALOG_SERVER_TRENDING;
  if (/^\/configuration(?:\/|$)|^\/genre\/(movie|tv)\/list$/.test(endpoint)) {
    return CACHE_TTLS.TMDB_REFERENCE;
  }
  if (/^\/(movie|tv)\/\d+\/images$/.test(endpoint)) return CACHE_TTLS.LOGO;
  if (/^\/movie\/\d+$/.test(endpoint)) {
    const releasedAt =
      typeof details.release_date === 'string' ? Date.parse(details.release_date) : NaN;
    if (
      !Number.isFinite(releasedAt) ||
      new Date(releasedAt).toISOString().slice(0, 10) !== details.release_date
    )
      return CACHE_TTLS.TMDB_RECENT_DETAIL;
    const now = new Date();
    const sixMonthsAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 6, 1));
    const lastDay = new Date(
      Date.UTC(sixMonthsAgo.getUTCFullYear(), sixMonthsAgo.getUTCMonth() + 1, 0)
    ).getUTCDate();
    sixMonthsAgo.setUTCDate(Math.min(now.getUTCDate(), lastDay));
    if (releasedAt < sixMonthsAgo.getTime()) return CACHE_TTLS.DETAIL;
    return Date.now() - releasedAt > 30 * 86_400_000
      ? CACHE_TTLS.TMDB_MOVIE_DETAIL
      : CACHE_TTLS.TMDB_RECENT_DETAIL;
  }
  if (/^\/tv\/\d+$/.test(endpoint)) {
    if (
      params
        .get('append_to_response')
        ?.split(',')
        .some((part) => part.startsWith('season/'))
    )
      return CACHE_TTLS.TMDB_RECENT_DETAIL;
    return ['Ended', 'Canceled'].includes(String(details.status))
      ? CACHE_TTLS.DETAIL
      : CACHE_TTLS.TMDB_ACTIVE_SERIES;
  }
  if (/^\/tv\/\d+\/season\/\d+/.test(endpoint)) return CACHE_TTLS.TMDB_RECENT_DETAIL;
  return CACHE_TTLS.TMDB_API_RESPONSE;
}
