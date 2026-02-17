import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  CacheWrapper,
  CachedError,
  classifyError,
  classifyResult,
} from '../../src/services/cache/CacheWrapper.ts';
import { MockCacheAdapter, FailingCacheAdapter } from './helpers/mocks.ts';

describe('classifyError', () => {
  it('detects rate limiting by status code', () => {
    expect(classifyError(new Error('fail'), 429)).toBe('RATE_LIMITED');
  });
  it('detects rate limiting by message', () => {
    expect(classifyError(new Error('429 Too Many Requests'))).toBe('RATE_LIMITED');
  });
  it('detects not found', () => {
    expect(classifyError(new Error('fail'), 404)).toBe('NOT_FOUND');
  });
  it('detects temporary errors from connection codes', () => {
    const err = new Error('connection refused');
    (err as any).code = 'ECONNREFUSED';
    expect(classifyError(err)).toBe('TEMPORARY_ERROR');
  });
  it('detects permanent errors for 4xx', () => {
    expect(classifyError(new Error('bad request'), 400)).toBe('PERMANENT_ERROR');
  });
  it('defaults to TEMPORARY_ERROR', () => {
    expect(classifyError(new Error('unknown'))).toBe('TEMPORARY_ERROR');
  });
});

describe('classifyResult', () => {
  it('returns EMPTY_RESULT for null/undefined', () => {
    expect(classifyResult(null)).toBe('EMPTY_RESULT');
    expect(classifyResult(undefined)).toBe('EMPTY_RESULT');
  });
  it('returns EMPTY_RESULT for empty array', () => {
    expect(classifyResult([])).toBe('EMPTY_RESULT');
  });
  it('returns EMPTY_RESULT for empty results property', () => {
    expect(classifyResult({ results: [] })).toBe('EMPTY_RESULT');
  });
  it('returns null for valid data', () => {
    expect(classifyResult({ results: [{ id: 1 }] })).toBeNull();
    expect(classifyResult([1, 2, 3])).toBeNull();
    expect(classifyResult('text')).toBeNull();
  });
});

