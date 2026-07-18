import { createLogger } from '../../utils/logger.ts';
import { traktFetch } from './client.ts';
import { LOCAL_CACHE_TTLS } from '../../cacheTtls.ts';
import type {
  TraktMovie,
  TraktShow,
  TraktTrendingMovie,
  TraktTrendingShow,
  TraktPlayedMovie,
  TraktPlayedShow,
  TraktAnticipatedMovie,
  TraktAnticipatedShow,
  TraktBoxOfficeMovie,
  TraktFavoritedMovie,
  TraktFavoritedShow,
  TraktSearchResult,
  TraktCalendarMovie,
  TraktCalendarShow,
  TraktListItem,
} from './types.ts';
import type { TraktCatalogFilters } from '../../types/config.ts';
import type { ContentType } from '../../types/common.ts';

export type DiscoverOptions = {
  /** Optional callback for per-step timing instrumentation */
  onProfile?: DiscoverProfileHook;
};

export type DiscoverProfileEvent = {
  phase: string;
  durationMs: number;
  details?: Record<string, unknown>;
};

export type DiscoverProfileHook = (event: DiscoverProfileEvent) => void;

function monotonicNowNs(): bigint {
  return process.hrtime.bigint();
}

function monotonicDurationMs(startNs: bigint): number {
  return Number(process.hrtime.bigint() - startNs) / 1_000_000;
}

function emitProfile(
  options: DiscoverOptions | undefined,
  phase: string,
  startNs: bigint,
  details?: Record<string, unknown>
): void {
  const hook = options?.onProfile;
  if (!hook) return;
  hook({ phase, durationMs: monotonicDurationMs(startNs), details });
}

const log = createLogger('trakt:discover');
const PAGE_LIMIT = 20;
const MAX_CALENDAR_CHUNK = 33;
const MAX_CALENDAR_RANGE_DAYS = 3650;
const MAX_RECENTLY_AIRED_DAYS = 3650;
const MAX_CALENDAR_EXPLICIT_RANGE_DAYS = 3650;
const DEFAULT_CALENDAR_WINDOW_DAYS = 30;
const CALENDAR_CHUNK_BATCH_SIZE = 6;
const CALENDAR_CACHE_TTL_MS = LOCAL_CACHE_TTLS.TRAKT_CALENDAR;
const CALENDAR_IMMUTABLE_CACHE_TTL_MS = LOCAL_CACHE_TTLS.TRAKT_CALENDAR_IMMUTABLE;
const MAX_CACHE_ENTRIES = 100;
const MAX_RAW_CACHE_ENTRIES = 50;

type RawCacheEntry = {
  items: (TraktMovie | TraktShow)[];
  ts: number;
  sortDirection: CalendarSortDirection;
  complete: boolean;
};

const calendarCache = new Map<string, { items: (TraktMovie | TraktShow)[]; ts: number }>();
const rawCalendarCache = new Map<string, RawCacheEntry>();

function getCalendarCacheTtl(endDate: Date): number {
  const today = startOfTodayUtc();
  return endDate < today ? CALENDAR_IMMUTABLE_CACHE_TTL_MS : CALENDAR_CACHE_TTL_MS;
}

function evictOldest<V>(cache: Map<string, V>, maxEntries: number): void {
  if (cache.size >= maxEntries) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
}
const FILTERABLE_LIST_TYPES = new Set([
  'trending',
  'popular',
  'favorited',
  'watched',
  'played',
  'collected',
  'anticipated',
  'recommended',
  'calendar',
  'recently_aired',
]);
const DIRECT_EXTERNAL_RATING_FILTER_LIST_TYPES = new Set([
  'trending',
  'popular',
  'favorited',
  'watched',
  'played',
  'collected',
  'anticipated',
  'recommended',
]);

type ExternalRatingSupport = {
  imdbRatings: boolean;
  tmdbRatings: boolean;
  rtMeters: boolean;
  rtUserMeters: boolean;
  metascores: boolean;
  imdbVotes: boolean;
  tmdbVotes: boolean;
};

const EMPTY_EXTERNAL_RATING_SUPPORT: ExternalRatingSupport = {
  imdbRatings: false,
  tmdbRatings: false,
  rtMeters: false,
  rtUserMeters: false,
  metascores: false,
  imdbVotes: false,
  tmdbVotes: false,
};

const MOVIE_EXTERNAL_RATING_SUPPORT: ExternalRatingSupport = {
  imdbRatings: true,
  tmdbRatings: true,
  rtMeters: true,
  rtUserMeters: true,
  metascores: true,
  imdbVotes: true,
  tmdbVotes: true,
};

const SERIES_EXTERNAL_RATING_SUPPORT: ExternalRatingSupport = {
  imdbRatings: true,
  tmdbRatings: true,
  rtMeters: false,
  rtUserMeters: false,
  metascores: false,
  imdbVotes: true,
  tmdbVotes: true,
};

const CALENDAR_MOVIE_EXTERNAL_RATING_SUPPORT: ExternalRatingSupport = {
  imdbRatings: true,
  tmdbRatings: true,
  rtMeters: true,
  rtUserMeters: true,
  metascores: false,
  imdbVotes: true,
  tmdbVotes: true,
};

const CALENDAR_SERIES_EXTERNAL_RATING_SUPPORT: ExternalRatingSupport = {
  imdbRatings: false,
  tmdbRatings: true,
  rtMeters: false,
  rtUserMeters: false,
  metascores: false,
  imdbVotes: false,
  tmdbVotes: true,
};

export function normalizeTraktListType(listType?: string): string {
  if (!listType) return 'calendar';
  if (listType === 'community_stats') return 'watched';
  return listType;
}

function shouldApplyFilters(listType: string): boolean {
  return FILTERABLE_LIST_TYPES.has(listType);
}

function supportsDirectExternalRatingFilters(listType: string): boolean {
  return DIRECT_EXTERNAL_RATING_FILTER_LIST_TYPES.has(listType);
}

function getExternalRatingSupport(listType: string, type: ContentType): ExternalRatingSupport {
  const isMovie = type === 'movie';

  if (listType === 'calendar' || listType === 'recently_aired') {
    return isMovie
      ? CALENDAR_MOVIE_EXTERNAL_RATING_SUPPORT
      : CALENDAR_SERIES_EXTERNAL_RATING_SUPPORT;
  }

  if (supportsDirectExternalRatingFilters(listType)) {
    return isMovie ? MOVIE_EXTERNAL_RATING_SUPPORT : SERIES_EXTERNAL_RATING_SUPPORT;
  }

  return EMPTY_EXTERNAL_RATING_SUPPORT;
}

