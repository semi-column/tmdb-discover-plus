import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFetch, mockConfig, cacheGet, cacheGetEntry, cacheSet, cacheSetError, throttleAcquire } =
  vi.hoisted(() => ({
    mockFetch: vi.fn(),
    mockConfig: {
      imdbApi: {
        apiKey: 'test-key',
        apiHost: 'imdb-api.semicolumn.workers.dev',
        apiKeyHeader: 'x-rapidapi-key',
        apiHostHeader: 'x-rapidapi-host',
        rateLimit: 5,
      },
      addon: {
        variant: 'nightly',
      },
      baseUrl: 'https://tmdb-nightly.elfhosted.com',
      logging: { level: 'info', format: 'text' },
      nodeEnv: 'test',
    },
    cacheGet: vi.fn(),
    cacheGetEntry: vi.fn(),
    cacheSet: vi.fn(),
    cacheSetError: vi.fn(),
    throttleAcquire: vi.fn(),
  }));

vi.mock('../../src/config.ts', () => ({
  config: mockConfig,
}));

vi.mock('../../src/services/cache/index.ts', () => ({
  getCache: vi.fn(() => ({
    get: cacheGet,
    getEntry: cacheGetEntry,
    set: cacheSet,
    setError: cacheSetError,
  })),
}));

vi.mock('../../src/infrastructure/imdbThrottle.ts', () => ({
  getImdbThrottle: vi.fn(() => ({
    acquire: throttleAcquire,
  })),
  RATE_LIMITER_TIMEOUT_CODE: 'RATE_LIMITER_TIMEOUT',
}));

vi.mock('../../src/utils/requestContext.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/utils/requestContext.ts')>()),
  getRequestId: vi.fn(() => 'req-test-1'),
}));

import {
  getImdbCircuitBreakerState,
  imdbFetch,
  resetImdbCircuitBreaker,
} from '../../src/services/imdb/client.ts';
import { CIRCUIT_BREAKER_DEFAULTS } from '../../src/constants.ts';

describe('imdb client outbound caller headers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mockFetch);
    resetImdbCircuitBreaker();
    cacheGet.mockResolvedValue(null);
    cacheSet.mockResolvedValue(undefined);
    cacheSetError.mockResolvedValue(undefined);
    throttleAcquire.mockResolvedValue(undefined);
    mockConfig.addon.variant = 'nightly';
    mockConfig.baseUrl = 'https://tmdb-nightly.elfhosted.com';

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('sends attribution headers with nightly variant and host label', async () => {
    await imdbFetch('/api/imdb/genres', {}, 120, 0);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, options] = mockFetch.mock.calls[0] as [string, { headers: Record<string, string> }];
    const headers = options.headers;

    expect(headers['x-tmdbdp-source']).toBe('tmdb-discover-plus');
    expect(headers['x-tmdbdp-variant']).toBe('nightly');
    expect(headers['x-tmdbdp-caller']).toBe('nightly:tmdb-nightly.elfhosted.com');
    expect(headers['x-rapidapi-key']).toBe('test-key');
    expect(headers['x-rapidapi-host']).toBe('imdb-api.semicolumn.workers.dev');
  });

  it('falls back to stable:unknown when variant and base url are not set', async () => {
    mockConfig.addon.variant = '';
    mockConfig.baseUrl = '';

    await imdbFetch('/api/imdb/genres', {}, 120, 0);

    const [, options] = mockFetch.mock.calls[0] as [string, { headers: Record<string, string> }];
    const headers = options.headers;

    expect(headers['x-tmdbdp-variant']).toBe('stable');
    expect(headers['x-tmdbdp-caller']).toBe('stable:unknown');
  });

  it('does not trip the IMDb circuit breaker for a local limiter timeout', async () => {
    throttleAcquire.mockRejectedValue(
      Object.assign(new Error('Rate limiter timeout'), { code: 'RATE_LIMITER_TIMEOUT' })
    );

    await expect(imdbFetch('/api/imdb/genres', {}, 120, 0)).rejects.toThrow('Rate limiter timeout');

    expect(mockFetch).not.toHaveBeenCalled();
    expect(
      (await import('../../src/services/imdb/client.ts')).getImdbCircuitBreakerState()
    ).toMatchObject({ state: 'closed', recentFailures: 0 });
  });

  it('serves cached data without refreshing while the circuit is open', async () => {
    mockFetch.mockRejectedValue(Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' }));
    for (let i = 0; i < CIRCUIT_BREAKER_DEFAULTS.THRESHOLD; i++) {
      await expect(imdbFetch('/api/imdb/fail', {}, 120, 0)).rejects.toThrow('ECONNREFUSED');
    }
    expect(getImdbCircuitBreakerState().state).toBe('open');
    mockFetch.mockClear();
    throttleAcquire.mockClear();
    cacheGet.mockClear();

    const cached = { title: { id: 'tt1' } };
    cacheGet.mockImplementation(async (key: string) =>
      key === 'imdb:/api/imdb/cached' ? cached : null
    );

    expect(await imdbFetch('/api/imdb/cached', {}, 120, 0, { maxStaleAgeMs: 21_600_000 })).toEqual(
      cached
    );
    expect(cacheGet).not.toHaveBeenCalledWith('imdb:fresh:/api/imdb/cached');
    expect(cacheGetEntry).not.toHaveBeenCalled();
    await expect(imdbFetch('/api/imdb/uncached', {}, 120, 0)).rejects.toMatchObject({
      message: 'IMDb circuit breaker is open',
      statusCode: 503,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockFetch).not.toHaveBeenCalled();
    expect(throttleAcquire).not.toHaveBeenCalled();
  });

  it('reuses a historical season without starting a refresh before its longer freshness limit', async () => {
    const episodes = { title: { episodes: { episodes: { edges: [] } } } };
    cacheGet.mockImplementation(async (key: string) =>
      key.startsWith('imdb:fresh:') ? null : episodes
    );
    cacheGetEntry.mockResolvedValue({
      __cacheWrapper: true,
      __storedAt: Date.now() - 15 * 86_400_000,
      __ttl: 14 * 86_400,
      data: episodes,
    });

    expect(
      await imdbFetch('/api/imdb/tt1234567/episodes', { season: 1 }, 604_800, 0, {
        maxStaleAgeMs: 21 * 86_400_000,
      })
    ).toEqual(episodes);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
