import { RedisAdapter } from './RedisAdapter.js';
import { MemoryAdapter } from './MemoryAdapter.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('CacheFactory');

let cacheInstance = null;

export async function initCache() {
  if (cacheInstance) return cacheInstance;

  const redisUrl = process.env.REDIS_URL;
  const driver = process.env.CACHE_DRIVER; // 'redis', 'memory'

  if (driver === 'redis' && redisUrl) {
      log.info('Initializing Redis Adapter (Explicit)');
      const adapter = new RedisAdapter(redisUrl);
      await adapter.connect();
      cacheInstance = adapter;
  } else if (driver === 'memory') {
      log.info('Initializing Memory Adapter (Explicit)');
      cacheInstance = new MemoryAdapter();
  } else if (redisUrl) {
      log.info('Initializing Redis Adapter (Auto-detected)');
      const adapter = new RedisAdapter(redisUrl);
      await adapter.connect();
      cacheInstance = adapter;
  } else {
    log.info('Initializing Memory Adapter (Default)');
    cacheInstance = new MemoryAdapter();
  }

  return cacheInstance;
}

export function getCache() {
  if (!cacheInstance) {
    // If not explicitly initialized, fallback to memory (safe default)
    cacheInstance = new MemoryAdapter();
  }
  return cacheInstance;
}