function stripUnreliableRatingFilters(
  listType: string,
  type: ContentType,
  filters?: TraktCatalogFilters
): TraktCatalogFilters | undefined {
  if (!filters) return filters;

  const support = getExternalRatingSupport(listType, type);

  return {
    ...filters,
    traktImdbRatingMin: support.imdbRatings ? filters.traktImdbRatingMin : undefined,
    traktImdbRatingMax: support.imdbRatings ? filters.traktImdbRatingMax : undefined,
    traktTmdbRatingMin: support.tmdbRatings ? filters.traktTmdbRatingMin : undefined,
    traktTmdbRatingMax: support.tmdbRatings ? filters.traktTmdbRatingMax : undefined,
    traktRtMeterMin: support.rtMeters ? filters.traktRtMeterMin : undefined,
    traktRtMeterMax: support.rtMeters ? filters.traktRtMeterMax : undefined,
    traktRtUserMeterMin: support.rtUserMeters ? filters.traktRtUserMeterMin : undefined,
    traktRtUserMeterMax: support.rtUserMeters ? filters.traktRtUserMeterMax : undefined,
    traktMetascoreMin: support.metascores ? filters.traktMetascoreMin : undefined,
    traktMetascoreMax: support.metascores ? filters.traktMetascoreMax : undefined,
    traktImdbVotesMin: support.imdbVotes ? filters.traktImdbVotesMin : undefined,
    traktImdbVotesMax: support.imdbVotes ? filters.traktImdbVotesMax : undefined,
    traktTmdbVotesMin: support.tmdbVotes ? filters.traktTmdbVotesMin : undefined,
    traktTmdbVotesMax: support.tmdbVotes ? filters.traktTmdbVotesMax : undefined,
  };
}

function traktContentType(type: ContentType): string {
  return type === 'movie' ? 'movies' : 'shows';
}

function buildCalendarPath(
  calendarType: string,
  startDate: string,
  days: number,
  type: ContentType
): string {
  switch (calendarType) {
    case 'movies':
      return `/calendars/all/movies/${startDate}/${days}`;
    case 'dvd':
      return `/calendars/all/dvd/${startDate}/${days}`;
    case 'streaming':
      return `/calendars/all/streaming/${startDate}/${days}`;
    case 'shows':
      return `/calendars/all/shows/${startDate}/${days}`;
    case 'shows_new':
      return `/calendars/all/shows/new/${startDate}/${days}`;
    case 'shows_premieres':
      return `/calendars/all/shows/premieres/${startDate}/${days}`;
    case 'shows_finales':
      return `/calendars/all/shows/finales/${startDate}/${days}`;
    default:
      return type === 'movie'
        ? `/calendars/all/movies/${startDate}/${days}`
        : `/calendars/all/shows/${startDate}/${days}`;
  }
}

function isMovieCalendarType(calendarType: string, type: ContentType): boolean {
  return (
    calendarType === 'movies' ||
    calendarType === 'dvd' ||
    calendarType === 'streaming' ||
    (calendarType !== 'shows' &&
      calendarType !== 'shows_new' &&
      calendarType !== 'shows_premieres' &&
      calendarType !== 'shows_finales' &&
      type === 'movie')
  );
}

function parseCalendarDate(value?: string): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setUTCHours(0, 0, 0, 0);
  return parsed;
}

function startOfTodayUtc(): Date {
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  return now;
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  next.setUTCHours(0, 0, 0, 0);
  return next;
}

function formatCalendarDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

function inclusiveDaySpan(startDate: Date, endDate: Date): number {
  return Math.floor((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)) + 1;
}

function buildCalendarChunks(
  startDate: Date,
  endDate: Date
): Array<{ startDate: string; chunkDays: number }> {
  const chunks: Array<{ startDate: string; chunkDays: number }> = [];
  let currentStart = new Date(startDate);

  while (currentStart <= endDate) {
    const daysRemaining = inclusiveDaySpan(currentStart, endDate);
    const chunkDays = Math.min(daysRemaining, MAX_CALENDAR_CHUNK);
    chunks.push({
      startDate: formatCalendarDate(currentStart),
      chunkDays,
    });
    currentStart = addUtcDays(currentStart, chunkDays);
  }

  return chunks;
}

type CalendarDateRange = {
  startDate: Date;
  endDate: Date;
  signature: string;
};

type CalendarSortDirection = 'asc' | 'desc';

function normalizeCalendarSort(
  sort: TraktCatalogFilters['traktCalendarSort'],
  fallback: CalendarSortDirection
): CalendarSortDirection {
  if (sort === 'asc' || sort === 'desc') return sort;
  return fallback;
}

function resolveCalendarDateRange(
  filters: TraktCatalogFilters,
  listType: 'calendar' | 'recently_aired',
  maxRangeDays: number
): CalendarDateRange {
  const defaultDays = Math.min(
    Math.max(filters.traktCalendarDays || DEFAULT_CALENDAR_WINDOW_DAYS, 1),
    maxRangeDays
  );

  const today = startOfTodayUtc();
  const inputStart = parseCalendarDate(filters.traktCalendarStartDate);
  const inputEnd = parseCalendarDate(filters.traktCalendarEndDate);
  const hasExplicitRange = Boolean(inputStart || inputEnd);
  const defaultSort: CalendarSortDirection = 'desc';
  const calendarSort = normalizeCalendarSort(filters.traktCalendarSort, defaultSort);

  let startDate: Date;
  let endDate: Date;

  if (inputStart || inputEnd) {
    if (inputStart && inputEnd) {
      startDate = inputStart;
      endDate = inputEnd;
    } else if (inputStart) {
      startDate = inputStart;
      endDate = listType === 'calendar' ? addUtcDays(inputStart, defaultDays - 1) : today;
    } else {
      endDate = inputEnd!;
      startDate = addUtcDays(inputEnd!, -(defaultDays - 1));
    }
  } else {
    if (listType === 'calendar') {
      startDate = today;
      endDate = addUtcDays(today, defaultDays - 1);
    } else {
      endDate = today;
      startDate = addUtcDays(today, -(defaultDays - 1));
    }
  }

  if (endDate < startDate) {
    const tmp = startDate;
    startDate = endDate;
    endDate = tmp;
  }

  const maxDays = hasExplicitRange ? MAX_CALENDAR_EXPLICIT_RANGE_DAYS : maxRangeDays;
  const span = inclusiveDaySpan(startDate, endDate);
  if (span > maxDays) {
    if (calendarSort === 'desc') {
      startDate = addUtcDays(endDate, -(maxDays - 1));
    } else {
      endDate = addUtcDays(startDate, maxDays - 1);
    }
  }

  return {
    startDate,
    endDate,
    signature: `${formatCalendarDate(startDate)}:${formatCalendarDate(endDate)}`,
  };
}

