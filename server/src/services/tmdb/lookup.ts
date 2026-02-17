import { getCache } from '../cache/index.ts';
import { tmdbFetch } from './client.ts';
import { createLogger } from '../../utils/logger.ts';
import type { TmdbExternalIds, TmdbFindResponse, TmdbResult } from '../../types/index.ts';

const log = createLogger('tmdb:lookup');

const EXTERNAL_ID_TTL = 86400 * 30;

export async function getExternalIds(
  apiKey: string,
  tmdbId: number | string,
  type: string = 'movie'
): Promise<TmdbExternalIds | null> {
  const mediaType = type === 'series' ? 'tv' : 'movie';
  const cacheKey = `external_ids_${mediaType}_${tmdbId}`;
  const cache = getCache();

  try {
    const cached = (await cache.get(cacheKey)) as TmdbExternalIds | null;
    if (cached) return cached;
  } catch (e) {
    log.debug('Cache get failed', { key: cacheKey, error: (e as Error).message });
  }

  try {
    const data = (await tmdbFetch(
      `/${mediaType}/${tmdbId}/external_ids`,
      apiKey
    )) as TmdbExternalIds;
    try {
      await cache.set(cacheKey, data, EXTERNAL_ID_TTL);
    } catch (e) {
      log.debug('Cache set failed', { key: cacheKey, error: (e as Error).message });
    }
    return data;
  } catch {
    return null;
  }
}

const ENRICHMENT_CONCURRENCY = 5;

export async function enrichItemsWithImdbIds(
  apiKey: string,
  items: TmdbResult[],
  type: string = 'movie'
): Promise<TmdbResult[]> {
  if (!items || !Array.isArray(items) || items.length === 0) return items;

  for (let i = 0; i < items.length; i += ENRICHMENT_CONCURRENCY) {
    const batch = items.slice(i, i + ENRICHMENT_CONCURRENCY);
    await Promise.all(
      batch.map(async (item) => {
        if (item.imdb_id) return;
        const ids = await getExternalIds(apiKey, item.id, type);
        if (ids?.imdb_id) {
          item.imdb_id = ids.imdb_id;
        }
      })
    );
  }

  return items;
}

export async function findByImdbId(
  apiKey: string,
  imdbId: string,
  type: string = 'movie',
  options: { language?: string } = {}
): Promise<{ tmdbId: number } | null> {
  const cacheKey = `find_${imdbId}`;
  const cache = getCache();

  try {
    const cached = (await cache.get(cacheKey)) as { tmdbId: number } | null;
    if (cached) return cached;
  } catch (e) {
    log.debug('Cache get failed', { key: cacheKey, error: (e as Error).message });
  }

  const params: Record<string, string> = { external_source: 'imdb_id' };
  if (options.language) params.language = options.language;

  try {
    const data = (await tmdbFetch(`/find/${imdbId}`, apiKey, params)) as TmdbFindResponse;
    let result = null;

    if (type === 'movie' && data.movie_results?.length > 0) {
      result = data.movie_results[0];
    } else if ((type === 'series' || type === 'tv') && data.tv_results?.length > 0) {
      result = data.tv_results[0];
    }

    if (result) {
      const found = { tmdbId: result.id };
      try {
        await cache.set(cacheKey, found, EXTERNAL_ID_TTL);
      } catch (e) {
        log.debug('Cache set failed', { key: cacheKey, error: (e as Error).message });
      }
      return found;
    }
    return null;
  } catch {
    return null;
  }
}
