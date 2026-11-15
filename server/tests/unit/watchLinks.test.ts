import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getWatchStreams } from '../../src/services/watchLinks.ts';
import { getWatchLinkRegions, parseWatchTitle } from '../../src/utils/watchLinkConfig.ts';
import { tmdbFetch } from '../../src/services/tmdb/client.ts';
import type { CatalogConfig, UserConfig } from '../../src/types/config.ts';

vi.mock('../../src/services/tmdb/client.ts', () => ({
  tmdbFetch: vi.fn(),
  isInvalidApiKeyError: (error: { invalidApiKey?: boolean }) => error?.invalidApiKey === true,
}));

const provider = (provider_id: number, provider_name: string) => ({ provider_id, provider_name });
const prime = provider(9, 'Amazon Prime Video');
const amazonStore = provider(10, 'Amazon Video');
const appleSubscription = provider(350, 'Apple TV+');
const appleStore = provider(2, 'Apple TV Store');
const netflix = provider(8, 'Netflix');
const netflixAds = provider(1796, 'Netflix with Ads');
const peacock = provider(386, 'Peacock Premium');
const peacockPlus = provider(387, 'Peacock Premium Plus');
const tubi = provider(73, 'Tubi');

function catalog(overrides: Partial<CatalogConfig> = {}): CatalogConfig {
  return {
    _id: 'included',
    name: 'My subscriptions',
    type: 'movie',
    source: 'tmdb',
    filters: {
      watchRegion: 'US',
      watchProviders: [8, 9, 350, 386],
      watchMonetizationTypes: ['flatrate'],
    },
    ...overrides,
  };
}

const makeConfig = (catalogs = [catalog()]): UserConfig => ({
  userId: 'watch-links-test',
  catalogs,
  preferences: { enableWatchLinks: true },
});

beforeEach(() => vi.resetAllMocks());

describe('watch link configuration', () => {
  it('requires explicit opt-in and an enabled TMDB movie/series country', () => {
    expect(getWatchLinkRegions(null)).toEqual([]);
    expect(getWatchLinkRegions({ ...makeConfig(), preferences: {} })).toEqual([]);
    expect(
      getWatchLinkRegions(
        makeConfig([
          catalog({ enabled: false }),
          catalog({ source: 'imdb' }),
          catalog({ type: 'anime' }),
          catalog({ filters: { ...catalog().filters, listType: 'popular' } }),
          catalog({ filters: { watchRegion: 'US/elsewhere' } }),
          catalog({ filters: { watchRegion: 123 as any } }),
        ])
      )
    ).toEqual([]);
  });

  it('keeps country selections separate and never treats rental/free/mixed catalogs as subscriptions', () => {
    const regions = getWatchLinkRegions(
      makeConfig([
        catalog(),
        catalog({ type: 'series' }),
        catalog({
          filters: { watchRegion: 'us', watchProviders: [10], watchMonetizationTypes: ['rent'] },
        }),
        catalog({
          filters: {
            watchRegion: 'US',
            watchProviders: [73],
            watchMonetizationTypes: ['free', 'ads'],
          },
        }),
        catalog({
          filters: {
            watchRegion: 'US',
            watchProviders: [2],
            watchMonetizationTypes: ['flatrate', 'buy'],
          },
        }),
        catalog({
          filters: { watchRegion: 'GB', watchProviders: [9], watchMonetizationType: 'flatrate' },
        }),
        catalog({
          filters: {
            watchRegion: 'US',
            watchProviders: [999],
            watchMonetizationTypes: ['flatrate'],
            watchMonetizationType: 'rent',
          },
        }),
      ])
    );
    expect(regions.map((r) => [r.country, [...r.subscriptionProviders]])).toEqual([
      ['US', [8, 9, 350, 386]],
      ['GB', [9]],
    ]);
  });

  it.each([
    ['movie', 'tt1234567:1:2'],
    ['series', 'tt1234567:1'],
    ['series', 'tt1234567:1:0'],
    ['movie', 'tmdb:123?path=other'],
    ['movie', 'tmdb:0'],
    ['anime', 'tt1234567'],
    ['movie', '../settings'],
    ['movie', 'tt1234567/elsewhere'],
  ])('rejects unsupported title %s/%s before any network request', async (type, id) => {
    expect(parseWatchTitle(type, id)).toBeNull();
    expect(await getWatchStreams(makeConfig(), 'test-key', type, id)).toEqual({
      streams: [],
      cacheMaxAge: 0,
    });
    expect(tmdbFetch).not.toHaveBeenCalled();
  });
});