function buildFilterParams(filters: TraktCatalogFilters): string {
  const params: string[] = [];
  if (filters.traktGenres?.length) params.push(`genres=${filters.traktGenres.join(',')}`);

  // Year range: prefer new numeric fields, fall back to legacy string
  if (filters.traktYearMin != null || filters.traktYearMax != null) {
    params.push(
      `years=${filters.traktYearMin ?? 1900}-${filters.traktYearMax ?? new Date().getFullYear() + 1}`
    );
  } else if (filters.traktYears) {
    params.push(`years=${filters.traktYears}`);
  }

  // Runtime range: prefer new numeric fields, fall back to legacy string
  if (filters.traktRuntimeMin != null || filters.traktRuntimeMax != null) {
    params.push(`runtimes=${filters.traktRuntimeMin ?? 0}-${filters.traktRuntimeMax ?? 400}`);
  } else if (filters.traktRuntimes) {
    params.push(`runtimes=${filters.traktRuntimes}`);
  }

  if (filters.traktCertifications?.length)
    params.push(`certifications=${filters.traktCertifications.join(',')}`);

  // Countries: handle both string (legacy) and string[] formats
  if (filters.traktCountries?.length) {
    const val = filters.traktCountries;
    params.push(`countries=${Array.isArray(val) ? val.join(',') : val}`);
  }
  // Languages: handle both string (legacy) and string[] formats
  if (filters.traktLanguages?.length) {
    const val = filters.traktLanguages;
    params.push(`languages=${Array.isArray(val) ? val.join(',') : val}`);
  }

  if (filters.traktNetworkIds?.length)
    params.push(`network_ids=${filters.traktNetworkIds.join(',')}`);
  if (filters.traktStudioIds?.length) params.push(`studio_ids=${filters.traktStudioIds.join(',')}`);
  if (filters.traktStatus?.length) params.push(`status=${filters.traktStatus.join(',')}`);

  if (filters.traktRatingMin != null || filters.traktRatingMax != null) {
    params.push(`ratings=${filters.traktRatingMin ?? 0}-${filters.traktRatingMax ?? 100}`);
  }
  if (filters.traktVotesMin != null) {
    params.push(`votes=${filters.traktVotesMin}-`);
  }
  if (filters.traktAiredEpisodesMin != null || filters.traktAiredEpisodesMax != null) {
    params.push(
      `aired_episodes=${filters.traktAiredEpisodesMin ?? 0}-${filters.traktAiredEpisodesMax ?? ''}`
    );
  }
  if (filters.traktImdbRatingMin != null || filters.traktImdbRatingMax != null) {
    params.push(
      `imdb_ratings=${filters.traktImdbRatingMin ?? 0}-${filters.traktImdbRatingMax ?? 10}`
    );
  }
  if (filters.traktTmdbRatingMin != null || filters.traktTmdbRatingMax != null) {
    params.push(
      `tmdb_ratings=${filters.traktTmdbRatingMin ?? 0}-${filters.traktTmdbRatingMax ?? 10}`
    );
  }
  if (filters.traktRtMeterMin != null || filters.traktRtMeterMax != null) {
    params.push(`rt_meters=${filters.traktRtMeterMin ?? 0}-${filters.traktRtMeterMax ?? 100}`);
  }
  if (filters.traktMetascoreMin != null || filters.traktMetascoreMax != null) {
    params.push(`metascores=${filters.traktMetascoreMin ?? 0}-${filters.traktMetascoreMax ?? 100}`);
  }
  if (filters.traktImdbVotesMin != null || filters.traktImdbVotesMax != null) {
    params.push(`imdb_votes=${filters.traktImdbVotesMin ?? 0}-${filters.traktImdbVotesMax ?? ''}`);
  }
  if (filters.traktTmdbVotesMin != null || filters.traktTmdbVotesMax != null) {
    params.push(`tmdb_votes=${filters.traktTmdbVotesMin ?? 0}-${filters.traktTmdbVotesMax ?? ''}`);
  }
  if (filters.traktRtUserMeterMin != null || filters.traktRtUserMeterMax != null) {
    params.push(
      `rt_user_meters=${filters.traktRtUserMeterMin ?? 0}-${filters.traktRtUserMeterMax ?? 100}`
    );
  }

  return params.join('&');
}

function buildUrl(
  basePath: string,
  page: number,
  limit: number,
  filters?: TraktCatalogFilters
): string {
  const parts = [`page=${page}`, `limit=${limit}`, 'extended=full'];
  if (filters) {
    const filterStr = buildFilterParams(filters);
    if (filterStr) parts.push(filterStr);
  }
  return `${basePath}?${parts.join('&')}`;
}

function unwrapMovies(items: TraktTrendingMovie[]): TraktMovie[] {
  return items.map((i) => i.movie);
}

function unwrapShows(items: TraktTrendingShow[]): TraktShow[] {
  return items.map((i) => i.show);
}

function toPositiveInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const normalized = Math.trunc(value);
  return normalized > 0 ? normalized : undefined;
}

function resolveSeasonCount(show: TraktShow): number | undefined {
  const seasonsValue = (
    show as TraktShow & {
      seasons?: unknown;
      stats?: { seasons?: unknown };
    }
  ).seasons;

  if (Array.isArray(seasonsValue)) {
    return seasonsValue.length > 0 ? seasonsValue.length : undefined;
  }

  const directCount = toPositiveInteger(seasonsValue);
  if (directCount != null) return directCount;

  const statsCount = toPositiveInteger(
    (
      show as TraktShow & {
        stats?: { seasons?: unknown };
      }
    ).stats?.seasons
  );
  if (statsCount != null) return statsCount;

  return undefined;
}

function withObservedSeasonCount(show: TraktShow, observedSeason?: number): TraktShow {
  const observedCount = toPositiveInteger(observedSeason);
  if (observedCount == null) return show;

  const existingCount = resolveSeasonCount(show);
  if (existingCount != null && existingCount >= observedCount) return show;

  return {
    ...show,
    seasons: existingCount != null ? Math.max(existingCount, observedCount) : observedCount,
  };
}

function applyCorePostFilters(
  items: (TraktMovie | TraktShow)[],
  filters?: TraktCatalogFilters
): (TraktMovie | TraktShow)[] {
  if (!filters) return items;

  let filtered = items;

  // Note: traktRatingMin/Max and traktVotesMin are handled server-side via
  // buildFilterParams (ratings= and votes= query params) and are not re-applied here.

  if (filters.traktAiredEpisodesMin != null || filters.traktAiredEpisodesMax != null) {
    const minAiredEpisodes = filters.traktAiredEpisodesMin ?? 0;
    const maxAiredEpisodes = filters.traktAiredEpisodesMax;

    filtered = filtered.filter((item) => {
      if (!('aired_episodes' in item)) return true;
      const airedEpisodes = item.aired_episodes;
      if (airedEpisodes == null) return true;
      if (airedEpisodes < minAiredEpisodes) return false;
      if (maxAiredEpisodes != null && airedEpisodes > maxAiredEpisodes) return false;
      return true;
    });
  }

  if (filters.traktExcludeSingleSeason) {
    filtered = filtered.filter((item) => {
      const seasonCount = resolveSeasonCount(item as TraktShow);
      return seasonCount == null || seasonCount > 1;
    });
  }

  return filtered;
}

function buildPostFilterCacheSignature(filters?: TraktCatalogFilters): string {
  if (!filters) return 'none';

  return [
    filters.traktAiredEpisodesMin ?? '',
    filters.traktAiredEpisodesMax ?? '',
    filters.traktExcludeSingleSeason ? '1' : '0',
  ].join(':');
}

export async function getTrending(
  type: ContentType,
  page: number,
  filters?: TraktCatalogFilters,
  clientId?: string
): Promise<{ items: (TraktMovie | TraktShow)[]; hasMore: boolean }> {
  const tType = traktContentType(type);
  const url = buildUrl(`/${tType}/trending`, page, PAGE_LIMIT, filters);
  log.debug('Trakt trending', { type, page });

  if (type === 'movie') {
    const data = await traktFetch<TraktTrendingMovie[]>(url, clientId);
    return { items: unwrapMovies(data), hasMore: data.length >= PAGE_LIMIT };
  }
  const data = await traktFetch<TraktTrendingShow[]>(url, clientId);
  return { items: unwrapShows(data), hasMore: data.length >= PAGE_LIMIT };
}

