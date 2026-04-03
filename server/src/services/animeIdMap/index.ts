import { createLogger } from '../../utils/logger.ts';
import { getCache } from '../cache/index.ts';
import { CACHE_TTLS } from '../../constants.ts';

const log = createLogger('animeIdMap');

const ANIME_LISTS_URL =
  'https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json';
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface AnimeIdEntry {
  anilist_id?: number;
  mal_id?: number;
  thetvdb_id?: number;
  themoviedb_id?: number;
  imdb_id?: string;
  kitsu_id?: number;
  anidb_id?: number;
  simkl_id?: number;
  type?: string;
}

let byAnilistId = new Map<number, AnimeIdEntry>();
let byMalId = new Map<number, AnimeIdEntry>();
let byKitsuId = new Map<number, AnimeIdEntry>();
let byImdbId = new Map<string, AnimeIdEntry>();
let bySimklId = new Map<number, AnimeIdEntry>();
let byTmdbId = new Map<number, AnimeIdEntry>();
let initialized = false;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

function buildIndexes(entries: AnimeIdEntry[]): void {
  const newByAnilist = new Map<number, AnimeIdEntry>();
  const newByMal = new Map<number, AnimeIdEntry>();
  const newByKitsu = new Map<number, AnimeIdEntry>();
  const newByImdb = new Map<string, AnimeIdEntry>();
  const newBySimkl = new Map<number, AnimeIdEntry>();
  const newByTmdb = new Map<number, AnimeIdEntry>();

  for (const entry of entries) {
    if (entry.anilist_id) newByAnilist.set(entry.anilist_id, entry);
    if (entry.mal_id) newByMal.set(entry.mal_id, entry);
    if (entry.kitsu_id) newByKitsu.set(entry.kitsu_id, entry);
    if (entry.imdb_id) newByImdb.set(entry.imdb_id, entry);
    if (entry.simkl_id) newBySimkl.set(entry.simkl_id, entry);
    if (entry.themoviedb_id) newByTmdb.set(entry.themoviedb_id, entry);
  }

  byAnilistId = newByAnilist;
  byMalId = newByMal;
  byKitsuId = newByKitsu;
  byImdbId = newByImdb;
  bySimklId = newBySimkl;
  byTmdbId = newByTmdb;

  log.info('anime ID map indexes built', {
    total: entries.length,
    anilist: newByAnilist.size,
    mal: newByMal.size,
    kitsu: newByKitsu.size,
    imdb: newByImdb.size,
    simkl: newBySimkl.size,
    tmdb: newByTmdb.size,
  });
}

async function fetchAnimeList(): Promise<AnimeIdEntry[] | null> {
  const cache = getCache();
  const cacheKey = 'anime-id-map:full-list';

  try {
    const cached = await cache.get(cacheKey);
    if (cached) {
      log.debug('anime ID map loaded from cache');
      return cached as AnimeIdEntry[];
    }
  } catch {
    // Cache miss, proceed to fetch
  }

  try {
    log.info('fetching anime-lists from GitHub');
    const response = await fetch(ANIME_LISTS_URL, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      log.error('failed to fetch anime-lists', { status: response.status });
      return null;
    }
    const data = (await response.json()) as AnimeIdEntry[];
    log.info('anime-lists fetched', { count: data.length });

    try {
      await cache.set(cacheKey, data, CACHE_TTLS.ANIME_ID_MAP);
    } catch {
      // Cache write failure is non-fatal
    }

    return data;
  } catch (err) {
    log.error('error fetching anime-lists', { error: (err as Error).message });
    return null;
  }
}

async function loadAndBuild(): Promise<void> {
  const entries = await fetchAnimeList();
  if (entries && entries.length > 0) {
    buildIndexes(entries);
    initialized = true;
  }
}

export async function initAnimeIdMap(): Promise<void> {
  await loadAndBuild();

  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    loadAndBuild().catch((err) => {
      log.error('anime ID map refresh failed', { error: (err as Error).message });
    });
  }, REFRESH_INTERVAL_MS);
}

export function isAnimeIdMapReady(): boolean {
  return initialized;
}

function entryToStremioId(entry: AnimeIdEntry | undefined): string | null {
  if (!entry) return null;
  if (entry.imdb_id) return entry.imdb_id;
  if (entry.kitsu_id) return `kitsu:${entry.kitsu_id}`;
  return null;
}

export function anilistIdToStremioId(anilistId: number): string | null {
  return entryToStremioId(byAnilistId.get(anilistId));
}

export function malIdToStremioId(malId: number): string | null {
  return entryToStremioId(byMalId.get(malId));
}

export function simklIdToStremioId(simklId: number): string | null {
  return entryToStremioId(bySimklId.get(simklId));
}

export function kitsuIdToStremioId(kitsuId: number): string | null {
  return entryToStremioId(byKitsuId.get(kitsuId));
}

export function getEntryByAnilistId(id: number): AnimeIdEntry | undefined {
  return byAnilistId.get(id);
}

export function getEntryByMalId(id: number): AnimeIdEntry | undefined {
  return byMalId.get(id);
}

export function getEntryBySimklId(id: number): AnimeIdEntry | undefined {
  return bySimklId.get(id);
}

export function getEntryByImdbId(id: string): AnimeIdEntry | undefined {
  return byImdbId.get(id);
}

export function getEntryByTmdbId(id: number): AnimeIdEntry | undefined {
  return byTmdbId.get(id);
}

export function getMapStats(): { initialized: boolean; sizes: Record<string, number> } {
  return {
    initialized,
    sizes: {
      anilist: byAnilistId.size,
      mal: byMalId.size,
      kitsu: byKitsuId.size,
      imdb: byImdbId.size,
      simkl: bySimklId.size,
      tmdb: byTmdbId.size,
    },
  };
}
