export const TIMEOUTS = {
  REQUEST_MS: 30_000,
  IMDB_FETCH_MS: 10_000,
  TMDB_FETCH_MS: 10_000,
  ANILIST_FETCH_MS: 10_000,
  MAL_FETCH_MS: 10_000,
  SIMKL_FETCH_MS: 10_000,
  NOMINATIM_FETCH_MS: 8_000,
  RPDB_FETCH_MS: 1_500,
  SHUTDOWN_MS: 30_000,
} as const;

export const CACHE_TTLS = {
  CATALOG_HEADER: 10_800,
  CATALOG_STALE_REVALIDATE: 3_600,
  META_HEADER: 86_400,
  LOGO: 604_800,
  DETAIL: 86_400,
  DISCOVER_PAGE: 86_400,
  FALLBACK: 604_800,
  EXTERNAL_ID: 2_592_000,
  NEGATIVE_LOOKUP: 3_600,
  RPDB_NOT_FOUND: 86_400,
  RPDB_RATING: 86_400,
  QUOTA_PERSISTENCE: 3_024_000,
  CATALOG_SERVER_DISCOVER: 86_400,
  CATALOG_SERVER_TRENDING: 10_800,
  ANIME_DISCOVER: 86_400,
  ANIME_TRENDING: 10_800,
  ANIME_ID_MAP: 604_800,
} as const;

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

export const ERROR_DEDUP = {
  MAX_SIZE: 500,
  TTL_MS: 300_000,
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
