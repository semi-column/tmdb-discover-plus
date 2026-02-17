import { createLogger } from '../../utils/logger.ts';
import type {
  ICacheAdapter,
  CacheErrorType,
  CacheWrapperEntry,
  CacheWrapperStats,
  CacheWrapOptions,
} from '../../types/index.ts';

const log = createLogger('CacheWrapper');

const MAX_IN_FLIGHT = 5000;
const IN_FLIGHT_WARN_THRESHOLD = MAX_IN_FLIGHT * 0.8;
const ERROR_TTLS: Record<CacheErrorType, number> = {
  EMPTY_RESULT: 60, // 1 minute — might have data soon
  RATE_LIMITED: 900, // 15 minutes — back off significantly
  TEMPORARY_ERROR: 120, // 2 minutes — 5xx, network errors
  PERMANENT_ERROR: 1800, // 30 minutes — 4xx (except 404/429)
  NOT_FOUND: 3600, // 1 hour — resource doesn't exist
  CACHE_CORRUPTED: 60, // 1 minute — retry quickly after cleanup
};
export function classifyError(
  error: { message?: string; code?: string; name?: string } | null | undefined,
  statusCode?: number
): CacheErrorType {
  const msg = error?.message || '';

  if (statusCode === 429 || msg.includes('429') || msg.toLowerCase().includes('rate limit')) {
    return 'RATE_LIMITED';
  }
  if (statusCode === 404 || msg.includes('404') || msg.toLowerCase().includes('not found')) {
    return 'NOT_FOUND';
  }
  if ((statusCode !== undefined && statusCode >= 500) || /\b5\d{2}\b/.test(msg)) {
    return 'TEMPORARY_ERROR';
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
  if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
    return 'PERMANENT_ERROR';
  }

  return 'TEMPORARY_ERROR'; // default
}

export function classifyResult(data: unknown): CacheErrorType | null {
  if (data === null || data === undefined) return 'EMPTY_RESULT';
  if (Array.isArray(data) && data.length === 0) return 'EMPTY_RESULT';
  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.results) && obj.results.length === 0) return 'EMPTY_RESULT';
  }
  return null;
}
export class CacheWrapper {
  private adapter: ICacheAdapter;
  private keyPrefix: string;
  private inFlight: Map<string, Promise<unknown>>;
  private stats: Record<string, number>;

