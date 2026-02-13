import { createLogger } from '../../utils/logger.ts';
import crypto from 'crypto';

const log = createLogger('CacheWrapper');

/**
 * Error-type-specific TTLs (in seconds)
 * Prevents thundering herd on failed resources and protects API quota.
 */
const ERROR_TTLS = {
  EMPTY_RESULT: 60,        // 1 minute — might have data soon
  RATE_LIMITED: 900,       // 15 minutes — back off significantly
  TEMPORARY_ERROR: 120,    // 2 minutes — 5xx, network errors
  PERMANENT_ERROR: 1800,   // 30 minutes — 4xx (except 404/429)
  NOT_FOUND: 3600,         // 1 hour — resource doesn't exist
  CACHE_CORRUPTED: 60,     // 1 minute — retry quickly after cleanup
};

/**
 * Classifies an error into a cache error type.
 * @param {Error} error
 * @param {number} [statusCode]
 * @returns {string} error type key
 */
export function classifyError(error, statusCode) {
  const msg = error?.message || '';

  if (statusCode === 429 || msg.includes('429') || msg.toLowerCase().includes('rate limit')) {
    return 'RATE_LIMITED';
  }
  if (statusCode === 404 || msg.includes('404') || msg.toLowerCase().includes('not found')) {
    return 'NOT_FOUND';
  }
  if (statusCode >= 500 || msg.includes('5')) {
    // Be more specific — check for 5xx patterns
    if (/\b5\d{2}\b/.test(msg)) return 'TEMPORARY_ERROR';
  }
  if (
    error?.code === 'ECONNREFUSED' ||
    error?.code === 'ECONNRESET' ||
    error?.code === 'ETIMEDOUT' ||
    error?.name === 'FetchError' ||
    msg.includes('retryable error')
  ) {
    return 'TEMPORARY_ERROR';
  }
  if (statusCode >= 400 && statusCode < 500) {
    return 'PERMANENT_ERROR';
  }

  return 'TEMPORARY_ERROR'; // default
}

export function classifyResult(data) {
  if (data === null || data === undefined) return 'EMPTY_RESULT';
  if (Array.isArray(data) && data.length === 0) return 'EMPTY_RESULT';
  if (typeof data === 'object' && !Array.isArray(data)) {
    if (Array.isArray(data.results) && data.results.length === 0) return 'EMPTY_RESULT';
  }
  return null;
}

/**
 * CacheWrapper adds resilience features on top of a raw cache adapter:
 *
 * 1. Error-aware TTLs — caches failed lookups with type-specific TTLs
 * 2. Request deduplication — coalesces concurrent requests for the same key
 * 3. Self-healing — detects and removes corrupted cache entries
 * 4. Stale-while-revalidate — serves stale data while refreshing in background
 * 5. Health stats — tracks hits, misses, errors, corrupted entries
 */
export class CacheWrapper {
  constructor(adapter, options = {}) {
    this.adapter = adapter;
    this.keyPrefix = options.version ? `v${options.version}:` : '';
    this.inFlight = new Map();
    this.stats = {
      hits: 0,
      misses: 0,
      errors: 0,
      cachedErrors: 0,
      corruptedEntries: 0,
      deduplicatedRequests: 0,
      staleServed: 0,
    };
  }

  _prefixKey(key) {
    return this.keyPrefix + key;
  }

  /**
   * Get a value from cache with self-healing.
   * Returns { value, isStale, isCachedError } or null.
   */
  /**
   * Get a value from cache (unwrapped).
   * returns the actual data, or null if miss/error.
   */
  async get(key) {
    const entry = await this.getEntry(key);

    if (entry && typeof entry === 'object' && entry.__cacheWrapper) {
      if (entry.__errorType) return null;
      return entry.data;
    }

    return entry;
  }

  async getEntry(key) {
    const storageKey = this._prefixKey(key);
    try {
      const raw = await this.adapter.get(storageKey);
      if (raw === null || raw === undefined) {
        this.stats.misses++;
        return null;
      }

      if (raw && typeof raw === 'object' && raw.__cacheWrapper) {
        if (typeof raw.__storedAt !== 'number' || typeof raw.__ttl !== 'number') {
          this.stats.corruptedEntries++;
          log.warn('Malformed cache wrapper entry, cleaning up', { key: storageKey });
          await this.adapter.del(storageKey).catch(() => {});
          await this.adapter.set(storageKey, { __cacheWrapper: true, __errorType: 'CACHE_CORRUPTED', __errorMessage: 'malformed entry', __storedAt: Date.now(), __ttl: ERROR_TTLS.CACHE_CORRUPTED, data: null }, ERROR_TTLS.CACHE_CORRUPTED).catch(() => {});
          return null;
        }

        if (raw.__errorType) {
          this.stats.cachedErrors++;
          return raw;
        }

        if (raw.__storedAt && raw.__ttl) {
          const age = (Date.now() - raw.__storedAt) / 1000;
          if (age > raw.__ttl) {
            if (age < raw.__ttl * 2) {
              this.stats.staleServed++;
              return { ...raw, __isStale: true };
            }
            this.stats.misses++;
            return null;
          }
        }

        this.stats.hits++;
        return raw;
      }

      this.stats.hits++;
      return raw;
    } catch (err) {
      this.stats.errors++;
      if (
        err.message?.includes('JSON') ||
        err.message?.includes('parse') ||
        err.message?.includes('Unexpected token')
      ) {
        this.stats.corruptedEntries++;
        log.warn('Corrupted cache entry detected, cleaning up', { key: storageKey });
        try {
          await this.adapter.del(storageKey);
          await this.adapter.set(storageKey, { __cacheWrapper: true, __errorType: 'CACHE_CORRUPTED', __errorMessage: 'corrupted entry', __storedAt: Date.now(), __ttl: ERROR_TTLS.CACHE_CORRUPTED, data: null }, ERROR_TTLS.CACHE_CORRUPTED);
        } catch {
          /* best effort */
        }
      }
      return null;
    }
  }

