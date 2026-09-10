import { createLogger } from '../../utils/logger.ts';
import { jikanFetch } from './client.ts';
import type { JikanResponse, MalAnime } from './types.ts';
import { jikanToMalAnime } from './types.ts';
import type { MalCatalogFilters } from '../../types/config.ts';
import type { ContentType } from '../../types/common.ts';

const log = createLogger('mal:discover');
const PAGE_SIZE = 25; // Jikan default/max page size
const SUPPORTED_JIKAN_TYPES = new Set(['tv', 'movie', 'ova', 'special', 'ona', 'music']);

export interface MalDiscoverResult {
  anime: MalAnime[];
  hasMore: boolean;
  total: number;
  lastPage?: number;
  upstreamUnavailable?: true;
}

export function randomPageWithin(lastPage: number | undefined, randomValue = Math.random): number {
  const safeLastPage = Number.isFinite(lastPage) ? Math.max(1, Math.floor(lastPage as number)) : 1;
  const safeRandomValue = Math.min(0.999999999, Math.max(0, randomValue()));
  return Math.floor(safeRandomValue * safeLastPage) + 1;
}

function isRecoverableJikanError(error: unknown): boolean {
  const statusCode =
    typeof error === 'object' && error !== null && 'statusCode' in error
      ? Number((error as { statusCode?: number }).statusCode)
      : undefined;
  const message = error instanceof Error ? error.message : String(error || '');
  const isJikanError =
    message.includes('Jikan API error') || message.includes('Jikan circuit breaker');
  if (message.includes('Jikan API error')) return true;
  const messageStatus = Number(message.match(/Jikan API error:\s*(\d{3})/)?.[1]);
  const effectiveStatus = Number.isFinite(statusCode) ? statusCode : messageStatus;
  const normalizedStatus = typeof effectiveStatus === 'number' ? effectiveStatus : Number.NaN;

  return (
    isJikanError &&
    (normalizedStatus === 429 || (Number.isFinite(normalizedStatus) && normalizedStatus >= 500))
  );
}

function contentTypeToJikanType(type: ContentType): string | null {
  if (type === 'movie') return 'movie';
  if (type === 'anime') return null;
  return 'tv';
}

function normalizeJikanSort(sort?: string): { orderBy: string; direction: 'asc' | 'desc' } {
  const normalized = String(sort || '')
    .trim()
    .toLowerCase();

  if (normalized === 'anime_score' || normalized === 'score') {
    return { orderBy: 'score', direction: 'desc' };
  }

  if (normalized === 'anime_num_list_users' || normalized === 'members') {
    return { orderBy: 'members', direction: 'desc' };
  }

  if (normalized === 'asc' || normalized === 'desc') {
    return { orderBy: 'score', direction: normalized };
  }

  return { orderBy: 'score', direction: 'desc' };
}

/**
 * /top/anime - Rankings with native type + filter support
 * Jikan supports combining type + filter, so "Most Popular Movies" works directly.
 */
export async function getRanking(
  rankingType: string,
  type: ContentType,
  page: number
): Promise<MalDiscoverResult> {
  const params = new URLSearchParams();
  params.set('page', String(page));

  // Ranking types that ARE a type filter; these are the values Jikan supports for the /anime type field.
  const typeRankings = [...SUPPORTED_JIKAN_TYPES];
  // Ranking types that ARE a filter (airing, upcoming, bypopularity, favorite)
  const filterRankings = ['airing', 'upcoming', 'bypopularity', 'favorite'];

  if (typeRankings.includes(rankingType)) {
    params.set('type', rankingType);
  } else if (filterRankings.includes(rankingType)) {
    params.set('filter', rankingType);
    const jikanType = contentTypeToJikanType(type);
    if (jikanType) params.set('type', jikanType);
  } else if (rankingType === 'all') {
    // Default "all" should still be type-aware for movie/series catalogs
    // so each catalog type gets different baseline results.
    const jikanType = contentTypeToJikanType(type);
    if (jikanType) params.set('type', jikanType);
  } else {
    const jikanType = contentTypeToJikanType(type);
    if (jikanType) params.set('type', jikanType);
  }
  // For unknown ranking values, we also scope by selected content type.

  const path = `/top/anime?${params.toString()}`;
  log.debug('Jikan ranking', { rankingType, type, page });

  let response: JikanResponse;
  try {
    response = await jikanFetch<JikanResponse>(path);
  } catch (err) {
    // If top ranking query returns 504 / network error, fall back to current season
    log.warn('Top anime query failed, falling back to current season', {
      path,
      error: (err as Error).message,
    });
    const fallbackParams = new URLSearchParams();
    fallbackParams.set('page', String(page));
    const jikanType = contentTypeToJikanType(type);
    if (jikanType) fallbackParams.set('filter', jikanType);
    response = await jikanFetch<JikanResponse>(`/seasons/now?${fallbackParams.toString()}`);
  }

  // If response has no data (e.g., self-hosted DB cold on specific top filters), fall back to /seasons/now
  if (!response?.data || response.data.length === 0) {
    const fallbackParams = new URLSearchParams();
    fallbackParams.set('page', String(page));
    const jikanType = contentTypeToJikanType(type);
    if (jikanType) fallbackParams.set('filter', jikanType);
    try {
      const seasonalRes = await jikanFetch<JikanResponse>(
        `/seasons/now?${fallbackParams.toString()}`
      );
      if (seasonalRes?.data?.length > 0) {
        response = seasonalRes;
      }
    } catch {
      // Ignore fallback errors and return original response
    }
  }

  const anime = (response?.data || []).map(jikanToMalAnime);

  return {
    anime,
    hasMore: response?.pagination?.has_next_page || false,
    total: response?.pagination?.items?.total || anime.length,
    lastPage: response?.pagination?.last_visible_page || 1,
  };
}

