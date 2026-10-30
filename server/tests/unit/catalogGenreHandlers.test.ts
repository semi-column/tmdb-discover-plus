import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const {
  mockCacheGet,
  mockCacheSet,
  mockCacheWrap,
  mockGetUserConfig,
  mockConvertToMeta,
  mockAnilistBrowse,
  mockImdbAdvancedSearch,
  mockImdbToMeta,
  mockKitsuDiscover,
  mockMalDiscover,
  mockSimklDiscover,
  mockTmdbResolve,
  mockTmdbDiscover,
  mockTmdbDetails,
  mockTmdbToMeta,
  mockTmdbGetDetails,
  mockTmdbFullMeta,
  mockBuildArtworkOptions,
} = vi.hoisted(() => ({
  mockCacheGet: vi.fn(),
  mockCacheSet: vi.fn(),
  mockCacheWrap: vi.fn(),
  mockGetUserConfig: vi.fn(),
  mockConvertToMeta: vi.fn(),
  mockAnilistBrowse: vi.fn(),
  mockImdbAdvancedSearch: vi.fn(),
  mockImdbToMeta: vi.fn(),
  mockKitsuDiscover: vi.fn(),
  mockMalDiscover: vi.fn(),
  mockSimklDiscover: vi.fn(),
  mockTmdbResolve: vi.fn(),
  mockTmdbDiscover: vi.fn(),
  mockTmdbDetails: vi.fn(),
  mockTmdbToMeta: vi.fn(),
  mockTmdbGetDetails: vi.fn(),
  mockTmdbFullMeta: vi.fn(),
  mockBuildArtworkOptions: vi.fn(),
}));

vi.mock('../../src/services/cache/index.ts', () => ({
  getCache: () => ({ get: mockCacheGet, set: mockCacheSet, wrap: mockCacheWrap }),
}));

vi.mock('../../src/services/configService.ts', () => ({
  getUserConfig: mockGetUserConfig,
  getApiKeyFromConfig: () => 'test-api-key',
  getSimklKeyFromConfig: () => null,
}));

vi.mock('../../src/services/artworkService.ts', () => ({
  createArtworkOptions: () => null,
  resolveContentType: (type: string) => type,
  applyArtworkOverridesToMetaPreviews: async (metas: unknown[]) => metas,
  requiresAsyncArtworkResolution: () => false,
}));

vi.mock('../../src/services/anilist/index.ts', () => ({
  browse: mockAnilistBrowse,
  batchConvertToStremioMeta: mockConvertToMeta,
}));

vi.mock('../../src/services/imdb/index.ts', () => ({
  isImdbApiEnabled: () => true,
  advancedSearch: mockImdbAdvancedSearch,
  imdbToStremioMeta: mockImdbToMeta,
}));

vi.mock('../../src/services/tmdb/index.ts', () => ({
  batchResolveAndFetchDetails: mockTmdbResolve,
  batchGetDetails: mockTmdbDetails,
  batchGetCinemetaRatings: async () => null,
  discover: mockTmdbDiscover,
  toStremioMetaPreview: mockTmdbToMeta,
  getDetails: mockTmdbGetDetails,
  toStremioFullMeta: mockTmdbFullMeta,
}));

vi.mock('../../src/services/kitsu/index.ts', () => ({
  discover: mockKitsuDiscover,
  batchConvertToStremioMeta: mockConvertToMeta,
}));

vi.mock('../../src/services/mal/index.ts', () => ({
  discover: mockMalDiscover,
  batchConvertToStremioMeta: mockConvertToMeta,
}));

vi.mock('../../src/services/mal/discover.ts', () => ({ randomPageWithin: () => 1 }));

vi.mock('../../src/services/simkl/index.ts', () => ({
  discover: mockSimklDiscover,
  batchConvertToStremioMeta: mockConvertToMeta,
}));

vi.mock('../../src/config.ts', () => ({
  config: {
    logging: { level: 'error', format: 'text' },
    addon: { variant: '' },
    simklApi: { clientId: '' },
  },
}));

vi.mock('../../src/constants.ts', () => ({
  buildCatalogId: (_source: string, catalog: { catalogId: string }) => catalog.catalogId,
  DISPLAY: { IMDB_PAGE_SIZE: 20 },
  normalizeBaseUrl: () => 'https://example.test',
}));