  /**
   * Set a value in cache with wrapper metadata for stale-while-revalidate.
   */
  async set(key, value, ttlSeconds) {
    const storageKey = this._prefixKey(key);
    try {
      const wrapped = {
        __cacheWrapper: true,
        __storedAt: Date.now(),
        __ttl: ttlSeconds,
        data: value,
      };
      await this.adapter.set(storageKey, wrapped, Math.ceil(ttlSeconds * 1.3));
    } catch (err) {
      this.stats.errors++;
      log.warn('Cache set failed', { key: storageKey, error: err.message });
    }
  }

  /**
   * Cache an error result with error-type-specific TTL.
   */
  async setError(key, errorType, errorMessage) {
    const storageKey = this._prefixKey(key);
    const ttl = ERROR_TTLS[errorType] || ERROR_TTLS.TEMPORARY_ERROR;
    try {
      const entry = {
        __cacheWrapper: true,
        __errorType: errorType,
        __errorMessage: errorMessage,
        __storedAt: Date.now(),
        __ttl: ttl,
        data: null,
      };
      await this.adapter.set(storageKey, entry, ttl);
      log.debug('Cached error result', { key: storageKey.substring(0, 80), errorType, ttl });
    } catch (err) {
      log.warn('Failed to cache error', { error: err.message });
    }
  }

  /**
   * Delete a cache entry.
   */
  async del(key) {
    try {
      await this.adapter.del(this._prefixKey(key));
    } catch (err) {
      log.warn('Cache del failed', { key, error: err.message });
    }
  }

  /**
   * Execute a fetch function with full cache resilience:
   * - Check cache (return cached data or cached error)
   * - Deduplicate concurrent requests for same key
   * - On success: cache result
   * - On failure: cache error with type-specific TTL
   * - Stale-while-revalidate: serve stale data while refreshing in background
   *
   * @param {string} key - Cache key
   * @param {Function} fetchFn - Async function that fetches the data
   * @param {number} ttlSeconds - TTL for successful results
   * @param {object} [options]
   * @param {boolean} [options.allowStale=true] - Whether to serve stale data
   * @returns {Promise<any>} The fetched/cached data
   */
  async wrap(key, fetchFn, ttlSeconds, options = {}) {
    const { allowStale = true } = options;

    // 1. Check cache
    const cached = await this.getEntry(key);

    if (cached !== null) {
      // Cached error — re-throw so caller knows it failed recently
      if (cached.__errorType) {
        throw new CachedError(cached.__errorType, cached.__errorMessage);
      }

      // Fresh data
      if (!cached.__isStale) {
        return cached.__cacheWrapper ? cached.data : cached;
      }

      // Stale data — serve it and refresh in background
      if (allowStale && cached.__isStale) {
        this._refreshInBackground(key, fetchFn, ttlSeconds);
        return cached.data;
      }
    }

    // 2. Deduplicate concurrent requests
    if (this.inFlight.has(key)) {
      this.stats.deduplicatedRequests++;
      return this.inFlight.get(key);
    }

    // 3. Execute fetch with dedup tracking
    const promise = this._executeFetch(key, fetchFn, ttlSeconds);
    this.inFlight.set(key, promise);

    try {
      return await promise;
    } finally {
      this.inFlight.delete(key);
    }
  }

  /** @private */
  async _executeFetch(key, fetchFn, ttlSeconds) {
    try {
      const result = await fetchFn();
      const resultType = classifyResult(result);
      const effectiveTtl = resultType === 'EMPTY_RESULT' ? ERROR_TTLS.EMPTY_RESULT : ttlSeconds;
      await this.set(key, result, effectiveTtl);
      return result;
    } catch (error) {
      // Don't cache errors for CachedErrors (already cached)
      if (!(error instanceof CachedError)) {
        const errorType = classifyError(error);
        await this.setError(key, errorType, error.message);
      }
      throw error;
    }
  }

  /** @private — Fire-and-forget background refresh for stale-while-revalidate */
  _refreshInBackground(key, fetchFn, ttlSeconds) {
    // Only refresh if not already in-flight
    if (this.inFlight.has(key)) return;

    const promise = this._executeFetch(key, fetchFn, ttlSeconds).catch((err) => {
      log.debug('Background refresh failed', { key: key.substring(0, 80), error: err.message });
    });
    this.inFlight.set(key, promise);
    promise.finally(() => this.inFlight.delete(key));
  }

  /**
   * Get health stats for the /health endpoint.
   */
  getStats() {
    const total = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      hitRate: total > 0 ? ((this.stats.hits / total) * 100).toFixed(1) + '%' : 'N/A',
      inFlightRequests: this.inFlight.size,
    };
  }

  /**
   * Reset stats (useful for testing).
   */
  resetStats() {
    Object.keys(this.stats).forEach((k) => (this.stats[k] = 0));
  }
}

/**
 * Error class for cached errors — lets callers distinguish
 * "this failed recently" from "this failed right now".
 */
export class CachedError extends Error {
  constructor(errorType, message) {
    super(message || `Cached error: ${errorType}`);
    this.name = 'CachedError';
    this.errorType = errorType;
  }
}
