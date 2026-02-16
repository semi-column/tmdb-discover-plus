import { createHash } from 'crypto';
import { imdbFetch } from './client.ts';
import { getCache } from '../cache/index.js';
import { config } from '../../config.ts';
import { createLogger } from '../../utils/logger.ts';
import { stableStringify } from '../../utils/stableStringify.ts';

import type {
  ImdbAdvancedSearchParams,
  ImdbSearchResult,
  ImdbRankingResult,
  ImdbListResult,
} from './types.ts';
import type { ContentType } from '../../types/index.ts';

const log = createLogger('imdb:discover');

function buildCursorCacheKey(filterHash: string, skip: number): string {
  return `imdb:cursor:${filterHash}:skip${skip}`;
}

function buildCatalogCacheKey(filterHash: string, skip: number): string {
  return `imdb:catalog:${filterHash}:skip${skip}`;
}

function hashFilters(params: Record<string, unknown>): string {
  return createHash('sha256').update(stableStringify(params)).digest('hex');
}

function mapContentTypeToImdbTypes(type: ContentType): string[] {
  if (type === 'series') return ['tvSeries', 'tvMiniSeries'];
  return ['movie', 'tvMovie'];
}

export async function advancedSearch(
  params: ImdbAdvancedSearchParams,
  contentType: ContentType,
  skip: number = 0
): Promise<ImdbSearchResult> {
  const ttl = config.imdbApi.cacheTtlSearch;

  const queryParams: Record<string, string | number | boolean | string[] | undefined> = {};

  if (params.query) queryParams.query = params.query;
  queryParams.sortBy = params.sortBy || 'POPULARITY';
  queryParams.sortOrder = params.sortOrder || 'ASC';
  queryParams.limit = params.limit || 100;

  const types = params.types?.length ? params.types : mapContentTypeToImdbTypes(contentType);
  queryParams.types = types;

  if (params.genres?.length) queryParams.genres = params.genres;
  if (params.imdbRatingMin) queryParams.imdbRatingMin = params.imdbRatingMin;
  if (params.totalVotesMin) queryParams.totalVotesMin = params.totalVotesMin;
  if (params.releaseDateStart) queryParams.releaseDateStart = params.releaseDateStart;
  if (params.releaseDateEnd) queryParams.releaseDateEnd = params.releaseDateEnd;
  if (params.runtimeMin) queryParams.runtimeMin = params.runtimeMin;
  if (params.runtimeMax) queryParams.runtimeMax = params.runtimeMax;
  if (params.languages?.length) queryParams.languages = params.languages;
  if (params.countries?.length) queryParams.originCountry = params.countries;
  if (params.keywords?.length) queryParams.keywords = params.keywords;
  if (params.awardsWon?.length) queryParams.awardsWon = params.awardsWon;
  if (params.awardsNominated?.length) queryParams.awardsNominated = params.awardsNominated;

  const filterHash = hashFilters(queryParams);

  const cache = getCache();
  const catalogKey = buildCatalogCacheKey(filterHash, skip);
  try {
    const cached = await cache.get(catalogKey);
    if (cached) return cached as ImdbSearchResult;
  } catch {
    // ignore
  }

  if (skip > 0) {
    const cursorKey = buildCursorCacheKey(filterHash, skip);
    try {
      const cursor = (await cache.get(cursorKey)) as string | null;
      if (cursor) {
        queryParams.endCursor = cursor;
      } else {
        log.debug('No cursor cache for skip, returning empty', { skip, filterHash });
        return { titles: [], pageInfo: { hasNextPage: false, endCursor: null } };
      }
    } catch {
      return { titles: [], pageInfo: { hasNextPage: false, endCursor: null } };
    }
  }

  if (params.endCursor) {
    queryParams.endCursor = params.endCursor;
  }

  const data = (await imdbFetch('/api/imdb/search/advanced', queryParams, ttl)) as ImdbSearchResult;

  try {
    await cache.set(catalogKey, data, ttl);
  } catch {
    // ignore
  }

  if (data.pageInfo?.endCursor) {
    const nextSkip = skip + (params.limit || 100);
    const cursorKey = buildCursorCacheKey(filterHash, nextSkip);
    try {
      await cache.set(cursorKey, data.pageInfo.endCursor, ttl);
    } catch {
      // ignore
    }
  }

  return data;
}

export async function getTopRanking(type: ContentType): Promise<ImdbRankingResult> {
  const ttl = config.imdbApi.cacheTtlRanking;
  const endpoint =
    type === 'series' ? '/api/imdb/rankings/top/250?type=TV' : '/api/imdb/rankings/top/250?type=MOVIE';
  const data = (await imdbFetch(endpoint, {}, ttl)) as any;

  // Handle both 'titles' and 'titleChartRankings'
  const list = data?.titles || data?.titleChartRankings;
  
  if (list && Array.isArray(list)) {
    data.titles = list.map((entry: any) => {
      if (entry.title && typeof entry.title === 'object') {
        const { title, ...rest } = entry;
        return { ...title, ...rest };
      }
      return entry;
    });
  }

  return data as ImdbRankingResult;
}

export async function getPopular(type: ContentType): Promise<ImdbRankingResult> {
  const ttl = config.imdbApi.cacheTtlPopular;
  const endpoint =
    type === 'series'
      ? '/api/imdb/rankings/top/popular?type=TV'
      : '/api/imdb/rankings/top/popular?type=MOVIE';
  const data = (await imdbFetch(endpoint, {}, ttl)) as any;

  // Flatten nested title property if present
  if (data?.titles && Array.isArray(data.titles)) {
    data.titles = data.titles.map((entry: any) => {
      if (entry.title && typeof entry.title === 'object') {
        const { title, ...rest } = entry;
        return { ...title, ...rest };
      }
      return entry;
    });
  }

  return data as ImdbRankingResult;
}

export async function getList(
  listId: string,
  skip: number = 0,
  limit: number = 100
): Promise<ImdbListResult> {
  const ttl = config.imdbApi.cacheTtlList;
  const sanitizedId = listId.replace(/[^a-zA-Z0-9]/g, '');
  if (!/^ls\d{1,15}$/.test(sanitizedId)) {
    throw new Error('Invalid IMDb list ID format');
  }

  const params: Record<string, string | number | undefined> = { limit };
  if (skip > 0) {
    const cursorKey = `imdb:listcursor:${sanitizedId}:skip${skip}`;
    const cache = getCache();
    try {
      const cursor = (await cache.get(cursorKey)) as string | null;
      if (cursor) params.endCursor = cursor;
      else return { titles: [], pageInfo: { hasNextPage: false, endCursor: null } };
    } catch {
      return { titles: [], pageInfo: { hasNextPage: false, endCursor: null } };
    }
  }

  const data = (await imdbFetch(`/api/imdb/list/${sanitizedId}`, params, ttl)) as any;

  // Flatten nested title property if present
  if (data?.titles && Array.isArray(data.titles)) {
    data.titles = data.titles.map((entry: any) => {
      if (entry.title && typeof entry.title === 'object') {
        const { title, ...rest } = entry;
        return { ...title, ...rest };
      }
      return entry;
    });
  }

  if (data.pageInfo?.endCursor) {
    const nextSkip = skip + limit;
    const cursorKey = `imdb:listcursor:${sanitizedId}:skip${nextSkip}`;
    const cache = getCache();
    try {
      await cache.set(cursorKey, data.pageInfo.endCursor, ttl);
    } catch {
      // ignore
    }
  }

  return data;
}