describe('viewing offer classification', () => {
  it('does not call an Amazon or Apple rental included in Prime/Apple TV+', async () => {
    vi.mocked(tmdbFetch).mockResolvedValue({
      id: 123,
      results: { US: { rent: [amazonStore, appleStore], buy: [amazonStore] } },
    });
    const result = await getWatchStreams(makeConfig(), 'test-key', 'movie', 'tmdb:123');
    expect(result.streams.map((s) => s.name)).toEqual([
      'RENT / BUY · 2 services',
      'MORE · All viewing options',
    ]);
    expect(result.streams[0].description).toContain('Costs extra');
    expect(result.streams[0].description).toContain('Amazon Video, Apple TV Store');
  });

  it('requires a live flatrate offer for the exact selected provider and plan', async () => {
    vi.mocked(tmdbFetch).mockResolvedValue({
      id: 123,
      results: {
        US: {
          flatrate: [prime, appleSubscription, netflixAds, peacockPlus],
          rent: [netflix],
          ads: [tubi],
        },
      },
    });
    const { streams, cacheMaxAge } = await getWatchStreams(
      makeConfig(),
      'test-key',
      'movie',
      'tmdb:123'
    );
    expect(streams.map((s) => s.name)).toEqual([
      'INCLUDED · 2 services',
      'FREE WITH ADS · Tubi',
      'RENT / BUY · Netflix',
      'MORE · All viewing options',
    ]);
    expect(streams[0].description).toContain('Amazon Prime Video, Apple TV+');
    expect(streams[0].description).not.toMatch(/Netflix|Peacock/);
    expect(cacheMaxAge).toBe(300);
    for (const stream of streams) {
      expect(stream.externalUrl).toBe('https://www.themoviedb.org/movie/123/watch?locale=US');
      expect(stream.description).toContain('JustWatch data');
      expect(stream).not.toHaveProperty('url');
    }
  });

  it('looks up the exact IMDb media type and labels episode links as series availability', async () => {
    vi.mocked(tmdbFetch)
      .mockResolvedValueOnce({ movie_results: [{ id: 999 }], tv_results: [{ id: 456 }] })
      .mockResolvedValueOnce({ id: 456, results: { US: { flatrate: [netflix] } } });
    const { streams } = await getWatchStreams(makeConfig(), 'test-key', 'series', 'tt1234567:1:2');
    expect(tmdbFetch).toHaveBeenNthCalledWith(1, '/find/tt1234567', 'test-key', {
      external_source: 'imdb_id',
    });
    expect(tmdbFetch).toHaveBeenNthCalledWith(2, '/tv/456/watch/providers', 'test-key');
    expect(streams[0].name).toBe('SERIES · Netflix');
    expect(streams[0].description).toContain('confirm this episode');
    expect(streams[0].externalUrl).toBe('https://www.themoviedb.org/tv/456/watch?locale=US');
  });

  it('accepts TMDB episode IDs and keeps free offers separate from advertising', async () => {
    vi.mocked(tmdbFetch).mockResolvedValue({
      id: 456,
      results: { US: { free: [tubi], ads: [tubi, provider(300, 'Pluto TV')] } },
    });
    const { streams } = await getWatchStreams(makeConfig(), 'test-key', 'series', 'tmdb:456:0:1');
    expect(tmdbFetch).toHaveBeenCalledWith('/tv/456/watch/providers', 'test-key');
    expect(streams.map((s) => s.name)).toEqual([
      'FREE · Tubi',
      'FREE WITH ADS · Pluto TV',
      'MORE · All viewing options',
    ]);
    expect(streams[0].description).toContain('Series availability');
  });

  it('never transfers a selected subscription or availability from another country', async () => {
    vi.mocked(tmdbFetch).mockResolvedValue({
      id: 123,
      results: {
        US: { flatrate: [netflix], rent: [amazonStore] },
        GB: { flatrate: [netflix, prime] },
      },
    });
    const config = makeConfig([
      catalog(),
      catalog({
        filters: { watchRegion: 'GB', watchProviders: [9], watchMonetizationTypes: ['flatrate'] },
      }),
    ]);
    const { streams } = await getWatchStreams(config, 'test-key', 'movie', 'tmdb:123');
    const us = streams.filter((s) => s.externalUrl.endsWith('=US'));
    const gb = streams.filter((s) => s.externalUrl.endsWith('=GB'));
    expect(us[0].name).toBe('INCLUDED · Netflix');
    expect(gb[0].name).toBe('INCLUDED · Amazon Prime Video');
    expect(tmdbFetch).toHaveBeenCalledTimes(1);
  });

  it('does not reuse one user’s included labels for a different user of the same title', async () => {
    vi.mocked(tmdbFetch).mockResolvedValue({
      id: 123,
      results: { US: { flatrate: [netflix, peacock] } },
    });
    const first = await getWatchStreams(makeConfig(), 'test-key', 'movie', 'tmdb:123');
    const second = await getWatchStreams(
      makeConfig([
        catalog({
          filters: { watchRegion: 'US', watchProviders: [8], watchMonetizationTypes: ['flatrate'] },
        }),
      ]),
      'test-key',
      'movie',
      'tmdb:123'
    );
    expect(first.streams[0].name).toBe('INCLUDED · 2 services');
    expect(second.streams[0].name).toBe('INCLUDED · Netflix');
  });

  it('does not trust a provider-supplied external URL or an unrelated country', async () => {
    vi.mocked(tmdbFetch).mockResolvedValue({
      id: 123,
      results: {
        US: { link: 'https://attacker.example/', flatrate: [netflix] },
        CA: { flatrate: [prime] },
      },
    });
    const { streams } = await getWatchStreams(makeConfig(), 'test-key', 'movie', 'tmdb:123');
    expect(streams[0].externalUrl).toBe('https://www.themoviedb.org/movie/123/watch?locale=US');
    expect(streams.every((s) => !s.description.includes('CA'))).toBe(true);
  });

  it('never infers subscription access from a catalog or missing availability', async () => {
    vi.mocked(tmdbFetch).mockResolvedValue({ id: 123, results: {} });
    const { streams } = await getWatchStreams(makeConfig(), 'test-key', 'movie', 'tmdb:123');
    expect(streams.map((s) => s.name)).toEqual(['MORE · All viewing options']);
  });
});