vi.mock('../../src/cacheTtls.ts', () => ({
  CACHE_ERROR_TTLS: {
    EMPTY_RESULT: 60,
    RATE_LIMITED: 900,
    TEMPORARY_ERROR: 120,
    PERMANENT_ERROR: 1800,
  },
  CACHE_LIMITS: { ERROR_DEDUP_MAX_SIZE: 50 },
  CACHE_TTLS: {
    CATALOG_HEADER: 60,
    CATALOG_STALE_IF_ERROR: 60,
    CATALOG_STALE_REVALIDATE: 60,
    META_HEADER: 86_400,
    META_STALE_REVALIDATE: 172_800,
  },
  CACHE_STORAGE: { WRAPPER_RETENTION_MULTIPLIER: 2.5, WRAPPER_STALE_MULTIPLIER: 2 },
  LOCAL_CACHE_TTLS: { ERROR_DEDUP: 60_000 },
  catalogServerTtl: () => 60,
}));

vi.mock('../../src/utils/helpers.ts', () => ({
  getBaseUrl: () => 'https://example.test',
  logSwallowedError: vi.fn(),
  normalizeGenreName: (value: string) => value.toLowerCase(),
  parseIdArray: () => [],
  setNoCacheHeaders: vi.fn(),
  shuffleArray: <T>(items: T[]) => items,
}));

vi.mock('../../src/utils/encryption.ts', () => ({ decrypt: () => null }));

vi.mock('../../src/routes/handlers/sharedHelpers.ts', () => ({
  buildArtworkOptions: mockBuildArtworkOptions,
  getPlaceholderUrls: () => ({ posterPlaceholder: 'placeholder' }),
}));

vi.mock('../../src/services/sources/registry.ts', () => ({ getAllSources: () => [] }));
vi.mock('../../src/services/tmdb/referenceData.ts', () => ({ SORT_OPTIONS: {} }));
vi.mock('../../src/services/animeIdMap/index.ts', () => ({ getEntryByPrefixedId: () => null }));

import { handleAnilistCatalogRequest } from '../../src/routes/handlers/anilistHandler.ts';
import { handleImdbCatalogRequest } from '../../src/routes/handlers/imdbHandler.ts';
import { handleKitsuCatalogRequest } from '../../src/routes/handlers/kitsuHandler.ts';
import { handleMalCatalogRequest } from '../../src/routes/handlers/malHandler.ts';
import { handleSimklCatalogRequest } from '../../src/routes/handlers/simklHandler.ts';
import { addonRouter } from '../../src/routes/addon.ts';
import { etagMiddleware } from '../../src/utils/etag.ts';
import { CacheWrapper } from '../../src/services/cache/CacheWrapper.ts';
import { MockCacheAdapter } from './helpers/mocks.ts';

const genrelessMeta = { id: 'genreless', genres: [] };
const knownGenreMeta = { id: 'known', genres: ['Drama'] };

const sourceHandlers = [
  { source: 'anilist', type: 'anime', handler: handleAnilistCatalogRequest },
  { source: 'imdb', type: 'movie', handler: handleImdbCatalogRequest },
  { source: 'kitsu', type: 'anime', handler: handleKitsuCatalogRequest },
  { source: 'mal', type: 'anime', handler: handleMalCatalogRequest },
  { source: 'simkl', type: 'anime', handler: handleSimklCatalogRequest },
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  mockBuildArtworkOptions.mockReturnValue(null);
  mockCacheGet.mockResolvedValue(null);
  mockCacheSet.mockResolvedValue(undefined);
  mockCacheWrap.mockImplementation((_key, loader) => loader());
  mockConvertToMeta.mockReturnValue([genrelessMeta, knownGenreMeta]);
  mockAnilistBrowse.mockResolvedValue({ media: [{}], hasNextPage: false });
  mockImdbAdvancedSearch.mockResolvedValue({
    titles: [
      { id: 'tt0000001', primaryTitle: 'Genreless' },
      { id: 'tt0000002', primaryTitle: 'Drama' },
    ],
    totalResults: 2,
  });
  mockImdbToMeta.mockImplementation((title: { id: string }) =>
    title.id === 'tt0000001' ? genrelessMeta : knownGenreMeta
  );
  mockKitsuDiscover.mockResolvedValue({ anime: [{}], hasMore: false, total: 1 });
  mockMalDiscover.mockResolvedValue({ anime: [{}], hasMore: false, total: 1, lastPage: 1 });
  mockSimklDiscover.mockResolvedValue({ items: [{}], hasMore: false });
  mockTmdbResolve.mockResolvedValue({ resolvedIds: new Map(), detailsMap: new Map() });
  mockTmdbDiscover.mockResolvedValue({ results: [{ id: 1 }, { id: 2 }] });
  mockTmdbDetails.mockResolvedValue(
    new Map([
      [1, { id: 1 }],
      [2, { id: 2 }],
    ])
  );
  mockTmdbToMeta.mockImplementation((details: { id: number }) =>
    details.id === 1 ? genrelessMeta : knownGenreMeta
  );
});

