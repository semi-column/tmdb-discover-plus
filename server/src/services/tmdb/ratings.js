import fetch from 'node-fetch';
import { getCache } from '../cache/index.js';
import { createLogger } from '../../utils/logger.js';
import { assertAllowedUrl } from './client.js';
import { httpsAgent, CINEMETA_API_ORIGIN, CINEMETA_API_BASE_PATH } from './constants.js';

const log = createLogger('tmdb:ratings');

/**
 * Fetch Cinemeta rating for a single IMDb ID.
 * Internal — use batchGetCinemetaRatings for bulk operations.
 */
export async function getCinemetaRating(imdbId, type) {
  if (!imdbId) return null;
  const normalizedId = String(imdbId || '').trim();
  if (!/^tt\d{7,10}$/.test(normalizedId)) return null;

  const mediaType = type === 'series' ? 'series' : 'movie';
  const cache = getCache();
  const cacheKey = `cinemeta_rating_${normalizedId}`;

  try {
    const result = await cache.wrap(
      cacheKey,
      async () => {
        const url = new URL(CINEMETA_API_ORIGIN);
        url.pathname = `${CINEMETA_API_BASE_PATH}/${mediaType}/${normalizedId}.json`;
        assertAllowedUrl(url, {
          origin: CINEMETA_API_ORIGIN,
          pathPrefix: `${CINEMETA_API_BASE_PATH}/`,
        });

        const response = await fetch(url.toString(), {
          agent: httpsAgent,
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) {
          const err = new Error(`Cinemeta HTTP ${response.status}`);
          err.status = response.status;
          throw err;
        }
        const data = await response.json();
        const rating = data?.meta?.imdbRating || null;

        if (!rating) {
          // Throw so cache.wrap() applies EMPTY_RESULT TTL (1 min) instead of
          // caching null for 7 days. Title may get a rating later.
          const err = new Error('No rating in Cinemeta response');
          err.status = 404;
          throw err;
        }

        log.info('Cinemeta rating fetched', { imdbId: normalizedId, rating });
        return rating;
      },
      604800, // 7 days — IMDb ratings rarely change
      { allowStale: true }
    );

    return result;
  } catch (error) {
    // CachedError or fresh fetch error — either way, no rating available
    if (error.name !== 'CachedError') {
      log.warn('Cinemeta rating unavailable', { imdbId: normalizedId, error: error.message });
    }
    return null;
  }
}

/**
 * Batch-fetch Cinemeta ratings for a list of items.
 * Returns a Map of imdbId → rating string.
 * Non-blocking: individual failures are silently skipped.
 */
export async function batchGetCinemetaRatings(items, type) {
  const ratingsMap = new Map();
  const imdbIds = items
    .map((item) => item.imdb_id)
    .filter((id) => id && /^tt\d{7,10}$/.test(id));

  if (imdbIds.length === 0) return ratingsMap;

  // Deduplicate
  const unique = [...new Set(imdbIds)];

  const results = await Promise.allSettled(
    unique.map(async (imdbId) => {
      const rating = await getCinemetaRating(imdbId, type);
      return { imdbId, rating };
    })
  );

  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.rating) {
      ratingsMap.set(r.value.imdbId, r.value.rating);
    }
  }

  return ratingsMap;
}
