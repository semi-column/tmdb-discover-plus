import { RedisAdapter } from './RedisAdapter.ts';
import { MemoryAdapter } from './MemoryAdapter.ts';
import { CacheWrapper } from './CacheWrapper.ts';
import { createLogger } from '../../utils/logger.ts';
import { resolveRedisOrMemory } from '../../utils/resolveRedisOrMemory.ts';
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

  const resolved = await resolveRedisOrMemory<ICacheAdapter>({
    redisUrl: config.cache.redisUrl,
    driver: config.cache.driver,
    createRedis: async (url) => {
      const redis = new RedisAdapter(url);
      await redis.connect();
      return redis;
    },
    createMemory: () => new MemoryAdapter(),
    logLabel: 'CacheFactory',
  });
  activeDriver = resolved.driver;
  degraded = resolved.degraded;

  cacheInstance = new CacheWrapper(resolved.adapter, { version: getCacheVersion() });
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
