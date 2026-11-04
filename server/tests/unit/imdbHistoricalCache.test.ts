import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CacheWrapper } from '../../src/services/cache/CacheWrapper.ts';
import { CIRCUIT_BREAKER_DEFAULTS } from '../../src/constants.ts';
import { MockCacheAdapter } from './helpers/mocks.ts';

let cache: CacheWrapper;
vi.mock('../../src/services/cache/index.ts', () => ({ getCache: () => cache }));
vi.mock('../../src/config.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/config.ts')>();
  return {
    ...actual,
    config: {
      ...actual.config,
      imdbApi: {
        ...actual.config.imdbApi,
        apiKey: 'test-key',
        apiHost: 'imdb.example.test',
        apiKeyHeader: 'x-api-key',
        apiHostHeader: 'x-api-host',
      },
    },
  };
});
vi.mock('../../src/infrastructure/imdbThrottle.ts', () => ({
  getImdbThrottle: () => ({ acquire: vi.fn().mockResolvedValue(undefined) }),
}));

import { imdbFetch, resetImdbCircuitBreaker } from '../../src/services/imdb/client.ts';

beforeEach(() => {
  cache = new CacheWrapper(new MockCacheAdapter());
  resetImdbCircuitBreaker();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ title: { id: 'tt1234567' } }), { status: 200 }))
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('IMDb historical freshness with real cache semantics', () => {
  it('serves retained data during an outage and resumes refresh after circuit recovery', async () => {
    const start = 1_700_000_000_000;
    const now = vi.spyOn(Date, 'now').mockReturnValue(start);
    const endpoint = '/api/imdb/tt1234567/episodes';
    const ttl = 3_600;
    const cached = { title: { id: 'tt1234567' } };
    const fetch = vi.mocked(globalThis.fetch);
    expect(await imdbFetch(endpoint, { season: 1 }, ttl, 0)).toEqual(cached);

    now.mockReturnValue(start + 2 * ttl * 1000 + 1);
    fetch.mockRejectedValue(Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' }));
    for (let i = 0; i < CIRCUIT_BREAKER_DEFAULTS.THRESHOLD; i++) {
      await expect(imdbFetch('/api/imdb/unavailable', {}, ttl, 0)).rejects.toThrow('ECONNREFUSED');
    }
    fetch.mockClear();

    expect(await imdbFetch(endpoint, { season: 1 }, ttl, 0)).toEqual(cached);
    await expect(imdbFetch('/api/imdb/missing', {}, ttl, 0)).rejects.toMatchObject({
      message: 'IMDb circuit breaker is open',
      statusCode: 503,
    });
    expect(fetch).not.toHaveBeenCalled();

    now.mockReturnValue(start + 2 * ttl * 1000 + CIRCUIT_BREAKER_DEFAULTS.COOLDOWN_MS + 2);
    fetch.mockResolvedValue(new Response(JSON.stringify(cached), { status: 200 }));
    expect(await imdbFetch(endpoint, { season: 1 }, ttl, 0)).toEqual(cached);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  });

  it('avoids a refresh at day 15 only for eligible historical seasons, then refreshes after day 21', async () => {
    const start = 1_700_000_000_000;
    const now = vi.spyOn(Date, 'now').mockReturnValue(start);
    const endpoint = '/api/imdb/tt1234567/episodes';
    const ttl = 7 * 86_400;
    await imdbFetch(endpoint, { season: 1 }, ttl, 0);
    await imdbFetch(endpoint, { season: 2 }, ttl, 0);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);

    now.mockReturnValue(start + 15 * 86_400_000);
    await imdbFetch(endpoint, { season: 1 }, ttl, 0, {
      maxStaleAgeMs: 21 * 86_400_000,
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    await imdbFetch(endpoint, { season: 2 }, ttl, 0);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);

    now.mockReturnValue(start + 22 * 86_400_000);
    await imdbFetch(endpoint, { season: 1 }, ttl, 0, {
      maxStaleAgeMs: 21 * 86_400_000,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(globalThis.fetch).toHaveBeenCalledTimes(4);
  });
});
