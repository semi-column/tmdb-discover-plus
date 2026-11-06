import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CacheWrapper, CachedError } from '../../src/services/cache/CacheWrapper.ts';
import { MockCacheAdapter } from './helpers/mocks.ts';
import { setLogSink } from '../../src/utils/logger.ts';
import { abortRequestContext, withRequestAbortContext } from '../../src/utils/requestContext.ts';

const state = vi.hoisted(() => ({
  cache: null as CacheWrapper | null,
  acquire: vi.fn(),
}));
vi.mock('../../src/services/cache/index.ts', () => ({ getCache: () => state.cache }));
vi.mock('../../src/infrastructure/tmdbThrottle.ts', () => ({
  getTmdbThrottle: () => ({ acquire: state.acquire, notifyRateLimited: vi.fn() }),
  RATE_LIMITER_TIMEOUT_CODE: 'RATE_LIMITER_TIMEOUT',
}));

import {
  tmdbFetch,
  getCircuitBreakerState,
  validateApiKeyCached,
} from '../../src/services/tmdb/client.ts';
import { getDetails } from '../../src/services/tmdb/details.ts';

beforeEach(() => {
  state.cache = new CacheWrapper(new MockCacheAdapter());
  state.acquire.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setLogSink(null);
});

describe('TMDB negative caching', () => {
  it.each([
    '/search/movie',
    '/search/tv',
    '/search/person',
    '/search/company',
    '/search/collection',
    '/search/keyword',
  ])('rejects oversized %s queries before cache, pacing or transport', async (endpoint) => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const read = vi.spyOn(state.cache!, 'wrap');
    await expect(tmdbFetch(endpoint, 'test-key', { query: 'x'.repeat(501) })).rejects.toMatchObject(
      {
        code: 'VALIDATION_ERROR',
        statusCode: 400,
      }
    );
    expect(read).not.toHaveBeenCalled();
    expect(state.acquire).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['x'.repeat(500), '\u{1f600}'.repeat(500)])(
    'preserves valid 500-character query boundaries',
    async (query) => {
      const fetch = vi.fn().mockResolvedValue(new Response('{"results":[]}'));
      vi.stubGlobal('fetch', fetch);
      await expect(tmdbFetch('/search/movie', 'test-key', { query }, 0)).resolves.toEqual({
        results: [],
      });
      expect(fetch).toHaveBeenCalledOnce();
      expect(new URL(String(fetch.mock.calls[0][0])).searchParams.get('query')).toBe(query);
    }
  );

  it('restarts validation for a healthy waiter when its producer is cancelled', async () => {
    const started = Promise.withResolvers<void>();
    const cancel = Promise.withResolvers<void>();
    const fetch = vi
      .fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockImplementationOnce((_input, init) => {
        started.resolve();
        if (!init?.signal) throw new Error('Expected cancellation signal');
        const signal = init.signal;
        return new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        );
      })
      .mockResolvedValue(new Response('{"configuration":true}'));
    vi.stubGlobal('fetch', fetch);
    const producer = withRequestAbortContext(async () => {
      const work = validateApiKeyCached('cancelled-producer-fixture-key').catch((error) => error);
      await cancel.promise;
      abortRequestContext();
      return work;
    });
    await started.promise;
    const waiter = withRequestAbortContext(() =>
      validateApiKeyCached('cancelled-producer-fixture-key')
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    cancel.resolve();
    expect(await producer).toMatchObject({ name: 'AbortError' });
    await expect(waiter).resolves.toEqual({ valid: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not cancel validation when only a waiter leaves', async () => {
    const started = Promise.withResolvers<void>();
    const reply = Promise.withResolvers<Response>();
    const cancel = Promise.withResolvers<void>();
    const fetch = vi.fn(() => {
      started.resolve();
      return reply.promise;
    });
    vi.stubGlobal('fetch', fetch);
    const producer = withRequestAbortContext(() =>
      validateApiKeyCached('cancelled-waiter-fixture-key')
    );
    await started.promise;
    const waiter = withRequestAbortContext(async () => {
      const work = validateApiKeyCached('cancelled-waiter-fixture-key').catch((error) => error);
      await cancel.promise;
      abortRequestContext();
      return work;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    cancel.resolve();
    expect(await waiter).toMatchObject({ name: 'AbortError' });
    reply.resolve(new Response('{"configuration":true}'));
    await expect(producer).resolves.toEqual({ valid: true });
    await expect(validateApiKeyCached('cancelled-waiter-fixture-key')).resolves.toEqual({
      valid: true,
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('coalesces concurrent credential validation without sharing validity between keys', async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ configuration: true }),
    }));
    vi.stubGlobal('fetch', fetch);
    await Promise.all(
      Array.from({ length: 10 }, () => validateApiKeyCached('coalesced-fixture-key'))
    );
    expect(fetch).toHaveBeenCalledOnce();
    await validateApiKeyCached('different-fixture-key');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('does not cache shared admission outages or count them as TMDB circuit failures', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    state.acquire.mockRejectedValue(
      Object.assign(new Error('Shared admission unavailable'), {
        code: 'SHARED_ADMISSION_UNAVAILABLE',
        statusCode: 503,
      })
    );
    const initialFailures = getCircuitBreakerState().recentFailures;
    for (let i = 0; i < 2; i++) {
      await expect(tmdbFetch('/movie/555003', 'test-key', {}, 0)).rejects.toMatchObject({
        code: 'SHARED_ADMISSION_UNAVAILABLE',
        statusCode: 503,
      });
    }
    expect(state.acquire).toHaveBeenCalledTimes(2);
    expect(fetch).not.toHaveBeenCalled();
    expect(getCircuitBreakerState().recentFailures).toBe(initialFailures);
    expect(await state.cache!.getEntry('https://api.themoviedb.org/3/movie/555003')).toBeNull();
  });

  it('makes one HTTP request for repeated missing details and recovers after expiry', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ status_message: 'The resource you requested could not be found.' }),
    });
    vi.stubGlobal('fetch', fetch);
    const errors: string[] = [];
    setLogSink((level, _context, message) => {
      if (level === 'error') errors.push(message);
    });
    for (let i = 0; i < 3; i++) {
      expect(await getDetails('test-key', 294275, 'series')).toBeNull();
    }
    expect(fetch).toHaveBeenCalledOnce();
    expect(errors).toEqual([]);
    now.mockReturnValue(4_600_000);
    fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 294275 }) });
    expect(await getDetails('test-key', 294275, 'series')).toEqual({ id: 294275 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('preserves a 503 status through retries and the next negative-cache hit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
      })
    );
    await expect(tmdbFetch('/movie/555001', 'test-key', {}, 0)).rejects.toMatchObject({
      statusCode: 503,
    });
    await expect(tmdbFetch('/movie/555001', 'test-key', {}, 0)).rejects.toMatchObject({
      name: 'CachedError',
      errorType: 'TEMPORARY_ERROR',
      statusCode: 503,
    });
    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });

  it('returns a typed missing-resource error to callers other than getDetails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ status_message: 'Missing' }),
      })
    );
    await expect(tmdbFetch('/collection/555002', 'test-key', {}, 0)).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(tmdbFetch('/collection/555002', 'test-key', {}, 0)).rejects.toBeInstanceOf(
      CachedError
    );
    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });
});
