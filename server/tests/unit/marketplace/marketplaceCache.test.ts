import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  MarketplaceCache,
  getMarketplaceCache,
} from '../../../src/infrastructure/marketplaceCache.ts';

/** A promise whose resolution is controlled externally, for modeling in-flight loads. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('MarketplaceCache', () => {
  let cache: MarketplaceCache;

  beforeEach(() => {
    // Fresh instance per test so cached entries / namespace versions never leak across tests.
    cache = new MarketplaceCache();
  });

  afterEach(() => {
    // Always restore real timers even if a test forgot, so timer state never leaks.
    vi.useRealTimers();
  });

  describe('cache hit / miss (Req 10.1, 10.2)', () => {
    it('computes via the loader on a miss, then returns the cached value on a hit without recomputing', async () => {
      let loadCount = 0;
      const loader = async () => {
        loadCount++;
        return { name: 'Sci-Fi Gems' };
      };

      const first = await cache.getOrLoad('mkt:search:abc', loader); // miss -> compute
      const second = await cache.getOrLoad('mkt:search:abc', loader); // hit -> cached

      expect(first).toEqual({ name: 'Sci-Fi Gems' });
      expect(second).toEqual({ name: 'Sci-Fi Gems' });
      expect(loadCount).toBe(1); // loader invoked only on the miss

      const stats = cache.getStats();
      expect(stats.misses).toBe(1);
      expect(stats.hits).toBe(1);
    });
  });

  describe('single-flight stampede protection (Req 10.3)', () => {
    it('shares one loader invocation across concurrent getOrLoad calls for the same key', async () => {
      const inFlight = deferred<string>();
      let load1 = 0;
      let load2 = 0;

      const p1 = cache.getOrLoad('mkt:search:dup', async () => {
        load1++;
        return inFlight.promise; // resolves only when we say so
      });
      const p2 = cache.getOrLoad('mkt:search:dup', async () => {
        load2++;
        return 'second-loader';
      });

      // Resolve the single in-flight computation; the waiter coalesces onto it.
      inFlight.resolve('shared-result');
      const [r1, r2] = await Promise.all([p1, p2]);

      expect(r1).toBe('shared-result');
      expect(r2).toBe('shared-result');
      expect(load1).toBe(1); // exactly one computation ran
      expect(load2).toBe(0); // the second caller did not recompute
      expect(cache.getStats().coalesced).toBe(1);
    });
  });

  describe('5s wait fallback (Req 10.4)', () => {
    it('self-computes when the in-flight load does not resolve within 5 seconds', async () => {
      vi.useFakeTimers();

      const stuck = deferred<string>(); // never resolves
      let load1 = 0;
      let load2 = 0;

      const p1 = cache.getOrLoad('mkt:search:slow', async () => {
        load1++;
        return stuck.promise;
      });
      const p2 = cache.getOrLoad('mkt:search:slow', async () => {
        load2++;
        return 'self-computed';
      });

      // Advance past the 5s wait timeout; the waiter stops waiting and computes its own result.
      await vi.advanceTimersByTimeAsync(5000);
      const r2 = await p2;

      expect(r2).toBe('self-computed');
      expect(load2).toBe(1); // the waiter performed its own computation
      expect(cache.getStats().selfComputed).toBe(1);

      // The original in-flight computation is still counted as started; keep p1 referenced.
      expect(load1).toBe(1);
      void p1;
    });
  });

  describe('TTL expiry (Req 10.7, 10.8)', () => {
    it('expires search keys (mkt:search:*) after 60 seconds and recomputes', async () => {
      vi.useFakeTimers();

      let loadCount = 0;
      const loader = async () => {
        loadCount++;
        return `value-${loadCount}`;
      };
      const key = 'mkt:search:ttl';

      await cache.getOrLoad(key, loader); // miss -> compute
      await cache.getOrLoad(key, loader); // hit, still fresh
      expect(loadCount).toBe(1);

      await vi.advanceTimersByTimeAsync(60_000); // reach the 60s TTL boundary

      const result = await cache.getOrLoad(key, loader); // expired -> recompute
      expect(loadCount).toBe(2);
      expect(result).toBe('value-2');
    });

    it('keeps search keys fresh just before the 60s TTL', async () => {
      vi.useFakeTimers();

      let loadCount = 0;
      const loader = async () => {
        loadCount++;
        return loadCount;
      };
      const key = 'mkt:search:fresh';

      await cache.getOrLoad(key, loader);
      await vi.advanceTimersByTimeAsync(59_999); // still within TTL
      await cache.getOrLoad(key, loader);

      expect(loadCount).toBe(1); // served from cache, no recompute
    });

    it('expires entry keys (mkt:entry:*) after 300 seconds, not after 60', async () => {
      vi.useFakeTimers();

      let loadCount = 0;
      const loader = async () => {
        loadCount++;
        return `entry-${loadCount}`;
      };
      const key = 'mkt:entry:xyz';

      await cache.getOrLoad(key, loader); // miss -> compute

      await vi.advanceTimersByTimeAsync(60_000); // well within the 300s entry TTL
      await cache.getOrLoad(key, loader); // still fresh -> hit
      expect(loadCount).toBe(1);

      await vi.advanceTimersByTimeAsync(240_000); // total 300s -> at TTL boundary
      const result = await cache.getOrLoad(key, loader); // expired -> recompute
      expect(loadCount).toBe(2);
      expect(result).toBe('entry-2');
    });
  });

  describe('namespace and entry invalidation (Req 10.7, 10.8 supporting)', () => {
    it('invalidateSearchNamespace clears mkt:search:* entries, forcing recompute', async () => {
      let loadCount = 0;
      const loader = async () => {
        loadCount++;
        return loadCount;
      };
      const key = 'mkt:search:ns';

      await cache.getOrLoad(key, loader);
      await cache.getOrLoad(key, loader);
      expect(loadCount).toBe(1); // cached

      cache.invalidateSearchNamespace();

      await cache.getOrLoad(key, loader);
      expect(loadCount).toBe(2); // recomputed after namespace clear
    });

    it('invalidateSearchNamespace does not drop entry-detail (mkt:entry:*) keys', async () => {
      let entryLoads = 0;
      const entryLoader = async () => {
        entryLoads++;
        return 'entry-value';
      };

      await cache.getOrLoad('mkt:entry:keep', entryLoader);
      await cache.getOrLoad('mkt:search:gone', async () => 'search-value');

      cache.invalidateSearchNamespace();

      // Entry key must still be served from cache (loader must not run again).
      const result = await cache.getOrLoad('mkt:entry:keep', async () => {
        entryLoads++;
        return 'should-not-run';
      });
      expect(result).toBe('entry-value');
      expect(entryLoads).toBe(1);
    });

    it('invalidateEntry drops the specific mkt:entry:{id} key only', async () => {
      let aLoads = 0;
      let bLoads = 0;
      const loaderA = async () => {
        aLoads++;
        return `a-${aLoads}`;
      };
      const loaderB = async () => {
        bLoads++;
        return `b-${bLoads}`;
      };

      await cache.getOrLoad('mkt:entry:a', loaderA);
      await cache.getOrLoad('mkt:entry:b', loaderB);

      cache.invalidateEntry('a');

      await cache.getOrLoad('mkt:entry:a', loaderA); // dropped -> recompute
      const bResult = await cache.getOrLoad('mkt:entry:b', loaderB); // untouched -> cached

      expect(aLoads).toBe(2);
      expect(bLoads).toBe(1);
      expect(bResult).toBe('b-1');
    });
  });

  describe('getMarketplaceCache singleton', () => {
    it('returns the same instance on repeated calls', () => {
      expect(getMarketplaceCache()).toBe(getMarketplaceCache());
    });
  });
});