  constructor(adapter: ICacheAdapter, options: { version?: string } = {}) {
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
      inFlightOverflows: 0,
      writeValidationFailures: 0,
    };
  }

  private _prefixKey(key: string): string {
    return this.keyPrefix + key;
  }
  async get(key: string): Promise<unknown> {
    const entry = await this.getEntry(key);

    if (entry && typeof entry === 'object' && entry.__cacheWrapper) {
      if (entry.__errorType) return null;
      return entry.data;
    }

    return entry;
  }

  async getEntry(key: string): Promise<CacheWrapperEntry | null> {
    const storageKey = this._prefixKey(key);
    try {
      const raw = await this.adapter.get(storageKey);
      if (raw === null || raw === undefined) {
        this.stats.misses++;
        log.debug('Cache miss', { key: storageKey.substring(0, 80) });
        return null;
      }

      if (raw && typeof raw === 'object' && (raw as CacheWrapperEntry).__cacheWrapper) {
        const entry = raw as CacheWrapperEntry;
        if (typeof entry.__storedAt !== 'number' || typeof entry.__ttl !== 'number') {
          this.stats.corruptedEntries++;
          log.warn('Malformed cache wrapper entry, cleaning up', { key: storageKey });
          await this.adapter.del(storageKey).catch((e) =>
            log.debug('Cache del failed during corruption cleanup', {
              key: storageKey,
              error: e.message,
            })
          );
          await this.adapter
            .set(
              storageKey,
              {
                __cacheWrapper: true,
                __errorType: 'CACHE_CORRUPTED',
                __errorMessage: 'malformed entry',
                __storedAt: Date.now(),
                __ttl: ERROR_TTLS.CACHE_CORRUPTED,
                data: null,
              },
              ERROR_TTLS.CACHE_CORRUPTED
            )
            .catch((e) =>
              log.debug('Cache set failed during corruption cleanup', {
                key: storageKey,
                error: e.message,
              })
            );
          return null;
        }

        if (entry.__errorType) {
          this.stats.cachedErrors++;
          return entry;
        }

        if (entry.__storedAt && entry.__ttl) {
          const age = (Date.now() - entry.__storedAt) / 1000;
          if (age > entry.__ttl) {
            if (age < entry.__ttl * 2) {
              this.stats.staleServed++;
              return { ...entry, __isStale: true };
            }
            this.stats.misses++;
            return null;
          }
        }

        this.stats.hits++;
        return entry;
      }

      this.stats.hits++;
      log.debug('Cache hit (unwrapped)', { key: storageKey.substring(0, 80) });
      return raw as CacheWrapperEntry;
    } catch (err) {
      this.stats.errors++;
      const errMsg = (err as Error).message ?? '';
      if (
        errMsg.includes('JSON') ||
        errMsg.includes('parse') ||
        errMsg.includes('Unexpected token')
      ) {
        this.stats.corruptedEntries++;
        log.warn('Corrupted cache entry detected, cleaning up', { key: storageKey });
        try {
          await this.adapter.del(storageKey);
          await this.adapter.set(
            storageKey,
            {
              __cacheWrapper: true,
              __errorType: 'CACHE_CORRUPTED',
              __errorMessage: 'corrupted entry',
              __storedAt: Date.now(),
              __ttl: ERROR_TTLS.CACHE_CORRUPTED,
              data: null,
            },
            ERROR_TTLS.CACHE_CORRUPTED
          );
        } catch (e) {
          log.debug('Cache cleanup failed after corruption', {
            key: storageKey,
            error: (e as Error).message,
          });
        }
      }
      return null;
    }
  }
  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (value === undefined) {
      this.stats.writeValidationFailures++;
      log.warn('Cache write validation failed: undefined value', { key: key.substring(0, 80) });
      return;
    }
    const storageKey = this._prefixKey(key);
    try {
      const wrapped: CacheWrapperEntry = {
        __cacheWrapper: true,
        __storedAt: Date.now(),
        __ttl: ttlSeconds,
        data: value,
      };
      await this.adapter.set(storageKey, wrapped, Math.ceil(ttlSeconds * 2.5));
    } catch (err) {
      this.stats.errors++;
      const errMsg = (err as Error).message ?? '';
      if (
        errMsg.includes('ECONNREFUSED') ||
        errMsg.includes('ECONNRESET') ||
        errMsg.includes('ENOTCONN') ||
        errMsg.includes('connection')
      ) {
        log.warn('Cache adapter connection issue, skipping set', {
          key: storageKey.substring(0, 60),
        });
        return;
      }
      log.warn('Cache set failed', { key: storageKey, error: errMsg });
    }
  }
  async setError(key: string, errorType: CacheErrorType, errorMessage: string): Promise<void> {
    const storageKey = this._prefixKey(key);
    const ttl = ERROR_TTLS[errorType] || ERROR_TTLS.TEMPORARY_ERROR;
    try {
      const entry: CacheWrapperEntry = {
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
      log.warn('Failed to cache error', { error: (err as Error).message });
    }
  }
  async del(key: string): Promise<void> {
    try {
      await this.adapter.del(this._prefixKey(key));
    } catch (err) {
      log.warn('Cache del failed', { key, error: (err as Error).message });
    }
  }
  async wrap(
    key: string,
    fetchFn: () => Promise<unknown>,
    ttlSeconds: number,
    options: CacheWrapOptions = {}
  ): Promise<unknown> {
    const { allowStale = true } = options;
    const cached = await this.getEntry(key);

    if (cached !== null) {
      if (cached.__errorType) {
        throw new CachedError(cached.__errorType, cached.__errorMessage);
      }
      if (!cached.__isStale) {
        return cached.__cacheWrapper ? cached.data : cached;
      }
      if (allowStale && cached.__isStale) {
        this._refreshInBackground(key, fetchFn, ttlSeconds);
        return cached.data;
      }
    }
    if (this.inFlight.has(key)) {
      this.stats.deduplicatedRequests++;
      return this.inFlight.get(key);
    }

    if (this.inFlight.size >= MAX_IN_FLIGHT) {
      this.stats.inFlightOverflows++;
      log.warn('inFlight map at capacity, executing directly', { size: this.inFlight.size });
      return this._executeFetch(key, fetchFn, ttlSeconds);
    }

    if (this.inFlight.size >= IN_FLIGHT_WARN_THRESHOLD && this.inFlight.size % 100 === 0) {
      log.warn('inFlight map approaching capacity', {
        size: this.inFlight.size,
        max: MAX_IN_FLIGHT,
      });
    }
    const promise = this._executeFetch(key, fetchFn, ttlSeconds);
    this.inFlight.set(key, promise);

    try {
      return await promise;
    } finally {
      this.inFlight.delete(key);
    }
  }
  async _executeFetch(
    key: string,
    fetchFn: () => Promise<unknown>,
    ttlSeconds: number
  ): Promise<unknown> {
    try {
      const result = await fetchFn();
      const resultType = classifyResult(result);
      const effectiveTtl = resultType === 'EMPTY_RESULT' ? ERROR_TTLS.EMPTY_RESULT : ttlSeconds;
      await this.set(key, result, effectiveTtl);
      return result;
    } catch (error) {
      if (!(error instanceof CachedError)) {
        const errorType = classifyError(error as Error);
        await this.setError(key, errorType, (error as Error).message);
      }
      throw error;
    }
  }
  _refreshInBackground(key: string, fetchFn: () => Promise<unknown>, ttlSeconds: number): void {
    if (this.inFlight.has(key)) return;

    const promise = this._executeFetch(key, fetchFn, ttlSeconds).catch((err: unknown) => {
      log.debug('Background refresh failed', {
        key: key.substring(0, 80),
        error: (err as Error).message,
      });
    });
    this.inFlight.set(key, promise);
    promise.finally(() => this.inFlight.delete(key));
  }
  getStats(): CacheWrapperStats {
    const total = this.stats.hits + this.stats.misses;
    const adapterStats = typeof this.adapter.getStats === 'function' ? this.adapter.getStats() : {};
    return {
      ...this.stats,
      hitRate: total > 0 ? ((this.stats.hits / total) * 100).toFixed(1) + '%' : 'N/A',
      inFlightRequests: this.inFlight.size,
      inFlightMax: MAX_IN_FLIGHT,
      adapter: adapterStats as Record<string, unknown>,
    } as CacheWrapperStats;
  }
  resetStats(): void {
    Object.keys(this.stats).forEach((k) => (this.stats[k] = 0));
  }
}
export class CachedError extends Error {
  errorType: CacheErrorType;
  constructor(errorType: CacheErrorType, message?: string) {
    super(message || `Cached error: ${errorType}`);
    this.name = 'CachedError';
    this.errorType = errorType;
  }
}
