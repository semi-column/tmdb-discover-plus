import { createHash } from 'crypto';
import { imdbFetch } from './client.ts';
import { getCache } from '../cache/index.ts';
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

interface RawRankingResponse {
  titles?: Array<Record<string, unknown>>;
  titleChartRankings?: Array<Record<string, unknown>>;
  pageInfo?: { hasNextPage: boolean; endCursor: string | null };
}

const log = createLogger('imdb:discover');

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

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

function flattenNestedTitles(
  entries: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  return entries.map((entry) => {
    if (entry.title && typeof entry.title === 'object') {
      const { title, ...rest } = entry;
      return { ...(title as Record<string, unknown>), ...rest };
    }
    return entry;
  });
}

export async function advancedSearch(
  params: ImdbAdvancedSearchParams,
  contentType: ContentType,
  skip: number = 0
): Promise<ImdbSearchResult> {
  const ttl = config.imdbApi.cacheTtlSearch;

  const queryParams: Record<string, string | number | boolean | string[] | undefined> = {};

  const hasInTheatersLocation =
    contentType === 'movie' &&
    params.inTheatersLat != null &&
    params.inTheatersLong != null &&
    Number.isFinite(Number(params.inTheatersLat)) &&
    Number.isFinite(Number(params.inTheatersLong));

  if (params.query) queryParams.query = params.query;
  queryParams.sortBy = params.sortBy || 'POPULARITY';
  const requestedOrder = params.sortOrder || 'DESC';
  if (queryParams.sortBy === 'POPULARITY') {
    queryParams.sortOrder = requestedOrder === 'DESC' ? 'ASC' : 'DESC';
  } else {
    queryParams.sortOrder = requestedOrder;
  }
  queryParams.limit = params.limit || 100;

  const types = params.types?.length ? params.types : mapContentTypeToImdbTypes(contentType);
  queryParams.types = hasInTheatersLocation
    ? types.filter((t) => t === 'movie').length > 0
      ? types.filter((t) => t === 'movie')
      : ['movie']
    : types;

  if (params.genres?.length) queryParams.genres = params.genres;
  if (params.excludeGenres?.length) queryParams.excludeGenres = params.excludeGenres;
  if (params.imdbRatingMin) queryParams.imdbRatingMin = params.imdbRatingMin;
  if (params.imdbRatingMax) queryParams.imdbRatingMax = params.imdbRatingMax;
  if (params.totalVotesMin) queryParams.totalVotesMin = params.totalVotesMin;
  if (params.totalVotesMax) queryParams.totalVotesMax = params.totalVotesMax;
  if (params.releaseDateStart) queryParams.releaseDateStart = params.releaseDateStart;
  if (params.releaseDateEnd) queryParams.releaseDateEnd = params.releaseDateEnd;
  if (params.runtimeMin) queryParams.runtimeMin = params.runtimeMin;
  if (params.runtimeMax) queryParams.runtimeMax = params.runtimeMax;
  if (params.languages?.length) queryParams.languages = params.languages;
  if (params.countries?.length) queryParams.countries = params.countries;
  if (params.imdbCountries?.length) queryParams.countries = params.imdbCountries;
  if (params.keywords?.length)
    queryParams.keywords = params.keywords.map((k) => k.replace(/\s+/g, '-'));
  if (params.excludeKeywords?.length)
    queryParams.excludeKeywords = params.excludeKeywords.map((k) => k.replace(/\s+/g, '-'));

  // Emmy is TV-only; best_picture_oscar / best_director_oscar are movie-only.
  // Passing incompatible combinations causes a 500 from the upstream API.
  const TV_ONLY_AWARDS = new Set(['emmy']);
  const MOVIE_ONLY_AWARDS = new Set(['best_picture_oscar', 'best_director_oscar']);
  const filterAwardsByType = (awards: string[] | undefined): string[] | undefined => {
    if (!awards?.length) return undefined;
    const result = awards.filter((a) =>
      contentType === 'series' ? !MOVIE_ONLY_AWARDS.has(a) : !TV_ONLY_AWARDS.has(a)
    );
    return result.length ? result : undefined;
  };
  const compatibleAwardsWon = filterAwardsByType(params.awardsWon);
  const compatibleAwardsNominated = filterAwardsByType(params.awardsNominated);
  if (compatibleAwardsWon?.length) queryParams.awardsWon = compatibleAwardsWon;
  if (compatibleAwardsNominated?.length) queryParams.awardsNominated = compatibleAwardsNominated;

  const filterRankedListsByType = (lists: string[] | undefined): string[] | undefined => {
    if (!lists?.length) return undefined;
    const result = contentType === 'series' ? [] : lists;
    return result.length ? result : undefined;
  };
  const compatibleRankedList =
    params.rankedList && contentType !== 'series' ? params.rankedList : undefined;
  let compatibleRankedLists = filterRankedListsByType(params.rankedLists);
  const compatibleExcludeRankedLists = filterRankedListsByType(params.excludeRankedLists);

  if (
    contentType === 'movie' &&
    params.rankedListMaxRank &&
    !compatibleRankedList &&
    !(compatibleRankedLists?.length || 0) &&
    !(compatibleExcludeRankedLists?.length || 0)
  ) {
    compatibleRankedLists = ['TOP_250'];
  }

  // Phase 1: Companies, People, In Theatres, Certificates
  if (params.companies?.length) queryParams.companies = params.companies;
  if (params.excludeCompanies?.length) queryParams.excludeCompanies = params.excludeCompanies;
  if (params.creditedNames?.length) queryParams.creditedNames = params.creditedNames;

  if (hasInTheatersLocation) {
    const lat = roundTo(Number(params.inTheatersLat), 2);
    const long = roundTo(Number(params.inTheatersLong), 2);
    queryParams.inTheatersLat = roundTo(lat - 0.1, 2);
    queryParams.inTheatersLong = roundTo(long - 0.1, 2);

    const radius = Number(params.inTheatersRadius);
    queryParams.inTheatersRadius = Number.isFinite(radius) && radius > 0 ? radius : 50000;
  }

  if (params.certificateRating) queryParams.certificateRating = params.certificateRating;
  if (params.certificateCountry) queryParams.certificateCountry = params.certificateCountry;
  if (params.certificates?.length) queryParams.certificates = params.certificates;
  if (params.explicitContent) {
    queryParams.explicitContent = params.explicitContent === 'EXCLUDE' ? 'false' : 'true';
  }

  // Phase 2: Ranked Lists, Plot, Filming Locations
  if (compatibleRankedList) queryParams.rankedList = compatibleRankedList;
  if (compatibleRankedLists?.length) queryParams.rankedLists = compatibleRankedLists;
  if (compatibleExcludeRankedLists?.length)
    queryParams.excludeRankedLists = compatibleExcludeRankedLists;
  if (params.rankedListMaxRank) queryParams.rankedListMaxRank = params.rankedListMaxRank;
  if (params.plot?.length) {
    queryParams.plot = typeof params.plot === 'string' ? [params.plot] : params.plot;
  }
  if (params.filmingLocations?.length) {
    queryParams.filmingLocations =
      typeof params.filmingLocations === 'string'
        ? [params.filmingLocations]
        : params.filmingLocations;
  }

  // Phase 3: Metadata Availability
  if (params.withData?.length) queryParams.withData = params.withData;

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
    type === 'series'
      ? '/api/imdb/rankings/top/250?type=TV'
      : '/api/imdb/rankings/top/250?type=MOVIE';
  const fallbackKey = `imdb:top250:fallback:${type}`;
  const cache = getCache();

  try {
    const data = (await imdbFetch(endpoint, {}, ttl)) as RawRankingResponse;

    const list = data?.titles || data?.titleChartRankings;

    if (list && Array.isArray(list)) {
      data.titles = flattenNestedTitles(list);
    }

    try {
      await cache.set(fallbackKey, data, 604800);
    } catch {
      // ignore
    }

    return data as unknown as ImdbRankingResult;
  } catch (err) {
    log.warn('getTopRanking failed, trying fallback cache', {
      type,
      error: (err as Error).message,
    });

    try {
      const fallback = await cache.get(fallbackKey);
      if (fallback) {
        log.info('Serving top250 from fallback cache', { type });
        return fallback as ImdbRankingResult;
      }
    } catch {
      // ignore
    }

    throw err;
  }
}

