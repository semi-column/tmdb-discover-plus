import { createLogger } from '../utils/logger.ts';

const log = createLogger('MarketplaceCache');

/** TTL for search result pages (`mkt:search:*`). */
const SEARCH_TTL_MS = 60 * 1000;
/** TTL for entry detail records (`mkt:entry:*`). */
const ENTRY_TTL_MS = 300 * 1000;
/** How long a waiting caller will block on an in-progress load before self-computing. */
const WAIT_TIMEOUT_MS = 5 * 1000;

const SEARCH_PREFIX = 'mkt:search:';
const ENTRY_PREFIX = 'mkt:entry:';

interface CacheEntry {
  value: unknown;
  timestamp: number;
  ttlMs: number;
  /** Namespace version captured when a search entry was stored (0 for non-search keys). */
  namespaceVersion: number;
}

/** Sentinel returned by the wait timer so we can distinguish timeout from a real value. */
const WAIT_TIMEOUT = Symbol('mkt-wait-timeout');

/**
 * In-memory cache for marketplace search pages and entry detail with stampede protection.
 *
 * Mirrors `ConfigCache.getOrLoad` but adds:
 * - Per-key-prefix TTLs: `mkt:search:*` → 60s, `mkt:entry:*` → 300s.
 * - Bounded stampede protection: only one concurrent computation per signature; other callers
 *   wait up to 5 seconds for that computation, then perform their own computation
 *   (self-compute fallback) rather than waiting indefinitely.
 * - `invalidateEntry(id)` to drop a single `mkt:entry:{id}` key.
 * - `invalidateSearchNamespace()` to clear all `mkt:search:*` entries via a namespace version bump.
 */
export class MarketplaceCache {
  private maxSize: number;
  private cache: Map<string, CacheEntry>;
  private pendingLoads: Map<string, Promise<unknown>>;
  /** Bumped to invalidate the entire search namespace without scanning keys. */
  private searchNamespaceVersion: number;
  private stats: {
    hits: number;
    misses: number;
    evictions: number;
    coalesced: number;
    selfComputed: number;
  };

  constructor(options: { maxSize?: number } = {}) {
    this.maxSize = options.maxSize || 2000;
    this.cache = new Map();
    this.pendingLoads = new Map();
    this.searchNamespaceVersion = 0;
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      coalesced: 0,
      selfComputed: 0,
    };
  }

  private ttlForKey(key: string): number {
    if (key.startsWith(ENTRY_PREFIX)) return ENTRY_TTL_MS;
    return SEARCH_TTL_MS;
  }

  private isSearchKey(key: string): boolean {
    return key.startsWith(SEARCH_PREFIX);
  }

  /**
   * Return a cached value for `key`, or compute it via `loader`.
   *
   * - Cache hit (fresh + correct namespace): returns immediately (Req 10.1).
   * - Cache miss with no in-flight load: computes, stores, returns (Req 10.2).
   * - Cache miss with an in-flight load for the same key: waits up to 5s for it (Req 10.3);
   *   if it does not resolve in time, computes its own result instead of waiting (Req 10.4).
   */
  async getOrLoad(key: string, loader: () => Promise<unknown>): Promise<unknown> {
    const cached = this.readFresh(key);
    if (cached !== undefined) {
      this.stats.hits++;
      return cached.value;
    }

    this.stats.misses++;

    // A computation for this signature is already in progress: wait on it, but not forever.
    const pending = this.pendingLoads.get(key);
    if (pending) {
      const raced = await this.raceWithTimeout(pending);
      if (raced !== WAIT_TIMEOUT) {
        this.stats.coalesced++;
        return raced;
      }
      // Waited 5s without a result: self-compute rather than waiting indefinitely (Req 10.4).
      this.stats.selfComputed++;
      const value = await loader();
      this.put(key, value);
      return value;
    }

    // No in-flight load: become the single computation for this signature (Req 10.3).
    return this.startLoad(key, loader);
  }

  private startLoad(key: string, loader: () => Promise<unknown>): Promise<unknown> {
    const loadPromise = loader()
      .then((value) => {
        this.put(key, value);
        return value;
      })
      .finally(() => {
        this.pendingLoads.delete(key);
      });

    this.pendingLoads.set(key, loadPromise);
    return loadPromise;
  }

  private async raceWithTimeout(pending: Promise<unknown>): Promise<unknown | typeof WAIT_TIMEOUT> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<typeof WAIT_TIMEOUT>((resolve) => {
      timer = setTimeout(() => resolve(WAIT_TIMEOUT), WAIT_TIMEOUT_MS);
    });
    try {
      // If the pending load rejects, fall back to self-compute by treating it as a timeout.
      return await Promise.race([pending.catch(() => WAIT_TIMEOUT), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Read a fresh, non-expired entry for `key`, honoring the search namespace version. */
  private readFresh(key: string): CacheEntry | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    // Search entries stored under a superseded namespace version are no longer valid.
    if (this.isSearchKey(key) && entry.namespaceVersion !== this.searchNamespaceVersion) {
      this.cache.delete(key);
      return undefined;
    }

    const age = Date.now() - entry.timestamp;
    if (age >= entry.ttlMs) {
      this.cache.delete(key);
      return undefined;
    }

    // LRU: move to end on access.
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry;
  }

  private put(key: string, value: unknown): void {
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
        this.stats.evictions++;
      }
    }

    this.cache.delete(key);
    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      ttlMs: this.ttlForKey(key),
      namespaceVersion: this.isSearchKey(key) ? this.searchNamespaceVersion : 0,
    });
  }

  /**
   * Invalidate a single entry-detail key (`mkt:entry:{id}`) after a mutation (Req 10.5).
   */
  invalidateEntry(marketplaceId: string): void {
    const key = `${ENTRY_PREFIX}${marketplaceId}`;
    this.cache.delete(key);
    log.debug('Marketplace entry cache invalidated', { key });
  }

  /**
   * Clear the entire search cache namespace by bumping the namespace version (Req 10.6).
   * Existing `mkt:search:*` entries become unreachable without scanning keys; they are also
   * proactively dropped to free memory.
   */
  invalidateSearchNamespace(): void {
    this.searchNamespaceVersion++;
    for (const existingKey of [...this.cache.keys()]) {
      if (this.isSearchKey(existingKey)) {
        this.cache.delete(existingKey);
      }
    }
    log.debug('Marketplace search namespace invalidated', {
      namespaceVersion: this.searchNamespaceVersion,
    });
  }

  /** Clear all entries and pending loads. */
  clear(): void {
    this.cache.clear();
    this.pendingLoads.clear();
    log.debug('Marketplace cache cleared');
  }

  /** Stats for the /health endpoint. */
  getStats(): {
    size: number;
    maxSize: number;
    pendingLoads: number;
    searchNamespaceVersion: number;
    hits: number;
    misses: number;
    evictions: number;
    coalesced: number;
    selfComputed: number;
  } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      pendingLoads: this.pendingLoads.size,
      searchNamespaceVersion: this.searchNamespaceVersion,
      ...this.stats,
    };
  }
}

// Singleton instance
let instance: MarketplaceCache | null = null;

export function getMarketplaceCache(): MarketplaceCache {
  if (!instance) {
    instance = new MarketplaceCache();
  }
  return instance;
}