describe.each(sourceHandlers)('$source catalog handler', ({ source, type, handler }) => {
  it.each([true, false])(
    'applies the catalog flag when excludeUnknownGenres=$enabled',
    async (enabled) => {
      const catalogId = `${source}-genre-test`;
      mockGetUserConfig.mockResolvedValue({
        preferences: { excludeUnknownGenres: !enabled },
        baseUrl: 'https://example.test',
        catalogs: [
          {
            catalogId,
            source,
            type,
            name: 'Genre test',
            enabled: true,
            filters: { excludeUnknownGenres: enabled },
          },
        ],
      });

      const res = { json: vi.fn(), set: vi.fn(), etagJson: vi.fn() };
      await handler('test-user', type, catalogId, {}, res as never, {} as never);

      const body = res.etagJson.mock.calls[0]?.[0] ?? res.json.mock.calls[0]?.[0];
      expect(body.metas.map((meta: { id: string }) => meta.id)).toEqual(
        enabled ? ['known'] : ['genreless', 'known']
      );
    }
  );
});

describe('TMDB catalog route', () => {
  it.each([true, false])(
    'applies the catalog flag when excludeUnknownGenres=$enabled',
    async (enabled) => {
      const catalogId = 'tmdb-genre-test';
      mockGetUserConfig.mockResolvedValue({
        preferences: { excludeUnknownGenres: !enabled },
        baseUrl: 'https://example.test',
        catalogs: [
          {
            catalogId,
            source: 'tmdb',
            type: 'movie',
            name: 'Genre test',
            enabled: true,
            filters: { excludeUnknownGenres: enabled, stremioExtraMode: 'sortBy' },
          },
        ],
      });

      const app = express();
      app.use(etagMiddleware);
      app.use(addonRouter);
      const response = await request(app).get(`/testuser/catalog/movie/${catalogId}.json`);

      expect(response.status).toBe(200);
      expect(response.body.metas.map((meta: { id: string }) => meta.id)).toEqual(
        enabled ? ['known'] : ['genreless', 'known']
      );
    }
  );
});

describe('metadata route cache dependencies', () => {
  it('survives unrelated config edits but invalidates relevant settings and isolates users', async () => {
    const adapter = new MockCacheAdapter();
    const cache = new CacheWrapper(adapter);
    const read = vi.spyOn(adapter, 'get');
    mockCacheWrap.mockImplementation(cache.wrap.bind(cache));
    const config = {
      updatedAt: '2026-10-26T00:00:00Z',
      preferences: { region: 'US', defaultLanguage: 'en' },
      catalogs: [{ catalogId: 'movies', type: 'movie', name: 'Movies', enabled: true }],
    };
    mockGetUserConfig.mockImplementation(async () => structuredClone(config));
    mockTmdbGetDetails.mockResolvedValue({
      id: 550,
      external_ids: { imdb_id: 'tt0137523' },
      images: { logos: [{ file_path: '/logo.png' }] },
    });
    mockTmdbFullMeta.mockResolvedValue({
      id: 'tt0137523',
      poster: 'https://images.test/poster.jpg',
    });
    const app = express();
    app.use(addonRouter);
    const fetchMeta = async (user = 'testuser') => {
      const response = await request(app).get(`/${user}/meta/movie/tmdb:550.json`);
      expect(response.status).toBe(200);
      expect(response.body.meta.id).toBe('tt0137523');
    };

    await fetchMeta();
    expect(read).toHaveBeenCalledTimes(1);
    expect(mockTmdbGetDetails).toHaveBeenCalledTimes(1);
    config.updatedAt = '2026-10-30T00:00:00Z';
    config.catalogs[0].name = 'Renamed';
    await fetchMeta();
    expect(read).toHaveBeenCalledTimes(2);
    expect(mockTmdbGetDetails).toHaveBeenCalledTimes(1);

    config.preferences.region = 'GB';
    await fetchMeta();
    expect(mockTmdbGetDetails).toHaveBeenCalledTimes(2);
    config.preferences.defaultLanguage = 'fr';
    await fetchMeta();
    expect(mockTmdbGetDetails).toHaveBeenCalledTimes(3);
    config.catalogs[0].enabled = false;
    await fetchMeta();
    expect(mockTmdbGetDetails).toHaveBeenCalledTimes(4);
    mockBuildArtworkOptions.mockReturnValue({ poster: { service: 'rpdb', apiKey: 'secret' } });
    await fetchMeta();
    expect(mockTmdbGetDetails).toHaveBeenCalledTimes(5);
    await fetchMeta('otheruser');
    expect(mockTmdbGetDetails).toHaveBeenCalledTimes(6);
    expect(read).toHaveBeenCalledTimes(7);
  });
});
