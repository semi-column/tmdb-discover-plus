/**
 * IMDb Ratings Service — Factory & Public API
 *
 * Auto-selects the storage backend:
 *  - Redis Hash  → when REDIS_URL is set (persistent, shared across restarts)
 *  - In-Memory Map → otherwise (BeamUp / Dokku — re-downloads on boot)
 *
 * Usage:
 *   import { initImdbRatings, getImdbRating, batchGetImdbRatings, getImdbRatingsStats } from './imdbRatings/index.js';
 *
 *   // During server startup (non-blocking, fire-and-forget):
 *   await initImdbRatings();
 *
 *   // Single lookup:
 *   const rating = await getImdbRating('tt0133093'); // { rating: 8.7, votes: 1234567 }
 *
 *   // Batch lookup for catalog items:
 *   const map = await batchGetImdbRatings(items, type); // Map<imdbId, "8.7">
 */

import { MemoryAdapter } from './MemoryAdapter.js';
import { RedisAdapter } from './RedisAdapter.js';
import {
  initializeRatings,
  getImdbRating,
  getImdbRatingString,
  batchGetImdbRatings,
  forceUpdate,
  isLoaded,
  getStats,
  destroyRatings,
} from './imdbRatings.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('ImdbRatings:Factory');

/**
 * Initialize the IMDb ratings service.
 * Call once during server startup. Safe to fire-and-forget (logs errors internally).
 *
 * @returns {Promise<void>}
 */
export async function initImdbRatings() {
  // Feature kill-switch
  if (process.env.IMDB_RATINGS_DISABLED === 'true') {
    log.info('IMDb ratings disabled via IMDB_RATINGS_DISABLED env var');
    return;
  }

  const redisUrl = process.env.REDIS_URL;
  const cacheDriver = process.env.CACHE_DRIVER;

  let adapter;

  // Use Redis when explicitly configured or auto-detected
  if ((cacheDriver === 'redis' || !cacheDriver) && redisUrl) {
    try {
      const redisAdapter = new RedisAdapter(redisUrl);
      await redisAdapter.connect();
      adapter = redisAdapter;
      log.info('Using Redis adapter for IMDb ratings');
    } catch (err) {
      log.warn('Redis unavailable for IMDb ratings, falling back to Memory', {
        error: err.message,
      });
      adapter = new MemoryAdapter();
    }
  } else {
    adapter = new MemoryAdapter();
    log.info('Using Memory adapter for IMDb ratings (no Redis configured)');
  }

  await initializeRatings(adapter);
}

// Re-export public API for consumers
export {
  getImdbRating,
  getImdbRatingString,
  batchGetImdbRatings,
  forceUpdate as forceUpdateImdbRatings,
  isLoaded as isImdbRatingsLoaded,
  getStats as getImdbRatingsStats,
  destroyRatings as destroyImdbRatings,
};
