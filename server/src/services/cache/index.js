import { RedisAdapter } from './RedisAdapter.js';
import { MemoryAdapter } from './MemoryAdapter.js';
import { CacheWrapper } from './CacheWrapper.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('CacheFactory');

/** @type {CacheWrapper|null} */
let cacheInstance = null;

/** @type {string} Which driver is active */
let activeDriver = 'none';

/** @type {boolean} Whether cache init degraded (e.g., Redis failed → Memory fallback) */
let degraded = false;

export async function initCache() {
  if (cacheInstance) return cacheInstance;

  const redisUrl = process.env.REDIS_URL;
  const driver = process.env.CACHE_DRIVER; // 'redis', 'memory'

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

  // Wrap the raw adapter with resilience features
  cacheInstance = new CacheWrapper(adapter);
  log.info('Cache initialized with CacheWrapper', { driver: activeDriver, degraded });

  return cacheInstance;
}

/**
 * @returns {CacheWrapper}
 */
export function getCache() {
  if (!cacheInstance) {
    // If not explicitly initialized, fallback to memory (safe default)
    cacheInstance = new CacheWrapper(new MemoryAdapter());
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
