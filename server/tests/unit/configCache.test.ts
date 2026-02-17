import { describe, it, expect, beforeEach } from 'vitest';
import { ConfigCache } from '../../src/infrastructure/configCache.ts';

describe('ConfigCache', () => {
  let cache: ConfigCache;

  beforeEach(() => {
    cache = new ConfigCache({ maxSize: 3, ttlMs: 1000 });
  });

  it('caches and returns values', async () => {
    let loadCount = 0;
    const loader = async () => {
      loadCount++;
      return { userId: 'u1' };
    };

    const v1 = await cache.getOrLoad('u1', loader);
    const v2 = await cache.getOrLoad('u1', loader);

    expect(v1).toEqual({ userId: 'u1' });
    expect(v2).toEqual({ userId: 'u1' });
    expect(loadCount).toBe(1); // loader called only once
  });

  it('tracks hit/miss stats', async () => {
    await cache.getOrLoad('k1', async () => 'v1');
    await cache.getOrLoad('k1', async () => 'v1'); // cache hit

    const stats = cache.getStats();
    expect(stats.misses).toBe(1);
    expect(stats.hits).toBe(1);
  });

  it('evicts oldest entry when maxSize exceeded', async () => {
    await cache.getOrLoad('a', async () => 'va');
    await cache.getOrLoad('b', async () => 'vb');
    await cache.getOrLoad('c', async () => 'vc');
    await cache.getOrLoad('d', async () => 'vd'); // should evict 'a'

    const stats = cache.getStats();
    expect(stats.evictions).toBe(1);
    expect(stats.size).toBe(3);
  });

  it('invalidate removes entry', async () => {
    await cache.getOrLoad('k1', async () => 'v1');
    cache.invalidate('k1');

    let loadCount = 0;
    await cache.getOrLoad('k1', async () => {
      loadCount++;
      return 'v2';
    });
    expect(loadCount).toBe(1); // had to reload
  });

  it('set directly stores a value', async () => {
    cache.set('direct', { data: 'test' });
    const result = await cache.getOrLoad('direct', async () => 'should not be called');
    expect(result).toEqual({ data: 'test' });
  });

  it('clear removes all entries', async () => {
    await cache.getOrLoad('k1', async () => 'v1');
    await cache.getOrLoad('k2', async () => 'v2');
    cache.clear();
    expect(cache.getStats().size).toBe(0);
  });

  it('coalesces concurrent loads for same key', async () => {
    let loadCount = 0;
    const loader = () =>
      new Promise<string>((resolve) => {
        loadCount++;
        setTimeout(() => resolve('result'), 10);
      });

    const [r1, r2, r3] = await Promise.all([
      cache.getOrLoad('key', loader),
      cache.getOrLoad('key', loader),
      cache.getOrLoad('key', loader),
    ]);

    expect(r1).toBe('result');
    expect(r2).toBe('result');
    expect(r3).toBe('result');
    expect(loadCount).toBe(1);
    expect(cache.getStats().coalesced).toBe(2);
  });

  it('expires entries after TTL', async () => {
    const shortCache = new ConfigCache({ ttlMs: 50 });
    await shortCache.getOrLoad('k1', async () => 'old');

    await new Promise((r) => setTimeout(r, 60));

    let loadCount = 0;
    const result = await shortCache.getOrLoad('k1', async () => {
      loadCount++;
      return 'new';
    });
    expect(result).toBe('new');
    expect(loadCount).toBe(1);
  });
});
