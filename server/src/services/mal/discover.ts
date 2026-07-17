import { createLogger } from '../../utils/logger.ts';
import { jikanFetch } from './client.ts';
import type { JikanResponse, MalAnime } from './types.ts';
import { jikanToMalAnime } from './types.ts';
import type { MalCatalogFilters } from '../../types/config.ts';
import type { ContentType } from '../../types/common.ts';

const log = createLogger('mal:discover');
const PAGE_SIZE = 25; // Jikan default/max page size

export interface MalDiscoverResult {
  anime: MalAnime[];
  hasMore: boolean;
  total: number;
  upstreamUnavailable?: true;
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

  // Ranking types that ARE a type filter (tv, movie, ova, special)
  const typeRankings = ['tv', 'movie', 'ova', 'special', 'ona', 'music'];
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

  const response = await jikanFetch<JikanResponse>(path);
  const anime = response.data.map(jikanToMalAnime);

  return {
    anime,
    hasMore: response.pagination.has_next_page,
    total: response.pagination.items.total,
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

  const path = `/seasons/${year}/${season}?${params.toString()}`;
  log.debug('Jikan seasonal', { year, season, type, page });

  const response = await jikanFetch<JikanResponse>(path);
  const anime = response.data.map(jikanToMalAnime);

  return {
    anime,
    hasMore: response.pagination.has_next_page,
    total: response.pagination.items.total,
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
  // - If user explicitly picked one, use it.
  // - For movie catalogs, default to movie.
  // - For series catalogs, omit type to allow TV/OVA/ONA/special results,
  //   then filter out movies client-side after fetch.
  let shouldFilterOutMovies = false;
  if (filters.malMediaType && filters.malMediaType.length > 0) {
    params.set('type', filters.malMediaType[0]);
  } else if (type === 'movie') {
    const jikanBrowseType = contentTypeToJikanType(type);
    if (jikanBrowseType) params.set('type', jikanBrowseType);
  } else if (type === 'series') {
    shouldFilterOutMovies = true;
  }

  // Status
  if (filters.malStatus && filters.malStatus.length > 0) {
    params.set('status', filters.malStatus[0]);
  }

  // Rating
  if (filters.malRating) {
    params.set('rating', filters.malRating);
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
  if (filters.malOrderBy) {
    params.set('order_by', filters.malOrderBy);
    params.set('sort', 'desc');
  } else {
    params.set('order_by', 'score');
    params.set('sort', 'desc');
  }

  const path = `/anime?${params.toString()}`;
  log.debug('Jikan browse', { type, page, filters: Object.fromEntries(params) });

  const response = await jikanFetch<JikanResponse>(path);
  let anime = response.data.map(jikanToMalAnime);

  if (shouldFilterOutMovies) {
    anime = anime.filter((item) => item.media_type !== 'movie');
  }

  return {
    anime,
    hasMore: response.pagination.has_next_page,
    total: response.pagination.items.total,
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
      filters.malRating ||
      (filters.malScoreMin != null && filters.malScoreMin > 0) ||
      (filters.malScoreMax != null && filters.malScoreMax < 10) ||
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