describe('unknown availability', () => {
  it.each([
    { id: 999, results: { US: { flatrate: [netflix] } } },
    { id: 123, results: null },
  ])('rejects mismatched or malformed offers instead of claiming included access', async (data) => {
    vi.mocked(tmdbFetch).mockResolvedValue(data);
    const result = await getWatchStreams(makeConfig(), 'test-key', 'movie', 'tmdb:123');
    expect(result.cacheMaxAge).toBe(0);
    expect(result.streams.map((s) => s.name)).toEqual(['CHECK · Where to watch']);
    expect(result.streams[0].description).toContain('could not be confirmed');
  });

  it('retains a manual lookup after an outage and does not cache it as no offers', async () => {
    vi.mocked(tmdbFetch).mockRejectedValue(new Error('TMDB unavailable'));
    const result = await getWatchStreams(makeConfig(), 'test-key', 'movie', 'tmdb:123');
    expect(result.cacheMaxAge).toBe(0);
    expect(result.streams[0].name).toBe('CHECK · Where to watch');
    expect(result.streams[0].externalUrl).toContain('/movie/123/watch?locale=US');
  });

  it('uses the exact IMDb page when a movie cannot be resolved, never an unrelated series ID', async () => {
    vi.mocked(tmdbFetch).mockResolvedValue({ movie_results: [], tv_results: [{ id: 456 }] });
    const result = await getWatchStreams(makeConfig(), 'test-key', 'movie', 'tt1234567');
    expect(result.streams[0].name).toBe('CHECK · Where to watch');
    expect(result.streams[0].externalUrl).toBe('https://www.imdb.com/title/tt1234567/');
    expect(tmdbFetch).toHaveBeenCalledTimes(1);
  });

  it('preserves API credential errors for the route’s existing 401 response', async () => {
    const error = Object.assign(new Error('Invalid API key'), { invalidApiKey: true });
    vi.mocked(tmdbFetch).mockRejectedValue(error);
    await expect(getWatchStreams(makeConfig(), 'test-key', 'movie', 'tmdb:123')).rejects.toBe(
      error
    );
  });
});
