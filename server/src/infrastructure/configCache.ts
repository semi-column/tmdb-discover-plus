import { createLogger } from '../utils/logger.ts';

const log = createLogger('ConfigCache');

/**
 * In-memory LRU config cache with stampede protection.
 *
 * - LRU eviction when maxSize is exceeded
 * - TTL-based expiration
 * - Promise coalescing for concurrent requests (stampede protection)
 * - Invalidation on save/update/delete
 */
export class ConfigCache {
  private maxSize: number;
  private ttlMs: number;
  private cache: Map<string, { value: unknown; timestamp: number }>;
  private pendingLoads: Map<string, Promise<unknown>>;
  private stats: { hits: number; misses: number; evictions: number; coalesced: number };

  constructor(options: { maxSize?: number; ttlMs?: number } = {}) {
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
  async getOrLoad(key: string, loader: () => Promise<unknown>): Promise<unknown> {
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
  set(key: string, value: unknown): void {
    this._put(key, value);
  }

  /**
   * Invalidate a cache entry (e.g., after update/delete).
   */
  invalidate(key: string): void {
    this.cache.delete(key);
    log.debug('Config cache invalidated', { key });
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    this.cache.clear();
    this.pendingLoads.clear();
    log.debug('Config cache cleared');
  }

  /**
   * @private
   */
  _put(key: string, value: unknown): void {
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const oldestKey = this.cache.keys().next().value!;
      this.cache.delete(oldestKey);
      this.stats.evictions++;
    }

    this.cache.delete(key);
    this.cache.set(key, {
      value,
      timestamp: Date.now(),
    });
  }

  /**
   * Stats for the /health endpoint.
   */
  getStats(): {
    size: number;
    maxSize: number;
    pendingLoads: number;
    hits: number;
    misses: number;
    evictions: number;
    coalesced: number;
  } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      pendingLoads: this.pendingLoads.size,
      ...this.stats,
    };
  }
}

// Singleton instance
let instance: ConfigCache | null = null;

export function getConfigCache(): ConfigCache {
  if (!instance) {
    instance = new ConfigCache();
  }
  return instance;
}
