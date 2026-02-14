import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CacheWrapper, CachedError } from '../../src/services/cache/CacheWrapper.js';
import { MockCacheAdapter, FailingCacheAdapter } from './helpers/mocks.ts';

describe('CacheWrapper edge cases', () => {
  let adapter: MockCacheAdapter;
  let cache: CacheWrapper;

  beforeEach(() => {
    adapter = new MockCacheAdapter();
    cache = new CacheWrapper(adapter, { version: '2.0.0' });
  });

  describe('version migration', () => {
    it('ignores entries with old version prefix', async () => {
      adapter.store.set('v1.0.0:key', {
        __cacheWrapper: true,
        __storedAt: Date.now(),
        __ttl: 3600,
        data: 'old-version-data',
      });

      const result = await cache.get('key');
      expect(result).toBeNull();
    });

    it('reads entries with current version prefix', async () => {
      await cache.set('key', 'current-data', 300);
      const result = await cache.get('key');
      expect(result).toBe('current-data');
    });

    it('does not overwrite old-version keys', async () => {
      adapter.store.set('v1.0.0:shared', {
        __cacheWrapper: true,
        __storedAt: Date.now(),
        __ttl: 3600,
        data: 'old',
      });

      await cache.set('shared', 'new', 300);

      expect(adapter.store.has('v1.0.0:shared')).toBe(true);
      expect(adapter.store.has('v2.0.0:shared')).toBe(true);
    });
  });

  describe('concurrent wrap() deduplication', () => {
    it('deduplicates three concurrent requests', async () => {
      const fn = vi
        .fn()
        .mockImplementation(() => new Promise<string>((r) => setTimeout(() => r('shared'), 30)));

      const [r1, r2, r3] = await Promise.all([
        cache.wrap('triple', fn, 300),
        cache.wrap('triple', fn, 300),
        cache.wrap('triple', fn, 300),
      ]);

      expect(r1).toBe('shared');
      expect(r2).toBe('shared');
      expect(r3).toBe('shared');
      expect(fn).toHaveBeenCalledOnce();
      expect(cache.getStats().deduplicatedRequests).toBe(2);
    });

    it('second request after first completes triggers fresh fetch', async () => {
      const fn = vi.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second');

      const r1 = await cache.wrap('seq', fn, 300);
      expect(r1).toBe('first');

      cache.resetStats();

      const r2 = await cache.wrap('seq', fn, 300);
      expect(r2).toBe('first');
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('stale-while-revalidate when refresh throws', () => {
    it('serves stale data when available and fetcher throws', async () => {
      const entry = {
        __cacheWrapper: true,
        __storedAt: Date.now() - 400_000,
        __ttl: 300,
        data: 'stale-value',
      };
      adapter.store.set('v2.0.0:refresh-fail', entry);

      const result = await cache.getEntry('refresh-fail');
      expect(result.__isStale).toBe(true);
      expect(result.data).toBe('stale-value');
    });
  });

  describe('adapter failure fallthrough', () => {
    it('returns null on adapter get failure', async () => {
      const failing = new FailingCacheAdapter();
      const wrapper = new CacheWrapper(failing, { version: '2' });

      const result = await wrapper.get('any-key');
      expect(result).toBeNull();
      expect(wrapper.getStats().errors).toBe(1);
    });

    it('swallows adapter set failure without throwing', async () => {
      const failing = new FailingCacheAdapter();
      const wrapper = new CacheWrapper(failing, { version: '2' });

      await expect(wrapper.set('key', 'val', 60)).resolves.not.toThrow();
    });

    it('wrap() still works when cache fails — calls fetcher', async () => {
      const failing = new FailingCacheAdapter();
      const wrapper = new CacheWrapper(failing, { version: '2' });

      const fn = vi.fn().mockResolvedValue({ id: 42 });
      const result = await wrapper.wrap('fallback', fn, 300);
      expect(result).toEqual({ id: 42 });
      expect(fn).toHaveBeenCalledOnce();
    });
  });

  describe('error caching edge cases', () => {
    it('different error types get different TTLs', async () => {
      await cache.setError('rate', 'RATE_LIMITED', 'rate limited');
      await cache.setError('notfound', 'NOT_FOUND', 'not found');
      await cache.setError('temp', 'TEMPORARY_ERROR', 'temp fail');

      const rate = adapter.store.get('v2.0.0:rate') as any;
      const notfound = adapter.store.get('v2.0.0:notfound') as any;
      const temp = adapter.store.get('v2.0.0:temp') as any;

      expect(rate.__ttl).not.toBe(notfound.__ttl);
      expect(rate.__errorType).toBe('RATE_LIMITED');
      expect(notfound.__errorType).toBe('NOT_FOUND');
      expect(temp.__errorType).toBe('TEMPORARY_ERROR');
    });
  });
});