export async function getPopular(
  type: ContentType,
  page: number,
  filters?: TraktCatalogFilters,
  clientId?: string
): Promise<{ items: (TraktMovie | TraktShow)[]; hasMore: boolean }> {
  const tType = traktContentType(type);
  const url = buildUrl(`/${tType}/popular`, page, PAGE_LIMIT, filters);
  log.debug('Trakt popular', { type, page });

  if (type === 'movie') {
    const data = await traktFetch<TraktMovie[]>(url, clientId);
    return { items: data, hasMore: data.length >= PAGE_LIMIT };
  }
  const data = await traktFetch<TraktShow[]>(url, clientId);
  return { items: data, hasMore: data.length >= PAGE_LIMIT };
}

export async function getFavorited(
  type: ContentType,
  period: string,
  page: number,
  filters?: TraktCatalogFilters,
  clientId?: string
): Promise<{ items: (TraktMovie | TraktShow)[]; hasMore: boolean }> {
  const tType = traktContentType(type);
  const url = buildUrl(`/${tType}/favorited/${period}`, page, PAGE_LIMIT, filters);
  log.debug('Trakt favorited', { type, period, page });

  if (type === 'movie') {
    const data = await traktFetch<TraktFavoritedMovie[]>(url, clientId);
    return { items: data.map((i) => i.movie), hasMore: data.length >= PAGE_LIMIT };
  }
  const data = await traktFetch<TraktFavoritedShow[]>(url, clientId);
  return { items: data.map((i) => i.show), hasMore: data.length >= PAGE_LIMIT };
}

export async function getWatched(
  type: ContentType,
  period: string,
  page: number,
  filters?: TraktCatalogFilters,
  clientId?: string
): Promise<{ items: (TraktMovie | TraktShow)[]; hasMore: boolean }> {
  const tType = traktContentType(type);
  const url = buildUrl(`/${tType}/watched/${period}`, page, PAGE_LIMIT, filters);
  log.debug('Trakt watched', { type, period, page });

  if (type === 'movie') {
    const data = await traktFetch<TraktPlayedMovie[]>(url, clientId);
    return { items: data.map((i) => i.movie), hasMore: data.length >= PAGE_LIMIT };
  }
  const data = await traktFetch<TraktPlayedShow[]>(url, clientId);
  return { items: data.map((i) => i.show), hasMore: data.length >= PAGE_LIMIT };
}

export async function getPlayed(
  type: ContentType,
  period: string,
  page: number,
  filters?: TraktCatalogFilters,
  clientId?: string
): Promise<{ items: (TraktMovie | TraktShow)[]; hasMore: boolean }> {
  const tType = traktContentType(type);
  const url = buildUrl(`/${tType}/played/${period}`, page, PAGE_LIMIT, filters);
  log.debug('Trakt played', { type, period, page });

  if (type === 'movie') {
    const data = await traktFetch<TraktPlayedMovie[]>(url, clientId);
    return { items: data.map((i) => i.movie), hasMore: data.length >= PAGE_LIMIT };
  }
  const data = await traktFetch<TraktPlayedShow[]>(url, clientId);
  return { items: data.map((i) => i.show), hasMore: data.length >= PAGE_LIMIT };
}

export async function getCollected(
  type: ContentType,
  period: string,
  page: number,
  filters?: TraktCatalogFilters,
  clientId?: string
): Promise<{ items: (TraktMovie | TraktShow)[]; hasMore: boolean }> {
  const tType = traktContentType(type);
  const url = buildUrl(`/${tType}/collected/${period}`, page, PAGE_LIMIT, filters);
  log.debug('Trakt collected', { type, period, page });

  if (type === 'movie') {
    const data = await traktFetch<TraktPlayedMovie[]>(url, clientId);
    return { items: data.map((i) => i.movie), hasMore: data.length >= PAGE_LIMIT };
  }
  const data = await traktFetch<TraktPlayedShow[]>(url, clientId);
  return { items: data.map((i) => i.show), hasMore: data.length >= PAGE_LIMIT };
}

export async function getAnticipated(
  type: ContentType,
  page: number,
  filters?: TraktCatalogFilters,
  clientId?: string
): Promise<{ items: (TraktMovie | TraktShow)[]; hasMore: boolean }> {
  const tType = traktContentType(type);
  const url = buildUrl(`/${tType}/anticipated`, page, PAGE_LIMIT, filters);
  log.debug('Trakt anticipated', { type, page });

  if (type === 'movie') {
    const data = await traktFetch<TraktAnticipatedMovie[]>(url, clientId);
    return { items: data.map((i) => i.movie), hasMore: data.length >= PAGE_LIMIT };
  }
  const data = await traktFetch<TraktAnticipatedShow[]>(url, clientId);
  return { items: data.map((i) => i.show), hasMore: data.length >= PAGE_LIMIT };
}

export async function getBoxOffice(
  clientId?: string
): Promise<{ items: TraktMovie[]; hasMore: boolean }> {
  const url = '/movies/boxoffice?extended=full';
  log.debug('Trakt box office');
  const data = await traktFetch<TraktBoxOfficeMovie[]>(url, clientId);
  return { items: data.map((i) => i.movie), hasMore: false };
}

export async function getCalendar(
  calendarType: string,
  startDate: string,
  days: number,
  type: ContentType,
  filters?: TraktCatalogFilters,
  clientId?: string
): Promise<{ items: (TraktMovie | TraktShow)[]; hasMore: boolean }> {
  const path = buildCalendarPath(calendarType, startDate, days, type);

  const parts = ['extended=full'];
  if (filters) {
    const filterStr = buildFilterParams(filters);
    if (filterStr) parts.push(filterStr);
  }
  const url = `${path}?${parts.join('&')}`;
  log.debug('Trakt calendar', { calendarType, startDate, days });

  if (isMovieCalendarType(calendarType, type)) {
    const data = await traktFetch<TraktCalendarMovie[]>(url, clientId);
    return { items: data.map((i) => i.movie), hasMore: false };
  }

  const data = await traktFetch<TraktCalendarShow[]>(url, clientId);
  const showMap = new Map<string, { show: TraktShow; maxSeason?: number }>();
  for (const entry of data) {
    const key = entry.show.ids.imdb || entry.show.ids.slug || String(entry.show.ids.trakt);
    const seasonNumber = toPositiveInteger(entry.episode?.season);
    const existing = showMap.get(key);
    if (!existing) {
      showMap.set(key, {
        show: entry.show,
        maxSeason: seasonNumber,
      });
      continue;
    }
    if (seasonNumber != null && (existing.maxSeason == null || seasonNumber > existing.maxSeason)) {
      existing.maxSeason = seasonNumber;
    }
  }
  const shows = Array.from(showMap.values()).map((entry) =>
    withObservedSeasonCount(entry.show, entry.maxSeason)
  );
  return { items: shows, hasMore: false };
}

