import { MemoryAdapter } from './MemoryAdapter.ts';
import { RedisAdapter } from './RedisAdapter.ts';
import {
  initializeRatings,
  getImdbRating,
  getImdbRatingString,
  batchGetImdbRatings,
  forceUpdate,
  isLoaded,
  getStats,
  destroyRatings,
} from './imdbRatings.ts';
import { createLogger } from '../../utils/logger.ts';
import { config } from '../../config.ts';
import type { IImdbRatingsAdapter } from '../../types/index.ts';

const log = createLogger('ImdbRatings:Factory');

export async function initImdbRatings(): Promise<void> {
  if (config.imdbRatings.disabled) {
    log.info('IMDb ratings disabled via IMDB_RATINGS_DISABLED env var');
    return;
  }

  const redisUrl = config.cache.redisUrl;
  const cacheDriver = config.cache.driver;

  let adapter: IImdbRatingsAdapter;

  if ((cacheDriver === 'redis' || !cacheDriver) && redisUrl) {
    try {
      const redisAdapter = new RedisAdapter(redisUrl);
      await redisAdapter.connect();
      adapter = redisAdapter;
      log.info('Using Redis adapter for IMDb ratings');
    } catch (err) {
      log.warn('Redis unavailable for IMDb ratings, falling back to Memory', {
        error: (err as Error).message,
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
