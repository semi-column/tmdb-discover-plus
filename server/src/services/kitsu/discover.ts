import { createLogger } from '../../utils/logger.ts';
import { kitsuFetch } from './client.ts';
import type { KitsuListResponse, KitsuAnime } from './types.ts';
import { kitsuResourceToAnime } from './types.ts';
import type { KitsuCatalogFilters } from '../../types/config.ts';
import type { ContentType } from '../../types/common.ts';

const log = createLogger('kitsu:discover');
const PAGE_SIZE = 20;

function contentTypeToSubtype(type: ContentType): string | null {
  if (type === 'movie') return 'movie';
  if (type === 'series') return 'TV';
  return null;
}

function parseKitsuResponse(response: KitsuListResponse): {
  anime: KitsuAnime[];
  hasMore: boolean;
  total: number;
} {
  const anime = response.data.map((resource) => kitsuResourceToAnime(resource));
  const hasMore = !!response.links?.next;
  const total = response.meta?.count || anime.length;
  return { anime, hasMore, total };
}

export async function getTrending(
  type: ContentType,
  page: number
): Promise<{ anime: KitsuAnime[]; hasMore: boolean; total: number }> {
  const params = new URLSearchParams();
  params.set('page[limit]', String(PAGE_SIZE));
  params.set('page[offset]', String((page - 1) * PAGE_SIZE));

  const subtype = contentTypeToSubtype(type);
  if (subtype) params.set('filter[subtype]', subtype);

  const path = `/trending/anime?${params.toString()}`;
  log.debug('Kitsu trending', { type, page });

  const response = await kitsuFetch<KitsuListResponse>(path);
  return parseKitsuResponse(response);
}

export async function searchAnime(
  query: string,
  type: ContentType,
  page: number
): Promise<{ anime: KitsuAnime[]; hasMore: boolean; total: number }> {
  const params = new URLSearchParams();
  params.set('filter[text]', query);
  params.set('page[limit]', String(PAGE_SIZE));
  params.set('page[offset]', String((page - 1) * PAGE_SIZE));

  const subtype = contentTypeToSubtype(type);
  if (subtype) params.set('filter[subtype]', subtype);

  const path = `/anime?${params.toString()}`;
  log.debug('Kitsu search', { query, type, page });

  const response = await kitsuFetch<KitsuListResponse>(path);
  return parseKitsuResponse(response);
}

export async function browseAnime(
  filters: KitsuCatalogFilters,
  type: ContentType,
  page: number
): Promise<{ anime: KitsuAnime[]; hasMore: boolean; total: number }> {
  const params = new URLSearchParams();
  params.set('page[limit]', String(PAGE_SIZE));
  params.set('page[offset]', String((page - 1) * PAGE_SIZE));

  const subtype = contentTypeToSubtype(type);
  if (filters.kitsuSubtype && filters.kitsuSubtype.length > 0) {
    params.set('filter[subtype]', filters.kitsuSubtype.join(','));
  } else if (subtype) {
    params.set('filter[subtype]', subtype);
  }

  if (filters.kitsuStatus && filters.kitsuStatus.length > 0) {
    params.set('filter[status]', filters.kitsuStatus.join(','));
  }

  if (filters.kitsuAgeRating && filters.kitsuAgeRating.length > 0) {
    const supportedAgeRatings = new Set(['G', 'PG', 'R']);
    const ageRatings = [...new Set(filters.kitsuAgeRating)].filter((rating) =>
      supportedAgeRatings.has(rating)
    );
    if (ageRatings.length > 0) {
      params.set('filter[ageRating]', ageRatings.join(','));
    }
  }

  const includeCategories = [...new Set(filters.kitsuCategories || [])].filter(Boolean);
  const excludeCategories = [...new Set(filters.kitsuExcludeCategories || [])].filter(
    (slug) => Boolean(slug) && !includeCategories.includes(slug)
  );

  if (includeCategories.length > 0 || excludeCategories.length > 0) {
    const categoryFilter = [
      ...includeCategories,
      ...excludeCategories.map((slug) => `!${slug}`),
    ].join(',');
    params.set('filter[categories]', categoryFilter);
  }

  if (filters.kitsuSeason && filters.kitsuSeasonYear) {
    params.set('filter[seasonYear]', String(filters.kitsuSeasonYear));
    params.set('filter[season]', filters.kitsuSeason);
  } else if (filters.kitsuSeasonYear) {
    params.set('filter[seasonYear]', String(filters.kitsuSeasonYear));
  }

  if (filters.kitsuStreamers) {
    params.set('filter[streamers]', filters.kitsuStreamers);
  }

  const sort = filters.kitsuSort || '-averageRating';
  params.set('sort', sort);

  const path = `/anime?${params.toString()}`;
  log.debug('Kitsu browse', { type, page, filters: Object.fromEntries(params) });

  const response = await kitsuFetch<KitsuListResponse>(path);
  return parseKitsuResponse(response);
}

export async function discover(
  filters: KitsuCatalogFilters,
  type: ContentType,
  page: number
): Promise<{ anime: KitsuAnime[]; hasMore: boolean; total: number }> {
  try {
    const listType = filters.kitsuListType || 'browse';

    if (listType === 'trending') {
      return await getTrending(type, page);
    }

    return await browseAnime(filters, type, page);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('Kitsu circuit breaker') || message.includes('Kitsu API error')) {
      log.warn('Kitsu unavailable; returning empty result', { type, page });
      return { anime: [], hasMore: false, total: 0 };
    }
    throw error;
  }
}