export async function getRecommended(
  type: ContentType,
  period: string,
  page: number,
  filters?: TraktCatalogFilters,
  clientId?: string
): Promise<{ items: (TraktMovie | TraktShow)[]; hasMore: boolean }> {
  const tType = traktContentType(type);
  const url = buildUrl(`/${tType}/recommended/${period}`, page, PAGE_LIMIT, filters);
  log.debug('Trakt recommended', { type, period, page });

  if (type === 'movie') {
    const data = await traktFetch<TraktFavoritedMovie[]>(url, clientId);
    return { items: data.map((i) => i.movie), hasMore: data.length >= PAGE_LIMIT };
  }
  const data = await traktFetch<TraktFavoritedShow[]>(url, clientId);
  return { items: data.map((i) => i.show), hasMore: data.length >= PAGE_LIMIT };
}

export async function getUpcomingCalendar(
  calendarType: string,
  range: CalendarDateRange,
  type: ContentType,
  filters?: TraktCatalogFilters,
  clientId?: string,
  page = 1,
  options?: DiscoverOptions
): Promise<{ items: (TraktMovie | TraktShow)[]; hasMore: boolean }> {
  const totalStartNs = monotonicNowNs();
  const calendarSort = normalizeCalendarSort(filters?.traktCalendarSort, 'desc');
  const isDescending = calendarSort === 'desc';
  const requiredCount = page * PAGE_LIMIT + 1;
  const apiFilterStr = buildFilterParams(filters ?? {});
  const cacheKey = `upcoming:${calendarType}:${range.signature}:${calendarSort}:${type}:${clientId ?? ''}:${apiFilterStr}:${buildPostFilterCacheSignature(filters)}`;
  const rawCacheKey = `raw:upcoming:${calendarType}:${range.signature}:${type}:${clientId ?? ''}:${apiFilterStr}`;
  const now = Date.now();
  const ttl = getCalendarCacheTtl(range.endDate);
  const cacheLookupStartNs = monotonicNowNs();
  const cached = calendarCache.get(cacheKey);
  emitProfile(options, 'upcoming.cache_lookup', cacheLookupStartNs, {
    hit: Boolean(cached && now - cached.ts < ttl),
  });
  let hasMoreFromEarlyStop = false;

  let allItems: (TraktMovie | TraktShow)[] = [];
  let hasResolvedItems = false;

  // Tier 1: filtered cache (exact match including sort + post-filter params)
  if (cached && now - cached.ts < ttl) {
    allItems = cached.items;
    hasResolvedItems = true;
  }

  // Tier 2: raw cache (same API data, different sort/post-filter)
  if (!hasResolvedItems) {
    const rawCached = rawCalendarCache.get(rawCacheKey);
    if (rawCached && now - rawCached.ts < ttl) {
      let rawItems = rawCached.items;
      if (rawCached.sortDirection !== calendarSort) {
        rawItems = [...rawItems].reverse();
      }
      const postFiltered = applyCorePostFilters(rawItems, filters);
      emitProfile(options, 'upcoming.raw_cache_hit', monotonicNowNs(), {
        complete: rawCached.complete,
        cachedCount: rawCached.items.length,
        postFilteredCount: postFiltered.length,
      });
      allItems = postFiltered;
      evictOldest(calendarCache, MAX_CACHE_ENTRIES);
      calendarCache.set(cacheKey, { items: allItems, ts: now });
      hasResolvedItems = true;
      if (!rawCached.complete && postFiltered.length >= requiredCount) {
        hasMoreFromEarlyStop = true;
      }
    }
  }

  // Tier 3: fetch from API
  if (!hasResolvedItems) {
    const chunks = buildCalendarChunks(range.startDate, range.endDate);

    log.debug('Trakt upcoming calendar', {
      calendarType,
      rangeStart: formatCalendarDate(range.startDate),
      rangeEnd: formatCalendarDate(range.endDate),
      sort: calendarSort,
      chunks: chunks.length,
    });

    const orderedChunks = isDescending ? [...chunks].reverse() : chunks;

    const filterParts = ['extended=full'];
    if (filters) {
      const filterStr = buildFilterParams(filters);
      if (filterStr) filterParts.push(filterStr);
    }

    let stoppedEarly = false;

    if (isMovieCalendarType(calendarType, type)) {
      const movieMap = new Map<string, TraktCalendarMovie>();

      const materializeMovies = () =>
        Array.from(movieMap.values())
          .sort((a, b) =>
            isDescending
              ? (b.released || '').localeCompare(a.released || '')
              : (a.released || '').localeCompare(b.released || '')
          )
          .map((i) => i.movie);

      for (
        let batchStart = 0;
        batchStart < orderedChunks.length;
        batchStart += CALENDAR_CHUNK_BATCH_SIZE
      ) {
        const chunkBatch = orderedChunks.slice(batchStart, batchStart + CALENDAR_CHUNK_BATCH_SIZE);
        const fetchBatchStartNs = monotonicNowNs();
        const chunkResults = await Promise.all(
          chunkBatch.map((chunk) => {
            const path = buildCalendarPath(calendarType, chunk.startDate, chunk.chunkDays, type);
            const url = `${path}?${filterParts.join('&')}`;
            return traktFetch<TraktCalendarMovie[]>(url, clientId);
          })
        );
        emitProfile(options, 'upcoming.batch_fetch', fetchBatchStartNs, {
          batchStart,
          batchSize: chunkBatch.length,
          rows: chunkResults.reduce((sum, rows) => sum + rows.length, 0),
          mode: 'movie',
        });

        const mergeBatchStartNs = monotonicNowNs();
        for (const entry of chunkResults.flat()) {
          const key = entry.movie.ids.imdb || String(entry.movie.ids.tmdb || entry.movie.ids.trakt);
          const existing = movieMap.get(key);
          if (
            !existing ||
            (isDescending
              ? (entry.released || '') > (existing.released || '')
              : (entry.released || '') < (existing.released || ''))
          ) {
            movieMap.set(key, entry);
          }
        }
        emitProfile(options, 'upcoming.batch_merge', mergeBatchStartNs, {
          batchStart,
          dedupedCount: movieMap.size,
          mode: 'movie',
        });

        const filterBatchStartNs = monotonicNowNs();
        const rawCandidateItems = materializeMovies();
        const candidateItems = applyCorePostFilters(rawCandidateItems, filters);
        emitProfile(options, 'upcoming.batch_filter', filterBatchStartNs, {
          batchStart,
          candidateCount: candidateItems.length,
          requiredCount,
          mode: 'movie',
        });
        const hasRemainingChunks = batchStart + CALENDAR_CHUNK_BATCH_SIZE < orderedChunks.length;

        if (candidateItems.length >= requiredCount && hasRemainingChunks) {
          allItems = candidateItems;
          hasResolvedItems = true;
          stoppedEarly = true;
          // Store partial raw cache so subsequent page requests reuse it
          evictOldest(rawCalendarCache, MAX_RAW_CACHE_ENTRIES);
          rawCalendarCache.set(rawCacheKey, {
            items: rawCandidateItems,
            ts: now,
            sortDirection: calendarSort,
            complete: false,
          });
          break;
        }
      }

      if (!hasResolvedItems) {
        const rawItems = materializeMovies();
        allItems = applyCorePostFilters(rawItems, filters);
        hasResolvedItems = true;
        // Store in both caches (raw + filtered)
        evictOldest(rawCalendarCache, MAX_RAW_CACHE_ENTRIES);
        rawCalendarCache.set(rawCacheKey, {
          items: rawItems,
          ts: now,
          sortDirection: calendarSort,
          complete: true,
        });
        evictOldest(calendarCache, MAX_CACHE_ENTRIES);
        calendarCache.set(cacheKey, { items: allItems, ts: now });
      }
    } else {
      const showMap = new Map<string, { entry: TraktCalendarShow; maxSeason?: number }>();

      const materializeShows = () =>
        Array.from(showMap.values())
          .sort((a, b) =>
            isDescending
              ? (b.entry.first_aired || '').localeCompare(a.entry.first_aired || '')
              : (a.entry.first_aired || '').localeCompare(b.entry.first_aired || '')
          )
          .map((item) => withObservedSeasonCount(item.entry.show, item.maxSeason));

      for (
        let batchStart = 0;
        batchStart < orderedChunks.length;
        batchStart += CALENDAR_CHUNK_BATCH_SIZE
      ) {
        const chunkBatch = orderedChunks.slice(batchStart, batchStart + CALENDAR_CHUNK_BATCH_SIZE);
        const fetchBatchStartNs = monotonicNowNs();
        const chunkResults = await Promise.all(
          chunkBatch.map((chunk) => {
            const path = buildCalendarPath(calendarType, chunk.startDate, chunk.chunkDays, type);
            const url = `${path}?${filterParts.join('&')}`;
            return traktFetch<TraktCalendarShow[]>(url, clientId);
          })
        );
        emitProfile(options, 'upcoming.batch_fetch', fetchBatchStartNs, {
          batchStart,
          batchSize: chunkBatch.length,
          rows: chunkResults.reduce((sum, rows) => sum + rows.length, 0),
          mode: 'show',
        });

        const mergeBatchStartNs = monotonicNowNs();
        for (const entry of chunkResults.flat()) {
          const key = entry.show.ids.imdb || entry.show.ids.slug || String(entry.show.ids.trakt);
          const seasonNumber = toPositiveInteger(entry.episode?.season);
          const existing = showMap.get(key);
          if (!existing) {
            showMap.set(key, {
              entry,
              maxSeason: seasonNumber,
            });
            continue;
          }

          if (
            seasonNumber != null &&
            (existing.maxSeason == null || seasonNumber > existing.maxSeason)
          ) {
            existing.maxSeason = seasonNumber;
          }

          if (
            isDescending
              ? (entry.first_aired || '') > (existing.entry.first_aired || '')
              : (entry.first_aired || '') < (existing.entry.first_aired || '')
          ) {
            existing.entry = entry;
          }
        }
        emitProfile(options, 'upcoming.batch_merge', mergeBatchStartNs, {
          batchStart,
          dedupedCount: showMap.size,
          mode: 'show',
        });

        const filterBatchStartNs = monotonicNowNs();
        const rawCandidateItems = materializeShows();
        const candidateItems = applyCorePostFilters(rawCandidateItems, filters);
        emitProfile(options, 'upcoming.batch_filter', filterBatchStartNs, {
          batchStart,
          candidateCount: candidateItems.length,
          requiredCount,
          mode: 'show',
        });
        const hasRemainingChunks = batchStart + CALENDAR_CHUNK_BATCH_SIZE < orderedChunks.length;

        if (candidateItems.length >= requiredCount && hasRemainingChunks) {
          allItems = candidateItems;
          hasResolvedItems = true;
          stoppedEarly = true;
          // Store partial raw cache so subsequent page requests reuse it
          evictOldest(rawCalendarCache, MAX_RAW_CACHE_ENTRIES);
          rawCalendarCache.set(rawCacheKey, {
            items: rawCandidateItems,
            ts: now,
            sortDirection: calendarSort,
            complete: false,
          });
          break;
        }
      }

      if (!hasResolvedItems) {
        const rawItems = materializeShows();
        allItems = applyCorePostFilters(rawItems, filters);
        hasResolvedItems = true;
        // Store in both caches (raw + filtered)
        evictOldest(rawCalendarCache, MAX_RAW_CACHE_ENTRIES);
        rawCalendarCache.set(rawCacheKey, {
          items: rawItems,
          ts: now,
          sortDirection: calendarSort,
          complete: true,
        });
        evictOldest(calendarCache, MAX_CACHE_ENTRIES);
        calendarCache.set(cacheKey, { items: allItems, ts: now });
      }
    }

    if (stoppedEarly) {
      hasMoreFromEarlyStop = true;
    }
  }

  const start = (page - 1) * PAGE_LIMIT;
  const hasMore = hasMoreFromEarlyStop ? true : start + PAGE_LIMIT < allItems.length;
  emitProfile(options, 'upcoming.total', totalStartNs, {
    page,
    returnedCount: allItems.slice(start, start + PAGE_LIMIT).length,
    totalCount: allItems.length,
  });
  return {
    items: allItems.slice(start, start + PAGE_LIMIT),
    hasMore,
  };
}

