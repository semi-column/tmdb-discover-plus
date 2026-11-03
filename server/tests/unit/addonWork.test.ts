import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  acquireAddonWork,
  withAddonWork,
  AddonWorkLimitError,
  sendAddonWorkLimit,
} from '../../src/utils/addonWork.ts';
import { abortRequestContext, requestIdMiddleware } from '../../src/utils/requestContext.ts';
import { CacheWrapper } from '../../src/services/cache/CacheWrapper.ts';
import { MockCacheAdapter } from './helpers/mocks.ts';

vi.mock('../../src/utils/logger.ts', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const releases: (() => void)[] = [];
afterEach(() => {
  releases.splice(0).forEach((release) => release());
  vi.useRealTimers();
});

async function occupy(userId: string, count = 6) {
  for (let i = 0; i < count; i++) releases.push(await acquireAddonWork(userId));
}

describe('addon work admission', () => {
  it('runs at most six builds per user and does not block a different user', async () => {
    await occupy('busy');
    const work = vi.fn(async () => 'finished');
    const pending = withAddonWork('busy', work);
    expect(await withAddonWork('other', async () => 'other')).toBe('other');
    expect(work).not.toHaveBeenCalled();
    releases.shift()!();
    expect(await pending).toBe('finished');
    expect(work).toHaveBeenCalledOnce();
  });

  it('enforces a global ceiling of 60, without head-of-line blocking by a busy user', async () => {
    for (let i = 0; i < 10; i++) await occupy(`global-${i}`);
    const busyWork = vi.fn(async () => 'busy');
    const otherWork = vi.fn(async () => 'other');
    const busy = withAddonWork('global-0', busyWork);
    const other = withAddonWork('global-new', otherWork);
    await Promise.resolve();
    expect(otherWork).not.toHaveBeenCalled();
    releases.splice(6, 1)[0]();
    expect(await other).toBe('other');
    expect(busyWork).not.toHaveBeenCalled();
    releases.shift()!();
    expect(await busy).toBe('busy');
  });

  it('bounds each user queue at 100 and expires waiting requests after five seconds', async () => {
    vi.useFakeTimers();
    await occupy('queued');
    const pending = Array.from({ length: 100 }, () =>
      acquireAddonWork('queued').catch((error: unknown) => error)
    );
    await expect(acquireAddonWork('queued')).rejects.toBeInstanceOf(AddonWorkLimitError);
    await vi.advanceTimersByTimeAsync(5000);
    expect(
      (await Promise.all(pending)).every((error) => error instanceof AddonWorkLimitError)
    ).toBe(true);
    releases.shift()!();
    expect(await withAddonWork('queued', async () => 'recovered')).toBe('recovered');
  });

  it('bounds the global queue at 500', async () => {
    vi.useFakeTimers();
    for (let i = 0; i < 10; i++) await occupy(`full-${i}`);
    const pending = Array.from({ length: 500 }, (_, i) =>
      acquireAddonWork(`waiting-${i}`).catch((error: unknown) => error)
    );
    await expect(acquireAddonWork('overflow')).rejects.toBeInstanceOf(AddonWorkLimitError);
    await vi.advanceTimersByTimeAsync(5000);
    expect(
      (await Promise.all(pending)).every((error) => error instanceof AddonWorkLimitError)
    ).toBe(true);
  });

  it('removes canceled waiters and releases capacity after failed work', async () => {
    await occupy('cancel');
    const app = express();
    app.use(requestIdMiddleware());
    const work = vi.fn(async () => 'must not run');
    app.get('/', async (_req, res) => {
      const waiting = withAddonWork('cancel', work);
      abortRequestContext();
      await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
      res.json({ ok: true });
    });
    expect((await request(app).get('/')).status).toBe(200);
    releases.shift()!();
    await expect(
      withAddonWork('cancel', async () => {
        throw new Error('failed');
      })
    ).rejects.toThrow('failed');
    expect(await withAddonWork('cancel', async () => 'recovered')).toBe('recovered');
    expect(work).not.toHaveBeenCalled();
  });

  it('serves fresh and stale cache hits during saturation and does not cache capacity errors', async () => {
    vi.useFakeTimers();
    const adapter = new MockCacheAdapter();
    const cache = new CacheWrapper(adapter);
    await cache.set('fresh', ['cached'], 60);
    await cache.set('stale', ['old'], 1);
    await vi.advanceTimersByTimeAsync(1500);
    await occupy('cached-user');
    const compute = vi.fn(async () => ['new']);
    const fetch = () => withAddonWork('cached-user', compute);
    expect(await cache.wrap('fresh', fetch, 60)).toEqual(['cached']);
    expect(await cache.wrap('stale', fetch, 1)).toEqual(['old']);
    const pending = cache.wrap('miss', fetch, 60).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toBeInstanceOf(AddonWorkLimitError);
    expect(await cache.getEntry('miss')).toBeNull();
    expect(compute).not.toHaveBeenCalled();
  });

  it('deduplicates a cold-cache build before acquiring another work slot', async () => {
    const cache = new CacheWrapper(new MockCacheAdapter());
    let finish!: (value: string[]) => void;
    const compute = vi.fn(
      () =>
        new Promise<string[]>((resolve) => {
          finish = resolve;
        })
    );
    const fetch = () => withAddonWork('dedup', compute);
    const requests = [cache.wrap('same', fetch, 60), cache.wrap('same', fetch, 60)];
    await vi.waitFor(() => expect(compute).toHaveBeenCalledOnce());
    finish(['result']);
    expect(await Promise.all(requests)).toEqual([['result'], ['result']]);
  });

  it('returns an explicit, uncacheable 429 only for capacity errors', async () => {
    const app = express();
    app.get('/', (_req, res) => {
      expect(sendAddonWorkLimit(new Error('other'), res)).toBe(false);
      sendAddonWorkLimit(new AddonWorkLimitError(), res);
    });
    const response = await request(app).get('/');
    expect(response.status).toBe(429);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['retry-after']).toBe('5');
    expect(response.body).toEqual({
      error: 'Addon work capacity exceeded',
      policy: 'addonWork',
      retryAfter: 5,
    });
  });
});
