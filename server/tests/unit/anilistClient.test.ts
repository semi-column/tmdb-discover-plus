import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { CacheWrapper } from '../../src/services/cache/CacheWrapper.ts';

const state = vi.hoisted(() => ({ cache: null as CacheWrapper | null }));
vi.mock('../../src/services/cache/index.ts', () => ({ getCache: () => state.cache }));

vi.mock('../../src/config.ts', () => ({
  config: { cache: { driver: 'memory' }, logging: { level: 'silent' } },
}));

const ok = () => new Response(JSON.stringify({ data: {} }), { status: 200 });
const limited = (retryAfter: string) =>
  new Response('{"errors":[{"status":429}]}', {
    status: 429,
    headers: { 'Retry-After': retryAfter },
  });

describe('anilistFetch rate-limit pause', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    const { CacheWrapper } = await import('../../src/services/cache/CacheWrapper.ts');
    const { MockCacheAdapter } = await import('./helpers/mocks.ts');
    state.cache = new CacheWrapper(new MockCacheAdapter());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('retries a search after local exhaustion without retaining a provider-error cache entry', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response('{"data":{"Page":{"media":[],"pageInfo":{"hasNextPage":false}}}}')
      );
    vi.stubGlobal('fetch', fetch);
    const { search } = await import('../../src/services/anilist/discover.ts');
    const { getAnilistThrottle } = await import('../../src/infrastructure/anilistThrottle.ts');
    const { withRequestAbortContext } = await import('../../src/utils/requestContext.ts');
    await getAnilistThrottle().pause(60_000);
    await expect(
      withRequestAbortContext(() => search('local-exhaustion', 'anime', 1))
    ).rejects.toMatchObject({
      code: 'ANILIST_ADMISSION_EXHAUSTED',
      statusCode: 429,
    });
    expect(fetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(61_000);
    await expect(search('local-exhaustion', 'anime', 1)).resolves.toMatchObject({
      media: [],
      hasNextPage: false,
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('holds every queued request until Retry-After elapses', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(limited('30'))
      .mockImplementation(async () => ok());
    vi.stubGlobal('fetch', fetchMock);
    const { anilistFetch } = await import('../../src/services/anilist/client.ts');

    const a = anilistFetch('query A');
    const b = anilistFetch('query B');

    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(25_000);
    await expect(Promise.all([a, b])).resolves.toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('fails fast when the pause outlasts the parent request budget', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(limited('60'))
      .mockImplementation(async () => ok());
    vi.stubGlobal('fetch', fetchMock);
    const { anilistFetch } = await import('../../src/services/anilist/client.ts');
    const { requestIdMiddleware } = await import('../../src/utils/requestContext.ts');

    const background = anilistFetch('query A');
    await vi.advanceTimersByTimeAsync(0);

    const result = await new Promise<unknown>((resolve) => {
      requestIdMiddleware()({ headers: {} } as any, { setHeader: () => {} } as any, () => {
        anilistFetch('query B').then(resolve, resolve);
      });
    });

    expect(result).toMatchObject({
      message: 'AniList local admission exhausted: deadline',
      code: 'ANILIST_ADMISSION_EXHAUSTED',
      statusCode: 429,
      rateLimitExhausted: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(61_000);
    await expect(background).resolves.toEqual({ data: {} });
  });

  it('spaces transient retries and other callers by the same attempt budget', async () => {
    const times: number[] = [];
    const fetchMock = vi.fn(async () => {
      times.push(Date.now());
      return times.length === 1 ? new Response('', { status: 500 }) : ok();
    });
    vi.stubGlobal('fetch', fetchMock);
    const { anilistFetch } = await import('../../src/services/anilist/client.ts');
    const work = Promise.all([anilistFetch('query A'), anilistFetch('query B')]);
    await vi.advanceTimersByTimeAsync(6000);
    await expect(work).resolves.toHaveLength(2);
    expect(times).toHaveLength(3);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(2100);
    expect(times[2] - times[1]).toBeGreaterThanOrEqual(2100);
  });

  it.each(['120', 'invalid', '1e308'])(
    'does not shorten a cooldown with Retry-After %s',
    async (header) => {
      const fetchMock = vi.fn().mockResolvedValueOnce(limited(header)).mockImplementation(ok);
      vi.stubGlobal('fetch', fetchMock);
      const { anilistFetch } = await import('../../src/services/anilist/client.ts');
      const result = anilistFetch('query A');
      await vi.advanceTimersByTimeAsync(59_000);
      expect(fetchMock).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(header === '120' ? 62_000 : 2000);
      await expect(result).resolves.toEqual({ data: {} });
    }
  );

  it.each(['reset', 'date', 'malformed-reset'])(
    'honors exhausted successful-response quota (%s)',
    async (kind) => {
      vi.setSystemTime(1_700_000_000_000);
      const headers: Record<string, string> = { 'x-ratelimit-remaining': '0' };
      if (kind === 'reset')
        headers['x-ratelimit-reset'] = String(Math.floor(Date.now() / 1000) + 75);
      else if (kind === 'date')
        headers['retry-after'] = new Date(Date.now() + 75_000).toUTCString();
      else headers['x-ratelimit-reset'] = 'Infinity';
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(new Response('{"data":{}}', { headers }))
        .mockImplementation(ok);
      vi.stubGlobal('fetch', fetchMock);
      const { anilistFetch } = await import('../../src/services/anilist/client.ts');
      await anilistFetch('first');
      const next = anilistFetch('second');
      await vi.advanceTimersByTimeAsync((kind === 'malformed-reset' ? 60_000 : 75_000) - 1);
      expect(fetchMock).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1);
      await expect(next).resolves.toEqual({ data: {} });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    }
  );
  it('removes a cancelled queued caller without starting its transport later', async () => {
    const fetchMock = vi.fn().mockImplementation(ok);
    vi.stubGlobal('fetch', fetchMock);
    const { anilistFetch } = await import('../../src/services/anilist/client.ts');
    const { requestIdMiddleware } = await import('../../src/utils/requestContext.ts');
    await anilistFetch('first');
    const res = Object.assign(new EventEmitter(), { writableFinished: false, setHeader() {} });
    const result = new Promise((resolve) => {
      requestIdMiddleware()({ headers: {} } as any, res as any, () => {
        anilistFetch('cancelled').then(resolve, resolve);
      });
    });
    res.emit('close');
    expect(await result).toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    null,
    { data: null, errors: [{ status: 400, message: 'validation' }] },
    { data: { Page: null }, errors: [{ status: 500 }] },
    { data: null },
    { data: {}, errors: 'invalid' },
  ])('rejects erroneous GraphQL envelopes: %j', async (body) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(body)))
    );
    const { anilistFetch } = await import('../../src/services/anilist/client.ts');
    await expect(anilistFetch('query')).rejects.toBeInstanceOf(Error);
  });

  it('accepts valid Media absence but rejects missing batch pages', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"data":{"Media":null}}'))
      .mockResolvedValueOnce(new Response('{"data":{}}'));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchAnilistMedia } = await import('../../src/services/anilist/detail.ts');
    const { browseBatch } = await import('../../src/services/anilist/discover.ts');
    await expect(fetchAnilistMedia({ anilistId: 1 })).resolves.toBeNull();
    const result = browseBatch({}, 'anime', [1, 2]).catch((error) => error);
    await vi.advanceTimersByTimeAsync(2200);
    expect(await result).toMatchObject({ statusCode: 502 });
  });

  it('coalesces and caches complete search pages with distinct type/page/query keys', async () => {
    const fetchMock = vi.fn(
      async () => new Response('{"data":{"Page":{"media":[],"pageInfo":{"hasNextPage":false}}}}')
    );
    vi.stubGlobal('fetch', fetchMock);
    const { search } = await import('../../src/services/anilist/discover.ts');
    await Promise.all([search('fixture', 'anime', 1), search('fixture', 'anime', 1)]);
    await search('fixture', 'anime', 1);
    expect(fetchMock).toHaveBeenCalledOnce();
    const remaining = Promise.all([
      search('fixture', 'movie', 1),
      search('fixture', 'anime', 2),
      search('other', 'anime', 1),
    ]);
    await vi.advanceTimersByTimeAsync(7000);
    await remaining;
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