export async function getRecentlyAired(
  calendarType: string,
  range: CalendarDateRange,
  type: ContentType,
  filters?: TraktCatalogFilters,
  clientId?: string,
  page = 1,
  options?: DiscoverOptions
): Promise<{ items: (TraktMovie | TraktShow)[]; hasMore: boolean }> {
  const totalStartNs = monotonicNowNs();
  const calendarSort = normalizeCalendarSort(filters?.traktCalendarSort, 'desc');
  const isDescending = calendarSort === 'desc';
  const requiredCount = page * PAGE_LIMIT + 1;
  const apiFilterStr = buildFilterParams(filters ?? {});
  const cacheKey = `recently:${calendarType}:${range.signature}:${calendarSort}:${type}:${clientId ?? ''}:${apiFilterStr}:${buildPostFilterCacheSignature(filters)}`;
  const rawCacheKey = `raw:recently:${calendarType}:${range.signature}:${type}:${clientId ?? ''}:${apiFilterStr}`;
  const now = Date.now();
  const ttl = getCalendarCacheTtl(range.endDate);
  const cacheLookupStartNs = monotonicNowNs();
  const cached = calendarCache.get(cacheKey);
  emitProfile(options, 'recently.cache_lookup', cacheLookupStartNs, {
    hit: Boolean(cached && now - cached.ts < ttl),
  });
  let hasMoreFromEarlyStop = false;

  let allItems: (TraktMovie | TraktShow)[] = [];
  let hasResolvedItems = false;

  // Tier 1: filtered cache (exact match including sort + post-filter params)
  if (cached && now - cached.ts < ttl) {
    allItems = cached.items;
    hasResolvedItems = true;
  }

  // Tier 2: raw cache (same API data, different sort/post-filter)
  if (!hasResolvedItems) {
    const rawCached = rawCalendarCache.get(rawCacheKey);
    if (rawCached && now - rawCached.ts < ttl) {
      let rawItems = rawCached.items;
      if (rawCached.sortDirection !== calendarSort) {
        rawItems = [...rawItems].reverse();
      }
      const postFiltered = applyCorePostFilters(rawItems, filters);
      emitProfile(options, 'recently.raw_cache_hit', monotonicNowNs(), {
        complete: rawCached.complete,
        cachedCount: rawCached.items.length,
        postFilteredCount: postFiltered.length,
      });
      allItems = postFiltered;
      evictOldest(calendarCache, MAX_CACHE_ENTRIES);
      calendarCache.set(cacheKey, { items: allItems, ts: now });
      hasResolvedItems = true;
      if (!rawCached.complete && postFiltered.length >= requiredCount) {
        hasMoreFromEarlyStop = true;
      }
    }
  }

  // Tier 3: fetch from API
  if (!hasResolvedItems) {
    const chunks = buildCalendarChunks(range.startDate, range.endDate);

    log.debug('Trakt recently aired', {
      calendarType,
      rangeStart: formatCalendarDate(range.startDate),
      rangeEnd: formatCalendarDate(range.endDate),
      sort: calendarSort,
      chunks: chunks.length,
    });

    const orderedChunks = isDescending ? [...chunks].reverse() : chunks;

    const filterParts = ['extended=full'];
    if (filters) {
      const filterStr = buildFilterParams(filters);
      if (filterStr) filterParts.push(filterStr);
    }

    let stoppedEarly = false;

    if (isMovieCalendarType(calendarType, type)) {
      const movieMap = new Map<string, TraktCalendarMovie>();

      const materializeMovies = () =>
        Array.from(movieMap.values())
          .sort((a, b) =>
            isDescending
              ? (b.released || '').localeCompare(a.released || '')
              : (a.released || '').localeCompare(b.released || '')
          )
          .map((i) => i.movie);

      for (
        let batchStart = 0;
        batchStart < orderedChunks.length;
        batchStart += CALENDAR_CHUNK_BATCH_SIZE
      ) {
        const chunkBatch = orderedChunks.slice(batchStart, batchStart + CALENDAR_CHUNK_BATCH_SIZE);
        const fetchBatchStartNs = monotonicNowNs();
        const chunkResults = await Promise.all(
          chunkBatch.map((chunk) => {
            const path = buildCalendarPath(calendarType, chunk.startDate, chunk.chunkDays, type);
            const url = `${path}?${filterParts.join('&')}`;
            return traktFetch<TraktCalendarMovie[]>(url, clientId);
          })
        );
        emitProfile(options, 'recently.batch_fetch', fetchBatchStartNs, {
          batchStart,
          batchSize: chunkBatch.length,
          rows: chunkResults.reduce((sum, rows) => sum + rows.length, 0),
          mode: 'movie',
        });

        const mergeBatchStartNs = monotonicNowNs();
        for (const entry of chunkResults.flat()) {
          const key = entry.movie.ids.imdb || String(entry.movie.ids.tmdb || entry.movie.ids.trakt);
          const existing = movieMap.get(key);
          if (
            !existing ||
            (isDescending
              ? (entry.released || '') > (existing.released || '')
              : (entry.released || '') < (existing.released || ''))
          ) {
            movieMap.set(key, entry);
          }
        }
        emitProfile(options, 'recently.batch_merge', mergeBatchStartNs, {
          batchStart,
          dedupedCount: movieMap.size,
          mode: 'movie',
        });

        const filterBatchStartNs = monotonicNowNs();
        const rawCandidateItems = materializeMovies();
        const candidateItems = applyCorePostFilters(rawCandidateItems, filters);
        emitProfile(options, 'recently.batch_filter', filterBatchStartNs, {
          batchStart,
          candidateCount: candidateItems.length,
          requiredCount,
          mode: 'movie',
        });
        const hasRemainingChunks = batchStart + CALENDAR_CHUNK_BATCH_SIZE < orderedChunks.length;

        if (candidateItems.length >= requiredCount && hasRemainingChunks) {
          allItems = candidateItems;
          hasResolvedItems = true;
          stoppedEarly = true;
          evictOldest(rawCalendarCache, MAX_RAW_CACHE_ENTRIES);
          rawCalendarCache.set(rawCacheKey, {
            items: rawCandidateItems,
            ts: now,
            sortDirection: calendarSort,
            complete: false,
          });
          break;
        }
      }

      if (!hasResolvedItems) {
        const rawItems = materializeMovies();
        allItems = applyCorePostFilters(rawItems, filters);
        hasResolvedItems = true;
        // Store in both caches (raw + filtered)
        evictOldest(rawCalendarCache, MAX_RAW_CACHE_ENTRIES);
        rawCalendarCache.set(rawCacheKey, {
          items: rawItems,
          ts: now,
          sortDirection: calendarSort,
          complete: true,
        });
        evictOldest(calendarCache, MAX_CACHE_ENTRIES);
        calendarCache.set(cacheKey, { items: allItems, ts: now });
      }
    } else {
      const showMap = new Map<string, { entry: TraktCalendarShow; maxSeason?: number }>();

      const materializeShows = () =>
        Array.from(showMap.values())
          .sort((a, b) =>
            isDescending
              ? (b.entry.first_aired || '').localeCompare(a.entry.first_aired || '')
              : (a.entry.first_aired || '').localeCompare(b.entry.first_aired || '')
          )
          .map((item) => withObservedSeasonCount(item.entry.show, item.maxSeason));

      for (
        let batchStart = 0;
        batchStart < orderedChunks.length;
        batchStart += CALENDAR_CHUNK_BATCH_SIZE
      ) {
        const chunkBatch = orderedChunks.slice(batchStart, batchStart + CALENDAR_CHUNK_BATCH_SIZE);
        const fetchBatchStartNs = monotonicNowNs();
        const chunkResults = await Promise.all(
          chunkBatch.map((chunk) => {
            const path = buildCalendarPath(calendarType, chunk.startDate, chunk.chunkDays, type);
            const url = `${path}?${filterParts.join('&')}`;
            return traktFetch<TraktCalendarShow[]>(url, clientId);
          })
        );
        emitProfile(options, 'recently.batch_fetch', fetchBatchStartNs, {
          batchStart,
          batchSize: chunkBatch.length,
          rows: chunkResults.reduce((sum, rows) => sum + rows.length, 0),
          mode: 'show',
        });

        const mergeBatchStartNs = monotonicNowNs();
        for (const entry of chunkResults.flat()) {
          const key = entry.show.ids.imdb || entry.show.ids.slug || String(entry.show.ids.trakt);
          const seasonNumber = toPositiveInteger(entry.episode?.season);
          const existing = showMap.get(key);
          if (!existing) {
            showMap.set(key, {
              entry,
              maxSeason: seasonNumber,
            });
            continue;
          }

          if (
            seasonNumber != null &&
            (existing.maxSeason == null || seasonNumber > existing.maxSeason)
          ) {
            existing.maxSeason = seasonNumber;
          }

          if (
            isDescending
              ? (entry.first_aired || '') > (existing.entry.first_aired || '')
              : (entry.first_aired || '') < (existing.entry.first_aired || '')
          ) {
            existing.entry = entry;
          }
        }
        emitProfile(options, 'recently.batch_merge', mergeBatchStartNs, {
          batchStart,
          dedupedCount: showMap.size,
          mode: 'show',
        });

        const filterBatchStartNs = monotonicNowNs();
        const rawCandidateItems = materializeShows();
        const candidateItems = applyCorePostFilters(rawCandidateItems, filters);
        emitProfile(options, 'recently.batch_filter', filterBatchStartNs, {
          batchStart,
          candidateCount: candidateItems.length,
          requiredCount,
          mode: 'show',
        });
        const hasRemainingChunks = batchStart + CALENDAR_CHUNK_BATCH_SIZE < orderedChunks.length;

        if (candidateItems.length >= requiredCount && hasRemainingChunks) {
          allItems = candidateItems;
          hasResolvedItems = true;
          stoppedEarly = true;
          evictOldest(rawCalendarCache, MAX_RAW_CACHE_ENTRIES);
          rawCalendarCache.set(rawCacheKey, {
            items: rawCandidateItems,
            ts: now,
            sortDirection: calendarSort,
            complete: false,
          });
          break;
        }
      }

      if (!hasResolvedItems) {
        const rawItems = materializeShows();
        allItems = applyCorePostFilters(rawItems, filters);
        hasResolvedItems = true;
        // Store in both caches (raw + filtered)
        evictOldest(rawCalendarCache, MAX_RAW_CACHE_ENTRIES);
        rawCalendarCache.set(rawCacheKey, {
          items: rawItems,
          ts: now,
          sortDirection: calendarSort,
          complete: true,
        });
        evictOldest(calendarCache, MAX_CACHE_ENTRIES);
        calendarCache.set(cacheKey, { items: allItems, ts: now });
      }
    }

    if (stoppedEarly) {
      hasMoreFromEarlyStop = true;
    }
  }

  const start = (page - 1) * PAGE_LIMIT;
  const hasMore = hasMoreFromEarlyStop ? true : start + PAGE_LIMIT < allItems.length;
  emitProfile(options, 'recently.total', totalStartNs, {
    page,
    returnedCount: allItems.slice(start, start + PAGE_LIMIT).length,
    totalCount: allItems.length,
  });
  return {
    items: allItems.slice(start, start + PAGE_LIMIT),
    hasMore,
  };
}

