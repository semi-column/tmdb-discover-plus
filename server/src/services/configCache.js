import { createLogger } from '../utils/logger.js';

const log = createLogger('ConfigCache');

/**
 * In-memory LRU config cache with stampede protection.
 * Inspired by AIOMetadata's configCache.js.
 *
 * - LRU eviction when maxSize is exceeded
 * - TTL-based expiration
 * - Promise coalescing for concurrent requests (stampede protection)
 * - Invalidation on save/update/delete
 */
export class ConfigCache {
  /**
   * @param {object} options
   * @param {number} [options.maxSize=1000] - Maximum number of entries
   * @param {number} [options.ttlMs=300000] - TTL in milliseconds (default: 5 minutes)
   */
  constructor(options = {}) {
    this.maxSize = options.maxSize || 1000;
    this.ttlMs = options.ttlMs || 5 * 60 * 1000;

    /** @type {Map<string, {value: any, timestamp: number}>} */
    this.cache = new Map();

    /** @type {Map<string, Promise<any>>} Pending loads for stampede protection */
    this.pendingLoads = new Map();

    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      coalesced: 0,
    };
  }

  /**
   * Get a config from cache, or load it via the loader function.
   * Concurrent requests for the same key share a single loader call.
   *
   * @param {string} key - Cache key (e.g., userId)
   * @param {Function} loader - Async function to load the value on cache miss
   * @returns {Promise<any>}
   */
  async getOrLoad(key, loader) {
    // Check cache first
    const entry = this.cache.get(key);
    if (entry) {
      const age = Date.now() - entry.timestamp;
      if (age < this.ttlMs) {
        this.stats.hits++;
        // Move to end for LRU (Map preserves insertion order)
        this.cache.delete(key);
        this.cache.set(key, entry);
        return entry.value;
      }
      // Expired
      this.cache.delete(key);
    }

    this.stats.misses++;

    // Stampede protection: if a load is already in progress, reuse it
    if (this.pendingLoads.has(key)) {
      this.stats.coalesced++;
      return this.pendingLoads.get(key);
    }

    // Start a new load
    const loadPromise = loader()
      .then((value) => {
        this._put(key, value);
        return value;
      })
      .finally(() => {
        this.pendingLoads.delete(key);
      });

    this.pendingLoads.set(key, loadPromise);
    return loadPromise;
  }

  /**
   * Directly set a value in the cache (e.g., after a save).
   */
  set(key, value) {
    this._put(key, value);
  }

  /**
   * Invalidate a cache entry (e.g., after update/delete).
   */
  invalidate(key) {
    this.cache.delete(key);
    log.debug('Config cache invalidated', { key });
  }

  /**
   * Clear all entries.
   */
  clear() {
    this.cache.clear();
    this.pendingLoads.clear();
    log.debug('Config cache cleared');
  }

  /**
   * @private
   */
  _put(key, value) {
    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
      this.stats.evictions++;
    }

    this.cache.set(key, {
      value,
      timestamp: Date.now(),
    });
  }

  /**
   * Stats for the /health endpoint.
   */
  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      pendingLoads: this.pendingLoads.size,
      ...this.stats,
    };
  }
}

// Singleton instance
let instance = null;

export function getConfigCache() {
  if (!instance) {
    instance = new ConfigCache();
  }
  return instance;
}
