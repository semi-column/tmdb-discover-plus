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
import { resolveRedisOrMemory } from '../../utils/resolveRedisOrMemory.ts';
import { config } from '../../config.ts';
import type { IImdbRatingsAdapter } from '../../types/index.ts';

const log = createLogger('ImdbRatings:Factory');

export async function initImdbRatings(): Promise<void> {
  if (config.imdbRatings.disabled) {
    log.info('IMDb ratings disabled via IMDB_RATINGS_DISABLED env var');
    return;
  }

  const { adapter } = await resolveRedisOrMemory<IImdbRatingsAdapter>({
    redisUrl: config.cache.redisUrl,
    driver: config.cache.driver,
    createRedis: async (url) => {
      const redisAdapter = new RedisAdapter(url);
      await redisAdapter.connect();
      return redisAdapter;
    },
    createMemory: () => new MemoryAdapter(),
    logLabel: 'ImdbRatings:Factory',
  });

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