export async function searchTrakt(
  query: string,
  type: ContentType,
  page: number,
  clientId?: string
): Promise<{ items: (TraktMovie | TraktShow)[]; hasMore: boolean }> {
  const tType = type === 'movie' ? 'movie' : 'show';
  const url = `/search/${tType}?query=${encodeURIComponent(query)}&page=${page}&limit=${PAGE_LIMIT}&extended=full&fields=title`;
  log.debug('Trakt search', { query, type, page });

  const data = await traktFetch<TraktSearchResult[]>(url, clientId);
  const items: (TraktMovie | TraktShow)[] = [];
  for (const result of data) {
    if (result.movie) items.push(result.movie);
    else if (result.show) items.push(result.show);
  }
  return { items, hasMore: data.length >= PAGE_LIMIT };
}

export async function getListItems(
  listId: string,
  type: ContentType,
  page: number,
  clientId?: string
): Promise<{ items: (TraktMovie | TraktShow)[]; hasMore: boolean }> {
  const tType = traktContentType(type);
  const url = `/users/${listId}/items/${tType}?page=${page}&limit=${PAGE_LIMIT}&extended=full`;
  log.debug('Trakt list items', { listId, type, page });

  const data = await traktFetch<TraktListItem[]>(url, clientId);
  const items: (TraktMovie | TraktShow)[] = [];
  for (const entry of data) {
    if (entry.movie) items.push(entry.movie);
    else if (entry.show) items.push(entry.show);
  }
  return { items, hasMore: data.length >= PAGE_LIMIT };
}

