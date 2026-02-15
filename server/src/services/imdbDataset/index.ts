import { MemoryDatasetAdapter } from './MemoryDatasetAdapter.ts';
import { RedisDatasetAdapter } from './RedisDatasetAdapter.ts';
import {
  initializeDataset,
  queryDataset,
  getDatasetGenres,
  getDatasetDecades,
  isDatasetLoaded,
  getDatasetStats,
  destroyDataset,
} from './imdbDataset.ts';
import { createLogger } from '../../utils/logger.ts';
import { config } from '../../config.ts';

const log = createLogger('ImdbDataset:Factory');

export async function initImdbDataset() {
  if (config.imdbDataset.disabled) {
    log.info('IMDB dataset disabled via IMDB_DATASET_DISABLED env var');
    return;
  }

  const redisUrl = config.cache.redisUrl;
  const cacheDriver = config.cache.driver;

  let adapter;

  if ((cacheDriver === 'redis' || !cacheDriver) && redisUrl) {
    try {
      const redisAdapter = new RedisDatasetAdapter(redisUrl);
      await redisAdapter.connect();
      adapter = redisAdapter;
      log.info('Using Redis adapter for IMDB dataset');
    } catch (err: any) {
      log.warn('Redis unavailable for IMDB dataset, falling back to Memory', {
        error: err.message,
      });
      adapter = new MemoryDatasetAdapter();
    }
  } else {
    adapter = new MemoryDatasetAdapter();
    log.info('Using Memory adapter for IMDB dataset (no Redis configured)');
  }

  await initializeDataset(adapter);
}

export {
  queryDataset,
  getDatasetGenres,
  getDatasetDecades,
  isDatasetLoaded,
  getDatasetStats,
  destroyDataset,
};
