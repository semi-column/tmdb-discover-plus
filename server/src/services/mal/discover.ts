import { createLogger } from '../../utils/logger.ts';
import { jikanFetch } from './client.ts';
import type { JikanResponse, MalAnime } from './types.ts';
import { jikanToMalAnime } from './types.ts';
import type { MalCatalogFilters } from '../../types/config.ts';
import type { ContentType } from '../../types/common.ts';

const log = createLogger('mal:discover');
const PAGE_SIZE = 25; // Jikan default/max page size

function contentTypeToJikanType(type: ContentType): string {
  return type === 'movie' ? 'movie' : 'tv';
}

/**
 * /top/anime - Rankings with native type + filter support
 * Jikan supports combining type + filter, so "Most Popular Movies" works directly.
 */
export async function getRanking(
  rankingType: string,
  type: ContentType,
  page: number
): Promise<{ anime: MalAnime[]; hasMore: boolean; total: number }> {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('sfw', 'true');

  // Ranking types that ARE a type filter (tv, movie, ova, special)
  const typeRankings = ['tv', 'movie', 'ova', 'special', 'ona', 'music'];
  // Ranking types that ARE a filter (airing, upcoming, bypopularity, favorite)
  const filterRankings = ['airing', 'upcoming', 'bypopularity', 'favorite'];

  if (typeRankings.includes(rankingType)) {
    // User explicitly chose a type-specific ranking — use it as-is
    params.set('type', rankingType);
  } else if (filterRankings.includes(rankingType)) {
    // Filter-based ranking — also pass the content type for native filtering
    params.set('filter', rankingType);
    params.set('type', contentTypeToJikanType(type));
  } else {
    // Default "all" ranking — filter by content type
    params.set('type', contentTypeToJikanType(type));
  }

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
): Promise<{ anime: MalAnime[]; hasMore: boolean; total: number }> {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('sfw', 'true');
  params.set('filter', contentTypeToJikanType(type));

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
): Promise<{ anime: MalAnime[]; hasMore: boolean; total: number }> {
  const params = new URLSearchParams();
  params.set('q', query);
  params.set('page', String(page));
  params.set('sfw', 'true');
  params.set('type', contentTypeToJikanType(type));
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
 * Main discover entry point — routes to the appropriate Jikan endpoint.
 */
export async function discover(
  filters: MalCatalogFilters,
  type: ContentType,
  page: number
): Promise<{ anime: MalAnime[]; hasMore: boolean; total: number }> {
  if (filters.malSeason && filters.malSeasonYear) {
    return getSeasonal(filters.malSeasonYear, filters.malSeason, filters.malSort, type, page);
  }

  const rankingType = filters.malRankingType || 'all';
  return getRanking(rankingType, type, page);
}
