import { RedisAdapter } from './RedisAdapter.ts';
import { MemoryAdapter } from './MemoryAdapter.ts';
import { CacheWrapper } from './CacheWrapper.ts';
import { createLogger } from '../../utils/logger.ts';
import { config } from '../../config.ts';
import { ADDON_VERSION } from '../../version.ts';
import type { ICacheAdapter } from '../../types/index.ts';

const log = createLogger('CacheFactory');

function getCacheVersion(): string {
  if (config.cache.versionOverride) return config.cache.versionOverride;
  const major = ADDON_VERSION.split('.')[0];
  return major || ADDON_VERSION;
}
let cacheInstance: CacheWrapper | null = null;
let activeDriver = 'none';
let degraded = false;

export async function initCache(): Promise<CacheWrapper> {
  if (cacheInstance) return cacheInstance;

  const redisUrl = config.cache.redisUrl;
  const driver = config.cache.driver;

  let adapter: ICacheAdapter | null = null;

  if (driver === 'redis' && redisUrl) {
    try {
      log.info('Initializing Redis Adapter (Explicit)');
      const redis = new RedisAdapter(redisUrl);
      await redis.connect();
      adapter = redis;
      activeDriver = 'redis';
    } catch (err) {
      log.warn('Redis init failed, falling back to Memory Adapter', {
        error: (err as Error).message,
      });
      adapter = new MemoryAdapter();
      activeDriver = 'memory';
      degraded = true;
    }
  } else if (driver === 'memory') {
    log.info('Initializing Memory Adapter (Explicit)');
    adapter = new MemoryAdapter();
    activeDriver = 'memory';
  } else if (redisUrl) {
    try {
      log.info('Initializing Redis Adapter (Auto-detected)');
      const redis = new RedisAdapter(redisUrl);
      await redis.connect();
      adapter = redis;
      activeDriver = 'redis';
    } catch (err) {
      log.warn('Redis auto-detect failed, falling back to Memory Adapter', {
        error: (err as Error).message,
      });
      adapter = new MemoryAdapter();
      activeDriver = 'memory';
      degraded = true;
    }
  } else {
    log.info('Initializing Memory Adapter (Default)');
    adapter = new MemoryAdapter();
    activeDriver = 'memory';
  }

  cacheInstance = new CacheWrapper(adapter, { version: getCacheVersion() });
  log.info('Cache initialized with CacheWrapper', {
    driver: activeDriver,
    degraded,
    version: getCacheVersion(),
  });

  return cacheInstance;
}
export function getCache(): CacheWrapper {
  if (!cacheInstance) {
    cacheInstance = new CacheWrapper(new MemoryAdapter(), { version: getCacheVersion() });
    activeDriver = 'memory';
  }
  return cacheInstance;
}
export function getCacheStatus(): Record<string, unknown> {
  const stats = cacheInstance ? cacheInstance.getStats() : {};
  return {
    driver: activeDriver,
    degraded,
    ...stats,
  };
}