export async function discover(
  filters: TraktCatalogFilters,
  type: ContentType,
  page: number,
  clientId?: string,
  options?: DiscoverOptions
): Promise<{ items: (TraktMovie | TraktShow)[]; hasMore: boolean }> {
  const totalStartNs = monotonicNowNs();
  const listType = normalizeTraktListType(filters.traktListType);
  const period = filters.traktPeriod || 'weekly';
  const normalizedFilters = stripUnreliableRatingFilters(listType, type, filters);
  const endpointFilters = shouldApplyFilters(listType) ? normalizedFilters : undefined;

  let result: { items: (TraktMovie | TraktShow)[]; hasMore: boolean };
  const endpointFetchStartNs = monotonicNowNs();

  switch (listType) {
    case 'trending':
      result = await getTrending(type, page, endpointFilters, clientId);
      break;
    case 'popular':
      result = await getPopular(type, page, endpointFilters, clientId);
      break;
    case 'favorited':
      result = await getFavorited(type, period, page, endpointFilters, clientId);
      break;
    case 'watched':
      result = await getWatched(type, period, page, endpointFilters, clientId);
      break;
    case 'played':
      result = await getPlayed(type, period, page, endpointFilters, clientId);
      break;
    case 'collected':
      result = await getCollected(type, period, page, endpointFilters, clientId);
      break;
    case 'anticipated':
      result = await getAnticipated(type, page, endpointFilters, clientId);
      break;
    case 'boxoffice': {
      if (type !== 'movie') {
        return { items: [], hasMore: false };
      }
      result = await getBoxOffice(clientId);
      break;
    }
    case 'calendar': {
      const calType = filters.traktCalendarType || (type === 'movie' ? 'movies' : 'shows');
      const range = resolveCalendarDateRange(filters, 'calendar', MAX_CALENDAR_RANGE_DAYS);
      result = await getUpcomingCalendar(
        calType,
        range,
        type,
        endpointFilters,
        clientId,
        page,
        options
      );
      break;
    }
    case 'recently_aired': {
      const calType = filters.traktCalendarType || (type === 'movie' ? 'movies' : 'shows');
      const range = resolveCalendarDateRange(filters, 'recently_aired', MAX_RECENTLY_AIRED_DAYS);
      result = await getRecentlyAired(
        calType,
        range,
        type,
        endpointFilters,
        clientId,
        page,
        options
      );
      break;
    }
    case 'recommended':
      result = await getRecommended(type, period, page, endpointFilters, clientId);
      break;
    case 'list': {
      const listId = filters.traktListId;
      if (!listId) return { items: [], hasMore: false };
      result = await getListItems(listId, type, page, clientId);
      break;
    }
    default:
      result = await getTrending(type, page, endpointFilters, clientId);
      break;
  }
  emitProfile(options, 'discover.endpoint_fetch', endpointFetchStartNs, {
    listType,
    type,
    page,
    hasMore: result.hasMore,
    itemsCount: result.items.length,
  });

  if (listType === 'calendar' || listType === 'recently_aired') {
    emitProfile(options, 'discover.total', totalStartNs, {
      listType,
      type,
      page,
      returnedCount: result.items.length,
    });
    return result;
  }

  const postFilterStartNs = monotonicNowNs();
  const filteredItems = applyCorePostFilters(result.items, normalizedFilters);
  emitProfile(options, 'discover.post_filter', postFilterStartNs, {
    listType,
    beforeCount: result.items.length,
    afterCount: filteredItems.length,
  });
  emitProfile(options, 'discover.total', totalStartNs, {
    listType,
    type,
    page,
    returnedCount: filteredItems.length,
  });

  return {
    ...result,
    items: filteredItems,
  };
}