/**
 * /seasons/{year}/{season} - Seasonal anime with native type filtering
 */
export async function getSeasonal(
  year: number,
  season: string,
  sort: string | undefined,
  type: ContentType,
  page: number
): Promise<MalDiscoverResult> {
  const params = new URLSearchParams();
  params.set('page', String(page));
  const jikanSeasonType = contentTypeToJikanType(type);
  if (jikanSeasonType) params.set('filter', jikanSeasonType);

  const { orderBy, direction } = normalizeJikanSort(sort);
  params.set('order_by', orderBy);
  params.set('sort', direction);

  const path = `/seasons/${year}/${season}?${params.toString()}`;
  log.debug('Jikan seasonal', { year, season, type, page, orderBy, direction });

  const response = await jikanFetch<JikanResponse>(path);
  const anime = response.data.map(jikanToMalAnime);

  return {
    anime,
    hasMore: response.pagination.has_next_page,
    total: response.pagination.items.total,
    lastPage: response.pagination.last_visible_page,
  };
}

/**
 * /anime?q= - Search with native type filtering
 */
export async function searchAnime(
  query: string,
  type: ContentType,
  page: number
): Promise<MalDiscoverResult> {
  const params = new URLSearchParams();
  params.set('q', query);
  params.set('page', String(page));
  const jikanSearchType = contentTypeToJikanType(type);
  if (jikanSearchType) params.set('type', jikanSearchType);
  params.set('order_by', 'members');
  params.set('sort', 'desc');

  const path = `/anime?${params.toString()}`;
  log.debug('Jikan search', { query, type, page });

  const response = await jikanFetch<JikanResponse>(path);
  const anime = response.data.map(jikanToMalAnime);

  return {
    anime,
    hasMore: response.pagination.has_next_page,
    total: response.pagination.items.total,
    lastPage: response.pagination.last_visible_page,
  };
}

/**
 * /anime - General browse with advanced filters (genres, type, status, rating, score)
 * Uses the Jikan /anime endpoint which supports all filter parameters.
 */
