import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/cache/index.ts', () => ({
  getCache: vi.fn(() => ({
    getEntry: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    setError: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
  })),
}));

vi.mock('../../src/infrastructure/tmdbThrottle.ts', () => ({
  getTmdbThrottle: vi.fn(() => ({
    acquire: vi.fn().mockResolvedValue(undefined),
  })),
}));

import {
  tmdbFetch,
  getCircuitBreakerState,
  resetCircuitBreaker,
} from '../../src/services/tmdb/client.ts';
import { getCache } from '../../src/services/cache/index.ts';
import { CACHE_TTLS } from '../../src/cacheTtls.ts';
import { CacheWrapper } from '../../src/services/cache/CacheWrapper.ts';
import { MockCacheAdapter } from './helpers/mocks.ts';

const mockFetch = vi.fn();

describe('TMDB Circuit Breaker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mockFetch);
    resetCircuitBreaker();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('starts in closed state', () => {
    expect(getCircuitBreakerState().state).toBe('closed');
  });

  it.each([
    ['/discover/movie', {}, CACHE_TTLS.CATALOG_SERVER_DISCOVER],
    ['/discover/tv', {}, CACHE_TTLS.CATALOG_SERVER_DISCOVER],
    ['/trending/movie/day', {}, CACHE_TTLS.TMDB_API_RESPONSE],
    ['/movie/550', { release_date: '1999-10-15' }, CACHE_TTLS.DETAIL],
    ['/movie/551', { release_date: '2999-01-01' }, CACHE_TTLS.TMDB_RECENT_DETAIL],
    ['/movie/552', {}, CACHE_TTLS.TMDB_RECENT_DETAIL],
    ['/tv/1399', { status: 'Ended' }, CACHE_TTLS.DETAIL],
    ['/tv/1400', { status: 'Returning Series' }, CACHE_TTLS.TMDB_API_RESPONSE],
    ['/tv/1399/season/1', {}, CACHE_TTLS.TMDB_API_RESPONSE],
    ['/movie/550/images', {}, CACHE_TTLS.LOGO],
    ['/configuration', {}, CACHE_TTLS.TMDB_REFERENCE],
    ['/genre/movie/list', {}, CACHE_TTLS.TMDB_REFERENCE],
  ])('uses the endpoint-specific cache TTL for %s', async (endpoint, data, ttl) => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => data });
    await tmdbFetch(endpoint, 'test-key', {}, 0);
    const cache = vi.mocked(getCache).mock.results.at(-1)!.value;
    expect(cache.set).toHaveBeenCalledWith(expect.any(String), data, ttl);
  });

  it('shares and coalesces equivalent discovery recipes across API keys and filter order', async () => {
    const data = { results: [{ id: 550 }] };
    mockFetch.mockResolvedValue({ ok: true, json: async () => data });
    const first = tmdbFetch('/discover/movie', 'key-a', {
      language: 'en',
      with_genres: '28,12',
      page: 1,
    });
    const second = tmdbFetch('/discover/movie', 'key-b', {
      page: 1,
      with_genres: '12,28',
      language: 'en',
    });
    expect(await Promise.all([first, second])).toEqual([data, data]);
    expect(mockFetch).toHaveBeenCalledOnce();
    const cache = vi.mocked(getCache).mock.results.at(-1)!.value;
    const key = cache.set.mock.calls[0][0];
    expect(key).not.toContain('key-a');
    expect(key).not.toContain('key-b');
    expect(new URL(mockFetch.mock.calls[0][0]).searchParams.get('with_genres')).toBe('28,12');
  });

  it('reuses stored discovery results for another user with an equivalent recipe', async () => {
    const cache = new CacheWrapper(new MockCacheAdapter());
    vi.mocked(getCache).mockReturnValueOnce(cache).mockReturnValueOnce(cache);
    const data = { results: [{ id: 550 }] };
    mockFetch.mockResolvedValue({ ok: true, json: async () => data });
    await tmdbFetch('/discover/movie', 'user-a-key', {
      with_watch_providers: '8|9',
      watch_region: 'US',
    });
    expect(
      await tmdbFetch('/discover/movie', 'user-b-key', {
        watch_region: 'US',
        with_watch_providers: '9|8',
      })
    ).toEqual(data);
    expect(mockFetch).toHaveBeenCalledOnce();
    expect(cache.getStats()).toMatchObject({ hits: 1, misses: 1 });
  });

  it.each([
    [{ with_genres: '12,28' }, { with_genres: '12|28' }],
    [{ language: 'en' }, { language: 'fr' }],
    [{ watch_region: 'US' }, { watch_region: 'GB' }],
    [{ page: 1 }, { page: 2 }],
    [{ include_adult: false }, { include_adult: true }],
  ])('keeps different discovery semantics isolated: %j and %j', async (first, second) => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ results: [{ id: 1 }] }) });
    await Promise.all([
      tmdbFetch('/discover/movie', 'key', first, 0),
      tmdbFetch('/discover/movie', 'key', second, 0),
    ]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    new TypeError('fetch failed', {
      cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
    }),
    new TypeError('fetch failed', {
      cause: Object.assign(new Error('Connect timeout'), { code: 'UND_ERR_CONNECT_TIMEOUT' }),
    }),
    Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }),
  ])('retries a transient native fetch failure: %s', async (error) => {
    vi.useFakeTimers();
    const data = { results: [{ id: 1 }] };
    mockFetch
      .mockReset()
      .mockRejectedValueOnce(error)
      .mockResolvedValue({
        ok: true,
        json: async () => data,
      });

    const result = tmdbFetch('/movie/popular', 'test-key', {}, 1).catch((failure) => failure);
    await vi.runAllTimersAsync();

    expect(await result).toEqual(data);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(getCircuitBreakerState().recentFailures).toBe(0);
  });

  it('stops after the retry budget and records one circuit failure', async () => {
    vi.useFakeTimers();
    const error = new TypeError('fetch failed', {
      cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
    });
    mockFetch.mockReset().mockRejectedValue(error);

    const result = tmdbFetch('/movie/popular', 'test-key', {}, 2).catch((failure) => failure);
    await vi.runAllTimersAsync();

    expect(await result).toBe(error);
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(getCircuitBreakerState().recentFailures).toBe(1);
  });

  it.each([401, 403, 404])('does not retry HTTP %s', async (status) => {
    mockFetch.mockReset().mockResolvedValue({
      ok: false,
      status,
      json: async () => ({ status_message: 'Request rejected' }),
    });

    await expect(tmdbFetch('/movie/popular', 'test-key', {}, 2)).rejects.toMatchObject({
      statusCode: status,
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(getCircuitBreakerState().recentFailures).toBe(0);
  });

  it('does not retry a fetch failure caused by an invalid certificate', async () => {
    const error = new TypeError('fetch failed', {
      cause: Object.assign(new Error('Certificate expired'), { code: 'CERT_HAS_EXPIRED' }),
    });
    mockFetch.mockReset().mockRejectedValue(error);

    await expect(tmdbFetch('/movie/popular', 'test-key', {}, 2)).rejects.toBe(error);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('opens after threshold failures', async () => {
    mockFetch.mockRejectedValue(Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' }));

    for (let i = 0; i < 10; i++) {
      try {
        await tmdbFetch('/movie/popular', 'test-key', {}, 0);
      } catch {
        // expected
      }
    }

    const state = getCircuitBreakerState();
    expect(state.state).toBe('open');
    expect(state.recentFailures).toBeGreaterThanOrEqual(10);
  });

  it('throws immediately when circuit is open', async () => {
    mockFetch.mockRejectedValue(Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' }));

    for (let i = 0; i < 10; i++) {
      try {
        await tmdbFetch('/movie/popular', 'k', {}, 0);
      } catch {
        // expected
      }
    }

    expect(getCircuitBreakerState().state).toBe('open');
    mockFetch.mockClear();

    await expect(tmdbFetch('/movie/popular', 'test-key', {}, 0)).rejects.toThrow(
      'circuit breaker is open'
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not trip on 404 errors', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ status_message: 'Not Found' }),
    } as any);

    for (let i = 0; i < 12; i++) {
      try {
        await tmdbFetch('/movie/missing', 'test-key', {}, 0);
      } catch {
        // expected
      }
    }

    expect(getCircuitBreakerState().state).toBe('closed');
  });

  it('does not trip on 400 errors', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ status_message: 'Bad Request' }),
    } as any);

    for (let i = 0; i < 12; i++) {
      try {
        await tmdbFetch('/bad', 'test-key', {}, 0);
      } catch {
        // expected
      }
    }

    expect(getCircuitBreakerState().state).toBe('closed');
  });

  it('trips on 500 errors', async () => {
    mockFetch.mockRejectedValue(new Error('TMDB API retryable error: 500'));

    for (let i = 0; i < 10; i++) {
      try {
        await tmdbFetch('/movie/popular', 'test-key', {}, 0);
      } catch {
        // expected
      }
    }

    expect(getCircuitBreakerState().state).toBe('open');
  });

  it('resets after successful request', async () => {
    mockFetch.mockRejectedValue(Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' }));

    for (let i = 0; i < 5; i++) {
      try {
        await tmdbFetch('/fail', 'k', {}, 0);
      } catch {
        // expected
      }
    }

    expect(getCircuitBreakerState().recentFailures).toBeGreaterThan(0);

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ id: 1 }] }),
    } as any);

    await tmdbFetch('/movie/popular', 'test-key', {}, 0);

    const state = getCircuitBreakerState();
    expect(state.state).toBe('closed');
    expect(state.recentFailures).toBe(0);
  });
});
