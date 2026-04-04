import { createLogger } from '../../utils/logger.ts';
import { simklFetch, simklCdnFetch } from './client.ts';
import { SIMKL_IMAGE_BASE } from './types.ts';
import type { SimklAnime, SimklTrendingItem, SimklSearchResult } from './types.ts';
import type { SimklCatalogFilters } from '../../types/config.ts';
import type { ContentType } from '../../types/common.ts';

const log = createLogger('simkl:discover');

export async function getTrending(period: string = 'week'): Promise<SimklTrendingItem[]> {
  log.debug('Simkl trending', { period });
  return simklCdnFetch<SimklTrendingItem[]>(`/discover/trending/anime/${period}_500.json`);
}

export async function getByGenre(
  genre: string,
  type: string = 'all',
  sort: string = 'rank',
  page: number = 1,
  apiKey?: string
): Promise<SimklAnime[]> {
  const genreSlug = genre.toLowerCase().replace(/\s+/g, '-');
  const path = `/anime/genres/${genreSlug}/${type}/${sort}?page=${page}&limit=20&extended=full`;
  log.debug('Simkl genre browse', { genre, type, sort, page });
  return simklFetch<SimklAnime[]>(path, apiKey);
}

export async function getPremieres(
  filter: string = 'new',
  type: string = 'all',
  page: number = 1,
  apiKey?: string
): Promise<SimklAnime[]> {
  const path = `/anime/premieres/${filter}?type=${type}&page=${page}&limit=20&extended=full`;
  log.debug('Simkl premieres', { filter, type, page });
  return simklFetch<SimklAnime[]>(path, apiKey);
}

export async function getAiring(
  date: string = 'today',
  sort: string = 'rank',
  apiKey?: string
): Promise<SimklAnime[]> {
  const path = `/anime/airing?date=${date}&sort=${sort}&extended=full`;
  log.debug('Simkl airing', { date, sort });
  return simklFetch<SimklAnime[]>(path, apiKey);
}

export async function getBest(
  filter: string = 'all',
  type: string = 'all',
  page: number = 1,
  apiKey?: string
): Promise<SimklAnime[]> {
  const path = `/anime/best/${filter}?type=${type}&page=${page}&limit=20&extended=full`;
  log.debug('Simkl best', { filter, type, page });
  return simklFetch<SimklAnime[]>(path, apiKey);
}

export async function searchAnime(
  query: string,
  page: number = 1,
  apiKey?: string
): Promise<SimklSearchResult[]> {
  const path = `/search/anime?q=${encodeURIComponent(query)}&page=${page}&limit=20&extended=full`;
  log.debug('Simkl search', { query, page });
  return simklFetch<SimklSearchResult[]>(path, apiKey);
}

export async function lookupById(
  service: string,
  id: string,
  apiKey?: string
): Promise<SimklSearchResult[]> {
  const path = `/search/id?${service}=${encodeURIComponent(id)}`;
  log.debug('Simkl ID lookup', { service, id });
  return simklFetch<SimklSearchResult[]>(path, apiKey);
}

function simklTypeToContentType(animeType: string | undefined): ContentType {
  if (animeType === 'movie') return 'movie';
  return 'series';
}

export async function discover(
  filters: SimklCatalogFilters,
  type: ContentType,
  page: number,
  apiKey?: string
): Promise<{ items: (SimklAnime | SimklTrendingItem)[]; hasMore: boolean }> {
  const listType = filters.simklListType || 'trending';
  const simklType =
    type === 'movie'
      ? 'movies'
      : filters.simklType === 'movies'
        ? 'all'
        : filters.simklType || 'all';

  switch (listType) {
    case 'trending': {
      const period = filters.simklTrendingPeriod || 'week';
      const items = await getTrending(period);
      // Filter by type
      const filtered = items.filter((item) => {
        if (type === 'movie') return item.anime_type === 'movie' || item.anime_type === 'movies';
        return item.anime_type !== 'movie' && item.anime_type !== 'movies';
      });
      const start = (page - 1) * 20;
      return { items: filtered.slice(start, start + 20), hasMore: start + 20 < filtered.length };
    }
    case 'best': {
      const bestFilter = filters.simklBestFilter || 'all';
      const items = await getBest(bestFilter, simklType, page, apiKey);
      const filtered = items.filter((item) => {
        if (type === 'movie') return item.anime_type === 'movie' || item.anime_type === 'movies';
        return item.anime_type !== 'movie' && item.anime_type !== 'movies';
      });
      return { items: filtered, hasMore: items.length >= 20 };
    }
    case 'genre': {
      const genre = filters.simklGenre || 'Action';
      const sort = filters.simklSort || 'rank';
      const items = await getByGenre(genre, simklType, sort, page, apiKey);
      const filtered = items.filter((item) => {
        if (type === 'movie') return item.anime_type === 'movie' || item.anime_type === 'movies';
        return item.anime_type !== 'movie' && item.anime_type !== 'movies';
      });
      return { items: filtered, hasMore: items.length >= 20 };
    }
    case 'premieres': {
      const items = await getPremieres('new', simklType, page, apiKey);
      const filtered = items.filter((item) => {
        if (type === 'movie') return item.anime_type === 'movie' || item.anime_type === 'movies';
        return item.anime_type !== 'movie' && item.anime_type !== 'movies';
      });
      return { items: filtered, hasMore: items.length >= 20 };
    }
    case 'airing': {
      const items = await getAiring('today', 'rank', apiKey);
      const filtered = items.filter((item) => {
        if (type === 'movie') return item.anime_type === 'movie' || item.anime_type === 'movies';
        return item.anime_type !== 'movie' && item.anime_type !== 'movies';
      });
      const start = (page - 1) * 20;
      return { items: filtered.slice(start, start + 20), hasMore: start + 20 < filtered.length };
    }
    default: {
      const items = await getTrending('week');
      const start = (page - 1) * 20;
      const filtered = items.filter((item) => {
        if (type === 'movie') return item.anime_type === 'movie' || item.anime_type === 'movies';
        return item.anime_type !== 'movie' && item.anime_type !== 'movies';
      });
      return { items: filtered.slice(start, start + 20), hasMore: start + 20 < filtered.length };
    }
  }
}
