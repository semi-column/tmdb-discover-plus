import {
  TRAKT_LIST_TYPES,
  TRAKT_PERIODS,
  TRAKT_CALENDAR_TYPES,
  TRAKT_SHOW_STATUSES,
  TRAKT_GENRES,
  TRAKT_CERTIFICATIONS_MOVIES,
  TRAKT_CERTIFICATIONS_SHOWS,
  TRAKT_COMMUNITY_METRICS,
} from './types.ts';
import type { TraktGenre, TraktNetwork } from './types.ts';
import { traktFetch } from './client.ts';
import { createLogger } from '../../utils/logger.ts';
import { LOCAL_CACHE_TTLS } from '../../cacheTtls.ts';

const log = createLogger('trakt:reference');

type TraktGenresByType = {
  movie: TraktGenre[];
  series: TraktGenre[];
};

const SHOW_ONLY_GENRE_SLUGS = new Set([
  'game-show',
  'home-and-garden',
  'mini-series',
  'news',
  'reality',
  'soap',
  'special-interest',
  'talk-show',
]);

function splitStaticGenresByType(): TraktGenresByType {
  const movie = TRAKT_GENRES.filter((genre) => !SHOW_ONLY_GENRE_SLUGS.has(genre.slug));
  const series = TRAKT_GENRES.filter((genre) => genre.slug !== 'short');
  return { movie, series };
}

let genresCache: { data: TraktGenresByType; fetchedAt: number; isRemote: boolean } | null = null;
const GENRES_TTL_MS = LOCAL_CACHE_TTLS.TRAKT_REFERENCE;

function normalizeGenreArray(raw: unknown): TraktGenre[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const name = (item as { name?: unknown }).name;
      const slug = (item as { slug?: unknown }).slug;
      if (typeof name !== 'string' || typeof slug !== 'string') return null;
      return { name, slug };
    })
    .filter((item): item is TraktGenre => item != null);
}

export function getGenres(): TraktGenre[] {
  return TRAKT_GENRES;
}

export async function getGenresByType(clientId?: string): Promise<TraktGenresByType> {
  if (
    genresCache &&
    Date.now() - genresCache.fetchedAt < GENRES_TTL_MS &&
    (genresCache.isRemote || !clientId)
  ) {
    return genresCache.data;
  }

  if (!clientId) {
    const fallback = splitStaticGenresByType();
    genresCache = { data: fallback, fetchedAt: Date.now(), isRemote: false };
    return fallback;
  }

  try {
    const [movieRaw, showRaw] = await Promise.all([
      traktFetch<unknown>('/genres/movies', clientId),
      traktFetch<unknown>('/genres/shows', clientId),
    ]);

    const movie = normalizeGenreArray(movieRaw);
    const series = normalizeGenreArray(showRaw);

    if (movie.length > 0 || series.length > 0) {
      const data = {
        movie: movie.length > 0 ? movie : splitStaticGenresByType().movie,
        series: series.length > 0 ? series : splitStaticGenresByType().series,
      };
      genresCache = { data, fetchedAt: Date.now(), isRemote: true };
      return data;
    }
  } catch (err) {
    log.warn('Failed to fetch Trakt genres by type', { error: (err as Error).message });
  }

  const fallback = splitStaticGenresByType();
  genresCache = { data: fallback, fetchedAt: Date.now(), isRemote: false };
  return fallback;
}

export function getListTypes(): readonly { value: string; label: string; group: string }[] {
  return TRAKT_LIST_TYPES;
}

export function getPeriods(): readonly { value: string; label: string }[] {
  return TRAKT_PERIODS;
}

export function getCalendarTypes(): readonly { value: string; label: string }[] {
  return TRAKT_CALENDAR_TYPES;
}

export function getShowStatuses(): readonly { value: string; label: string }[] {
  return TRAKT_SHOW_STATUSES;
}

export function getCertifications(type: string): readonly { value: string; label: string }[] {
  return type === 'movie' ? TRAKT_CERTIFICATIONS_MOVIES : TRAKT_CERTIFICATIONS_SHOWS;
}

export function getCommunityMetrics(): readonly { value: string; label: string }[] {
  return TRAKT_COMMUNITY_METRICS;
}

// ─── Networks (dynamic, cached) ──────────────────────────
let networksCache: { data: TraktNetwork[]; fetchedAt: number } | null = null;
const NETWORKS_TTL_MS = LOCAL_CACHE_TTLS.TRAKT_REFERENCE;

export async function getNetworks(clientId?: string): Promise<TraktNetwork[]> {
  if (networksCache && Date.now() - networksCache.fetchedAt < NETWORKS_TTL_MS) {
    return networksCache.data;
  }
  try {
    const data = await traktFetch<TraktNetwork[]>('/networks', clientId);
    networksCache = { data, fetchedAt: Date.now() };
    return data;
  } catch (err) {
    log.warn('Failed to fetch Trakt networks', { error: (err as Error).message });
    if (networksCache) return networksCache.data; // stale-while-error
    return [];
  }
}

export function resetReferenceCachesForTests(): void {
  genresCache = null;
  networksCache = null;
}
