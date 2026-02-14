import { RedisAdapter } from './RedisAdapter.js';
import { MemoryAdapter } from './MemoryAdapter.js';
import { CacheWrapper } from './CacheWrapper.js';
import { createLogger } from '../../utils/logger.ts';
import { config } from '../../config.ts';
import { ADDON_VERSION } from '../../version.ts';

const log = createLogger('CacheFactory');

function getCacheVersion() {
  if (config.cache.versionOverride) return config.cache.versionOverride;
  const major = ADDON_VERSION.split('.')[0];
  return major || ADDON_VERSION;
}

/** @type {CacheWrapper|null} */
let cacheInstance = null;

/** @type {string} Which driver is active */
let activeDriver = 'none';

/** @type {boolean} Whether cache init degraded (e.g., Redis failed → Memory fallback) */
let degraded = false;

export async function initCache() {
  if (cacheInstance) return cacheInstance;

  const redisUrl = config.cache.redisUrl;
  const driver = config.cache.driver;

  let adapter = null;

  if (driver === 'redis' && redisUrl) {
    try {
      log.info('Initializing Redis Adapter (Explicit)');
      adapter = new RedisAdapter(redisUrl);
      await adapter.connect();
      activeDriver = 'redis';
    } catch (err) {
      log.warn('Redis init failed, falling back to Memory Adapter', { error: err.message });
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
      adapter = new RedisAdapter(redisUrl);
      await adapter.connect();
      activeDriver = 'redis';
    } catch (err) {
      log.warn('Redis auto-detect failed, falling back to Memory Adapter', { error: err.message });
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

/**
 * @returns {CacheWrapper}
 */
export function getCache() {
  if (!cacheInstance) {
    cacheInstance = new CacheWrapper(new MemoryAdapter(), { version: getCacheVersion() });
    activeDriver = 'memory';
  }
  return cacheInstance;
}

/**
 * Return cache status info for the /health endpoint.
 */
export function getCacheStatus() {
  const stats = cacheInstance ? cacheInstance.getStats() : {};
  return {
    driver: activeDriver,
    degraded,
    ...stats,
  };
}
