import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CacheWrapper } from '../../src/services/cache/CacheWrapper.ts';
import { AdmissionRedis } from '../../src/infrastructure/sharedAdmission.ts';
import { AnilistThrottle } from '../../src/infrastructure/anilistThrottle.ts';
import { RedisTokenBucket, TokenBucket } from '../../src/infrastructure/tmdbThrottle.ts';
import { acquireAddonWork, RedisAddonWork, withAddonWork } from '../../src/utils/addonWork.ts';
import {
  getBackgroundWorkStats,
  getRequestSignal,
  skipOpportunisticWork,
  startOpportunisticWork,
  withRequestAbortContext,
} from '../../src/utils/requestContext.ts';
import { MockCacheAdapter } from './helpers/mocks.ts';

const flags = vi.hoisted(() => ({
  demandFirst: true,
  backgroundPriority: true,
  disableRateLimit: false,
}));
vi.mock('../../src/config.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/config.ts')>();
  return { ...actual, config: { ...actual.config, features: flags } };
});

beforeEach(() => {
  flags.backgroundPriority = true;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('opportunistic background work', () => {
  it('can disable background prioritization for rollback', async () => {
    flags.backgroundPriority = false;
    const gate = Promise.withResolvers<void>();
    const work = Array.from({ length: 3 }, () => startOpportunisticWork(() => gate.promise));
    try {
      expect(work.every(Boolean)).toBe(true);
      expect(getBackgroundWorkStats()).toMatchObject({ enabled: false, active: 0 });
    } finally {
      gate.resolve();
      await Promise.all(work.map((item) => item?.promise));
    }
  });

  it('bounds stale refreshes without blocking an uncached foreground build', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const cache = new CacheWrapper(new MockCacheAdapter());
    await Promise.all(['a', 'b', 'c'].map((key) => cache.set(key, 'old', 1)));
    now.mockReturnValue(2500);
    const gates = [Promise.withResolvers<string>(), Promise.withResolvers<string>()];
    const loaders = [
      vi.fn(() => gates[0].promise),
      vi.fn(() => gates[1].promise),
      vi.fn(async () => 'should not run'),
    ];

    expect(
      await Promise.all(['a', 'b', 'c'].map((key, i) => cache.wrap(key, loaders[i], 1)))
    ).toEqual(['old', 'old', 'old']);
    expect(loaders[2]).not.toHaveBeenCalled();
    expect(getBackgroundWorkStats().active).toBe(2);
    expect(await cache.wrap('foreground', async () => 'new', 60)).toBe('new');
    gates.forEach((gate) => gate.resolve('refreshed'));
    await vi.waitFor(() => expect(getBackgroundWorkStats().active).toBe(0));
  });

  it('retries a foreground follower when the background owner is skipped', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const cache = new CacheWrapper(new MockCacheAdapter());
    await cache.set('key', 'stale', 1);
    now.mockReturnValue(2500);
    const gate = Promise.withResolvers<void>();
    await cache.wrap(
      'key',
      async () => {
        await gate.promise;
        return skipOpportunisticWork('busy');
      },
      1
    );
    const foreground = cache.wrap('key', async () => 'foreground', 60, { allowStale: false });
    await vi.waitFor(() => expect(cache.getStats().deduplicatedRequests).toBe(1));
    gate.resolve();

    expect(await foreground).toBe('foreground');
    expect(await cache.get('key')).toBe('foreground');
  });

  it('isolates skipped background cancellation from the parent request', async () => {
    await withRequestAbortContext(async () => {
      const foreground = getRequestSignal()!;
      const background = startOpportunisticWork(async () => skipOpportunisticWork('busy'))!;
      await expect(background.promise).rejects.toMatchObject({ code: 'OPPORTUNISTIC_SKIPPED' });
      expect(background.signal.aborted).toBe(true);
      expect(foreground.aborted).toBe(false);
    });
  });

  it('reserves the last per-user work slot for foreground requests', async () => {
    const releases = [];
    try {
      for (let i = 0; i < 5; i++) releases.push(await acquireAddonWork('priority-user'));
      const background = startOpportunisticWork(() =>
        withAddonWork('priority-user', async () => 'background')
      )!;
      await expect(background.promise).rejects.toMatchObject({ code: 'OPPORTUNISTIC_SKIPPED' });
      releases.push(await acquireAddonWork('priority-user'));
    } finally {
      await Promise.all(releases.map((release) => release()));
    }
  });

  it('does not queue background provider calls or consume the last local token', async () => {
    const bucket = new TokenBucket({ maxTokens: 2, refillRate: 0.0001 });
    bucket.endWarmup();
    bucket.tokens = 1;
    try {
      const background = startOpportunisticWork(() => bucket.acquire())!;
      await expect(background.promise).rejects.toMatchObject({ code: 'OPPORTUNISTIC_SKIPPED' });
      expect(bucket.getStats().queueDepth).toBe(0);
      await expect(bucket.acquire()).resolves.toBeUndefined();
    } finally {
      bucket.destroy();
    }
  });

  it('uses reduced shared addon limits and never retries a denied background grant', async () => {
    const redis = new AdmissionRedis('redis://127.0.0.1:1');
    const evaluate = vi.spyOn(redis, 'eval').mockResolvedValueOnce(0).mockResolvedValue(1);
    try {
      const work = new RedisAddonWork(redis);
      const background = startOpportunisticWork(() => work.acquire('shared-user'))!;
      await expect(background.promise).rejects.toMatchObject({ code: 'OPPORTUNISTIC_SKIPPED' });
      expect(evaluate).toHaveBeenCalledTimes(1);
      expect(evaluate.mock.calls[0][2].slice(3)).toEqual(['59', '5']);

      const release = await work.acquire('shared-user');
      expect(evaluate.mock.calls[1][2].slice(3)).toEqual(['60', '6']);
      await release();
    } finally {
      redis.close();
    }
  });

  it('does not queue background calls in the shared provider budget', async () => {
    const redis = new AdmissionRedis('redis://127.0.0.1:1');
    const evaluate = vi.spyOn(redis, 'eval').mockResolvedValueOnce(250).mockResolvedValue(0);
    const bucket = new RedisTokenBucket(redis, { maxTokens: 5, refillRate: 5 });
    try {
      const background = startOpportunisticWork(() => bucket.acquire())!;
      await expect(background.promise).rejects.toMatchObject({ code: 'OPPORTUNISTIC_SKIPPED' });
      expect(evaluate).toHaveBeenCalledTimes(1);
      expect(bucket.getStats().queueDepth).toBe(0);
      await expect(bucket.acquire()).resolves.toBeUndefined();
    } finally {
      bucket.destroy();
      redis.close();
    }
  });

  it('skips an AniList background refresh during the shared cooldown', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const throttle = new AnilistThrottle();
    try {
      await throttle.acquire();
      const background = startOpportunisticWork(() => throttle.acquire())!;
      await expect(background.promise).rejects.toMatchObject({ code: 'OPPORTUNISTIC_SKIPPED' });
      now.mockReturnValue(3101);
      await expect(throttle.acquire()).resolves.toBeUndefined();
    } finally {
      throttle.destroy();
    }
  });
});