export async function getPopular(type: ContentType): Promise<ImdbRankingResult> {
  const ttl = config.imdbApi.cacheTtlPopular;
  const endpoint =
    type === 'series'
      ? '/api/imdb/rankings/top/popular?type=TV'
      : '/api/imdb/rankings/top/popular?type=MOVIE';
  const fallbackKey = `imdb:popular:fallback:${type}`;
  const cache = getCache();

  try {
    const data = (await imdbFetch(endpoint, {}, ttl)) as RawRankingResponse;

    if (data?.titles && Array.isArray(data.titles)) {
      data.titles = flattenNestedTitles(data.titles);
    }

    // Store a long-lived fallback copy (7 days) for when the API is persistently down
    try {
      await cache.set(fallbackKey, data, 604800);
    } catch {
      // ignore
    }

    return data as unknown as ImdbRankingResult;
  } catch (err) {
    log.warn('getPopular failed, trying fallback cache', {
      type,
      error: (err as Error).message,
    });

    try {
      const fallback = await cache.get(fallbackKey);
      if (fallback) {
        log.info('Serving popular from fallback cache', { type });
        return fallback as ImdbRankingResult;
      }
    } catch {
      // ignore
    }

    throw err;
  }
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

  const data = (await imdbFetch(
    `/api/imdb/list/${sanitizedId}`,
    params,
    ttl
  )) as RawRankingResponse;

  if (data?.titles && Array.isArray(data.titles)) {
    data.titles = flattenNestedTitles(data.titles);
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

  return data as unknown as ImdbListResult;
}
