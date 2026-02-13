import { getCache } from '../cache/index.js';
import { tmdbFetch } from './client.ts';
import { createLogger } from '../../utils/logger.ts';

const log = createLogger('tmdb:lookup');

const EXTERNAL_ID_TTL = 86400 * 30;

/**
 * Get external IDs (including IMDB) for a movie or TV show
 */
export async function getExternalIds(apiKey, tmdbId, type = 'movie') {
  const mediaType = type === 'series' ? 'tv' : 'movie';
  const cacheKey = `external_ids_${mediaType}_${tmdbId}`;
  const cache = getCache();

  try {
    const cached = await cache.get(cacheKey);
    if (cached) return cached;
  } catch (e) {
    log.debug('Cache get failed', { key: cacheKey, error: e.message });
  }

  try {
    const data = await tmdbFetch(`/${mediaType}/${tmdbId}/external_ids`, apiKey);
    try {
      await cache.set(cacheKey, data, EXTERNAL_ID_TTL);
    } catch (e) {
      log.debug('Cache set failed', { key: cacheKey, error: e.message });
    }
    return data;
  } catch (error) {
    return null;
  }
}

/**
 * Enrich a list of TMDB items with their IMDb IDs.
 * Use concurrency (Promise.all) to fetch efficiently.
 * Relies on getExternalIds which handles caching.
 */
export async function enrichItemsWithImdbIds(apiKey, items, type = 'movie') {
  if (!items || !Array.isArray(items) || items.length === 0) return items;

  // Process in parallel
  // This might fire up to 20 requests at once.
  // Trusted TMDB keys usually handle this fine.
  await Promise.all(
    items.map(async (item) => {
      // If already has known ID, skip
      if (item.imdb_id) return;

      const ids = await getExternalIds(apiKey, item.id, type);
      if (ids?.imdb_id) {
        item.imdb_id = ids.imdb_id;
      }
    })
  );

  return items;
}

/**
 * Find TMDB item by IMDb ID
 */
export async function findByImdbId(apiKey, imdbId, type = 'movie', options = {}) {
  const cacheKey = `find_${imdbId}`;
  const cache = getCache();

  try {
    const cached = await cache.get(cacheKey);
    if (cached) return cached;
  } catch (e) {
    log.debug('Cache get failed', { key: cacheKey, error: e.message });
  }

  const params = { external_source: 'imdb_id' };
  if (options.language) params.language = options.language;

  try {
    const data = await tmdbFetch(`/find/${imdbId}`, apiKey, params);
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
        log.debug('Cache set failed', { key: cacheKey, error: e.message });
      }
      return found;
    }
    return null;
  } catch (error) {
    return null;
  }
}