describe('CacheWrapper', () => {
  let adapter: MockCacheAdapter;
  let cache: CacheWrapper;

  beforeEach(() => {
    adapter = new MockCacheAdapter();
    cache = new CacheWrapper(adapter, { version: '1.0.0' });
  });

  describe('key prefixing', () => {
    it('prefixes keys with version', async () => {
      await cache.set('test-key', 'value', 60);
      expect(adapter.store.has('v1.0.0:test-key')).toBe(true);
    });

    it('works without version prefix', async () => {
      const noPrefix = new CacheWrapper(adapter);
      await noPrefix.set('key', 'val', 60);
      expect(adapter.store.has('key')).toBe(true);
    });
  });

  describe('get/set', () => {
    it('returns null for cache miss', async () => {
      const result = await cache.get('nonexistent');
      expect(result).toBeNull();
      expect(cache.getStats().misses).toBe(1);
    });

    it('sets and gets wrapped values', async () => {
      await cache.set('key', { data: 'test' }, 300);
      const result = await cache.getEntry('key');
      expect(result).toBeTruthy();
      expect(result.__cacheWrapper).toBe(true);
      expect(result.data).toEqual({ data: 'test' });
      expect(cache.getStats().hits).toBe(1);
    });

    it('stores with 2.5x TTL buffer', async () => {
      const spy = vi.spyOn(adapter, 'set');
      await cache.set('key', 'val', 100);
      expect(spy).toHaveBeenCalledWith('v1.0.0:key', expect.any(Object), 250);
    });
  });

  describe('self-healing', () => {
    it('cleans malformed wrapper entries', async () => {
      adapter.store.set('v1.0.0:bad', { __cacheWrapper: true });
      const result = await cache.get('bad');
      expect(result).toBeNull();
      expect(cache.getStats().corruptedEntries).toBe(1);
    });

    it('handles JSON parse errors gracefully', async () => {
      const failing = new FailingCacheAdapter();
      failing.get = async () => {
        throw new Error('Unexpected token in JSON');
      };
      const wrapper = new CacheWrapper(failing, { version: '1' });
      const result = await wrapper.get('key');
      expect(result).toBeNull();
      expect(wrapper.getStats().corruptedEntries).toBe(1);
    });
  });

  describe('stale-while-revalidate', () => {
    it('marks expired-but-recent entries as stale', async () => {
      const entry = {
        __cacheWrapper: true,
        __storedAt: Date.now() - 400_000,
        __ttl: 300,
        data: 'stale-data',
      };
      adapter.store.set('v1.0.0:stale', entry);
      const result = await cache.getEntry('stale');
      expect(result.__isStale).toBe(true);
      expect(result.data).toBe('stale-data');
      expect(cache.getStats().staleServed).toBe(1);
    });

    it('returns null for entries beyond 2x TTL', async () => {
      const entry = {
        __cacheWrapper: true,
        __storedAt: Date.now() - 700_000,
        __ttl: 300,
        data: 'too-old',
      };
      adapter.store.set('v1.0.0:old', entry);
      const result = await cache.get('old');
      expect(result).toBeNull();
    });
  });

  describe('error caching', () => {
    it('caches errors with type-specific TTL', async () => {
      await cache.setError('err-key', 'NOT_FOUND', 'Resource not found');
      const result = await cache.getEntry('err-key');
      expect(result.__errorType).toBe('NOT_FOUND');
      expect(result.__errorMessage).toBe('Resource not found');
    });

    it('returns null for cached errors from get()', async () => {
      await cache.setError('err', 'RATE_LIMITED', 'Too many requests');
      const result = await cache.get('err');
      expect(result).toBeNull();
      expect(cache.getStats().cachedErrors).toBe(1);
    });
  });

  describe('wrap()', () => {
    it('fetches and caches on miss', async () => {
      const fn = vi.fn().mockResolvedValue({ id: 1, title: 'Test' });
      const result = await cache.wrap('wrap-key', fn, 300);
      expect(result).toEqual({ id: 1, title: 'Test' });
      expect(fn).toHaveBeenCalledOnce();

      const cached = await cache.get('wrap-key');
      expect(cached).toEqual({ id: 1, title: 'Test' });
    });

    it('returns cached data on hit', async () => {
      const fn = vi.fn().mockResolvedValue('first');
      await cache.wrap('key', fn, 300);
      fn.mockResolvedValue('second');
      const result = await cache.wrap('key', fn, 300);
      expect(result).toBe('first');
      expect(fn).toHaveBeenCalledOnce();
    });

    it('deduplicates concurrent requests', async () => {
      const slow = vi
        .fn()
        .mockImplementation(() => new Promise<string>((r) => setTimeout(() => r('result'), 50)));

      const p1 = cache.wrap('dedup', slow, 300);
      const p2 = cache.wrap('dedup', slow, 300);

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toBe('result');
      expect(r2).toBe('result');
      expect(slow).toHaveBeenCalledOnce();
      expect(cache.getStats().deduplicatedRequests).toBe(1);
    });

    it('throws CachedError for cached failures', async () => {
      await cache.setError('fail', 'NOT_FOUND', 'gone');
      await expect(cache.wrap('fail', vi.fn(), 300)).rejects.toThrow(CachedError);
    });

    it('caches fetch failures', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('network error'));
      await expect(cache.wrap('net-err', fn, 300)).rejects.toThrow('network error');

      const cached = await cache.getEntry('net-err');
      expect(cached.__errorType).toBe('TEMPORARY_ERROR');
    });

    it('uses short TTL for empty results', async () => {
      const fn = vi.fn().mockResolvedValue({ results: [] });
      await cache.wrap('empty', fn, 3600);
      const stored = adapter.store.get('v1.0.0:empty') as any;
      expect(stored.__ttl).toBe(60);
    });
  });

  describe('getStats()', () => {
    it('returns formatted stats', async () => {
      await cache.get('miss1');
      await cache.set('hit', 'data', 300);
      await cache.get('hit');
      const stats = cache.getStats();
      expect(stats.misses).toBe(1);
      expect(stats.hits).toBe(1);
      expect(stats.hitRate).toBe('50.0%');
    });

    it('returns N/A hitRate when no requests', () => {
      expect(cache.getStats().hitRate).toBe('N/A');
    });
  });

  describe('resetStats()', () => {
    it('resets all counters to zero', async () => {
      await cache.get('miss');
      cache.resetStats();
      expect(cache.getStats().misses).toBe(0);
    });
  });
});