export async function browseAnime(
  filters: MalCatalogFilters,
  type: ContentType,
  page: number
): Promise<MalDiscoverResult> {
  const params = new URLSearchParams();
  params.set('page', String(page));

  // Media type:
  // - If user picked one, use `type`; multiple picks use the comma-separated `types` (mutually exclusive with `type`).
  // - For movie catalogs, default to movie.
  // - For series catalogs, omit type to allow TV/OVA/ONA/special results,
  //   then filter out movies client-side after fetch.
  let shouldFilterOutMovies = false;
  if (filters.malMediaType && filters.malMediaType.length > 1) {
    params.set('types', filters.malMediaType.join(','));
  } else if (filters.malMediaType && filters.malMediaType.length > 0) {
    params.set('type', filters.malMediaType[0]);
  } else if (type === 'movie') {
    const jikanBrowseType = contentTypeToJikanType(type);
    if (jikanBrowseType) params.set('type', jikanBrowseType);
  } else if (type === 'series') {
    shouldFilterOutMovies = true;
  }

  // Exclude media type(s) - independent of `type`/`types`
  if (filters.malExcludeMediaType && filters.malExcludeMediaType.length > 0) {
    params.set('exclude_types', filters.malExcludeMediaType.join(','));
  }

  // Status (Jikan only supports one at a time, no `statuses` equivalent)
  if (filters.malStatus && filters.malStatus.length > 0) {
    params.set('status', filters.malStatus[0]);
  }

  // Rating
  if (filters.malRating) {
    params.set('rating', filters.malRating);
  }

  // SFW-only toggle (hides adult/hentai entries)
  if (filters.malSfw) {
    params.set('sfw', 'true');
  }

  // Aired date range (YYYY-MM-DD, YYYY-MM, or YYYY)
  if (filters.malAiredFrom) {
    params.set('start_date', filters.malAiredFrom);
  }
  if (filters.malAiredTo) {
    params.set('end_date', filters.malAiredTo);
  }

  // Genres (include)
  if (filters.malGenres && filters.malGenres.length > 0) {
    params.set('genres', filters.malGenres.join(','));
  }

  // Genres (exclude)
  if (filters.malExcludeGenres && filters.malExcludeGenres.length > 0) {
    params.set('genres_exclude', filters.malExcludeGenres.join(','));
  }

  // Score range (Jikan uses 0-10 scale)
  if (filters.malScoreMin != null && filters.malScoreMin > 0) {
    params.set('min_score', String(filters.malScoreMin));
  }
  if (filters.malScoreMax != null && filters.malScoreMax < 10) {
    params.set('max_score', String(filters.malScoreMax));
  }

  // Order by + sort direction
  const browseSort = normalizeJikanSort(filters.malSort || filters.malOrderBy);
  if (filters.malOrderBy) {
    params.set('order_by', filters.malOrderBy);
  } else {
    params.set('order_by', browseSort.orderBy);
  }
  params.set('sort', browseSort.direction);

  const path = `/anime?${params.toString()}`;
  log.debug('Jikan browse', { type, page, filters: Object.fromEntries(params) });

  const response = await jikanFetch<JikanResponse>(path);
  let anime = response.data.map(jikanToMalAnime);

  if (anime.length === 0) {
    const requestedType =
      filters.malMediaType && filters.malMediaType.length === 1 ? filters.malMediaType[0] : null;
    if (requestedType && SUPPORTED_JIKAN_TYPES.has(requestedType)) {
      const fallback = await getRanking(requestedType, type, page);
      if (fallback.anime.length > 0) {
        return fallback;
      }
    }
  }

  if (shouldFilterOutMovies) {
    anime = anime.filter((item) => item.media_type !== 'movie');
  }

  return {
    anime,
    hasMore: response.pagination.has_next_page,
    total: response.pagination.items.total,
    lastPage: response.pagination.last_visible_page,
  };
}

/**
 * Main discover entry point — routes to the appropriate Jikan endpoint.
 */
export async function discover(
  filters: MalCatalogFilters,
  type: ContentType,
  page: number
): Promise<MalDiscoverResult> {
  try {
    if (filters.malSeason && filters.malSeasonYear) {
      return await getSeasonal(
        filters.malSeasonYear,
        filters.malSeason,
        filters.malSort,
        type,
        page
      );
    }

    const hasAdvancedFilters =
      (filters.malGenres && filters.malGenres.length > 0) ||
      (filters.malExcludeGenres && filters.malExcludeGenres.length > 0) ||
      (filters.malStatus && filters.malStatus.length > 0) ||
      (filters.malMediaType && filters.malMediaType.length > 0) ||
      (filters.malExcludeMediaType && filters.malExcludeMediaType.length > 0) ||
      filters.malRating ||
      (filters.malScoreMin != null && filters.malScoreMin > 0) ||
      (filters.malScoreMax != null && filters.malScoreMax < 10) ||
      filters.malSfw ||
      filters.malAiredFrom ||
      filters.malAiredTo ||
      filters.malOrderBy;

    if (hasAdvancedFilters) {
      return await browseAnime(filters, type, page);
    }

    const rankingType = filters.malRankingType || 'all';
    return await getRanking(rankingType, type, page);
  } catch (error) {
    if (isRecoverableJikanError(error)) {
      log.warn('Jikan unavailable; returning empty MAL discover result', {
        type,
        page,
        rankingType: filters.malRankingType || 'all',
      });
      return { anime: [], hasMore: false, total: 0, upstreamUnavailable: true };
    }
    throw error;
  }
}
