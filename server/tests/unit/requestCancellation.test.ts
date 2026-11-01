import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { CacheWrapper } from '../../src/services/cache/CacheWrapper.ts';
import { MockCacheAdapter } from './helpers/mocks.ts';
import { abortRequestContext, requestIdMiddleware } from '../../src/utils/requestContext.ts';

function inRequest<T>(work: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const res = Object.assign(new EventEmitter(), { setHeader() {}, writableFinished: false });
    requestIdMiddleware()({ headers: {} } as any, res as any, () => {
      work().then(resolve, reject);
    });
  });
}

describe('cancelled request caching', () => {
  it('lets a healthy coalesced caller recompute instead of receiving a cancelled partial result', async () => {
    const cache = new CacheWrapper(new MockCacheAdapter());
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const first = inRequest(() =>
      cache.wrap(
        'shared',
        async () => {
          await gate;
          abortRequestContext();
          return ['partial'];
        },
        60
      )
    );
    const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(cache.getStats().inFlightRequests).toBe(1));
    const second = inRequest(() => cache.wrap('shared', async () => ['complete'], 60));
    await vi.waitFor(() => expect(cache.getStats().deduplicatedRequests).toBe(1));
    finish();
    await rejected;
    await expect(second).resolves.toEqual(['complete']);
    expect(await cache.get('shared')).toEqual(['complete']);
  });

  it('does not cache a partially computed aggregate after cancellation', async () => {
    const cache = new CacheWrapper(new MockCacheAdapter());
    await expect(
      inRequest(() =>
        cache.wrap(
          'meta',
          async () => {
            abortRequestContext();
            return { videos: [{ id: 'only-the-first-batch' }] };
          },
          86_400
        )
      )
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(await cache.getEntry('meta')).toBeNull();
  });

  it('does not negative-cache cancellation or allow direct writes after cancellation', async () => {
    const cache = new CacheWrapper(new MockCacheAdapter());
    await expect(
      inRequest(() =>
        cache.wrap(
          'meta',
          async () => {
            abortRequestContext();
            throw new DOMException('Request cancelled', 'AbortError');
          },
          86_400
        )
      )
    ).rejects.toMatchObject({ name: 'AbortError' });
    await inRequest(async () => {
      abortRequestContext();
      await cache.set('season', { episodes: [] }, 1_209_600);
      await cache.setError('error', 'TEMPORARY_ERROR', 'cancelled');
    });
    expect(await cache.getEntry('meta')).toBeNull();
    expect(await cache.getEntry('season')).toBeNull();
    expect(await cache.getEntry('error')).toBeNull();
  });
});
