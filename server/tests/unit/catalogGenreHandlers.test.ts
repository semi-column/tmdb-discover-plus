import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  mockTmdbEpisodes,
  mockTmdbSpecialList,
  mockBuildArtworkOptions,
  mockValidateApiKeyCached,
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
  mockTmdbEpisodes: vi.fn(),
  mockTmdbSpecialList: vi.fn(),
  mockBuildArtworkOptions: vi.fn(),
  mockValidateApiKeyCached: vi.fn(),
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
  validateApiKeyCached: mockValidateApiKeyCached,
  isInvalidApiKeyError: () => false,
  batchResolveAndFetchDetails: mockTmdbResolve,
  batchGetDetails: mockTmdbDetails,
  batchGetCinemetaRatings: async () => null,
  discover: mockTmdbDiscover,
  toStremioMetaPreview: mockTmdbToMeta,
  getDetails: mockTmdbGetDetails,
  toStremioFullMeta: mockTmdbFullMeta,
  getSeriesEpisodes: mockTmdbEpisodes,
  fetchSpecialList: mockTmdbSpecialList,
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
    cache: { redisUrl: '' },
    features: { disableRateLimit: true },
    addon: { variant: '' },
    simklApi: { clientId: '' },
  },
}));

vi.mock('../../src/constants.ts', () => ({
  buildCatalogId: (_source: string, catalog: { catalogId: string }) => catalog.catalogId,
  DISPLAY: { IMDB_PAGE_SIZE: 20, TMDB_PAGE_SIZE: 20 },
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
    META_ACTIVE_SERIES: 21_600,
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
import {
  CacheWrapper,
  CachedError,
  INCOMPLETE_RESULT,
} from '../../src/services/cache/CacheWrapper.ts';
import { MockCacheAdapter } from './helpers/mocks.ts';
import { AppError, ErrorCodes } from '../../src/utils/AppError.ts';
import { setLogSink } from '../../src/utils/logger.ts';
import { requestIdMiddleware, abortRequestContext } from '../../src/utils/requestContext.ts';
import { acquireAddonWork } from '../../src/utils/addonWork.ts';
import { config as serverConfig } from '../../src/config.ts';
import {
  apiRateLimit,
  addonRateLimit,
  addonUserRateLimit,
  invalidAddonRateLimit,
} from '../../src/utils/rateLimit.ts';

const genrelessMeta = { id: 'genreless', genres: [] };
const knownGenreMeta = { id: 'known', genres: ['Drama'] };
afterEach(() => setLogSink(null));

const sourceHandlers = [
  { source: 'anilist', type: 'anime', handler: handleAnilistCatalogRequest },
  { source: 'imdb', type: 'movie', handler: handleImdbCatalogRequest },
  { source: 'kitsu', type: 'anime', handler: handleKitsuCatalogRequest },
  { source: 'mal', type: 'anime', handler: handleMalCatalogRequest },
  { source: 'simkl', type: 'anime', handler: handleSimklCatalogRequest },
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  mockTmdbGetDetails.mockReset();
  mockTmdbFullMeta.mockReset();
  mockTmdbEpisodes.mockReset();
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
  mockValidateApiKeyCached.mockResolvedValue({ valid: true });
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
  it('does not cache an empty error fallback as successful catalog data', async () => {
    mockGetUserConfig.mockResolvedValue({
      preferences: {},
      catalogs: [{ catalogId: `${source}-failed`, type, filters: {} }],
    });
    for (const fetch of [
      mockAnilistBrowse,
      mockImdbAdvancedSearch,
      mockKitsuDiscover,
      mockMalDiscover,
      mockSimklDiscover,
    ]) {
      fetch.mockRejectedValue(new Error('Provider unavailable'));
    }
    const res = { json: vi.fn(), set: vi.fn(), etagJson: vi.fn() };
    await handler('test-user', type, `${source}-failed`, {}, res as never, {} as never);
    expect(res.json).toHaveBeenCalledWith({ metas: [] });
    expect(res.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.set).toHaveBeenCalledWith('X-Catalog-Status', 'degraded');
  });
  it('serves a cached response even when the user has six active builds', async () => {
    const releases = await Promise.all(
      Array.from({ length: 6 }, () => acquireAddonWork('cached-source'))
    );
    mockGetUserConfig.mockResolvedValue({
      preferences: {},
      catalogs: [{ catalogId: `${source}-cached`, type, filters: {} }],
    });
    mockCacheGet.mockResolvedValue({ metas: [knownGenreMeta] });
    mockCacheWrap.mockResolvedValue([knownGenreMeta]);
    const res = { json: vi.fn(), set: vi.fn(), etagJson: vi.fn() };
    try {
      await handler('cached-source', type, `${source}-cached`, {}, res as never, {} as never);
      const body = res.etagJson.mock.calls[0]?.[0] ?? res.json.mock.calls[0]?.[0];
      expect(body.metas).toEqual([knownGenreMeta]);
      for (const upstream of [
        mockAnilistBrowse,
        mockImdbAdvancedSearch,
        mockKitsuDiscover,
        mockMalDiscover,
        mockSimklDiscover,
      ]) {
        expect(upstream).not.toHaveBeenCalled();
      }
    } finally {
      releases.forEach((release) => release());
    }
  });

  it.each(['cold', 'search', 'random'])(
    'rejects %s work explicitly when capacity stays full',
    async (mode) => {
      vi.useFakeTimers();
      const releases = await Promise.all(
        Array.from({ length: 6 }, () => acquireAddonWork('full-source'))
      );
      mockGetUserConfig.mockResolvedValue({
        preferences: {},
        catalogs: [
          { catalogId: `${source}-full`, type, filters: { randomize: mode === 'random' } },
        ],
      });
      serverConfig.simklApi.clientId = 'test-simkl-key';
      const res = { json: vi.fn(), set: vi.fn(), etagJson: vi.fn(), status: vi.fn() };
      res.status.mockReturnValue(res);
      try {
        const pending = handler(
          'full-source',
          type,
          mode === 'search' ? `${source}-search-${type}` : `${source}-full`,
          mode === 'search' ? { search: 'test' } : {},
          res as never,
          {} as never
        );
        await vi.advanceTimersByTimeAsync(5000);
        await pending;
        expect(res.status).toHaveBeenCalledWith(429);
        expect(res.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ policy: 'addonWork' }));
        expect(mockCacheSet).not.toHaveBeenCalled();
      } finally {
        releases.forEach((release) => release());
        serverConfig.simklApi.clientId = '';
        vi.useRealTimers();
      }
    }
  );

  it('does not send a second response after cancellation while loading config', async () => {
    mockGetUserConfig.mockImplementationOnce(async () => {
      abortRequestContext();
      return null;
    });
    const res = { json: vi.fn(), set: vi.fn(), etagJson: vi.fn(), setHeader: vi.fn() };
    await new Promise<void>((resolve, reject) => {
      requestIdMiddleware()({ headers: {} } as any, res as any, () => {
        handler('test-user', type, `${source}-test`, {}, res as never, {} as never).then(
          resolve,
          reject
        );
      });
    });
    expect(res.json).not.toHaveBeenCalled();
    expect(res.set).not.toHaveBeenCalled();
  });

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

describe('IMDb catalog demand', () => {
  it('fetches and enriches the next page only when it is requested', async () => {
    mockGetUserConfig.mockResolvedValue({
      preferences: {},
      catalogs: [{ catalogId: 'imdb-demand', type: 'movie', filters: {} }],
    });
    const res = { json: vi.fn(), set: vi.fn(), etagJson: vi.fn() };

    await handleImdbCatalogRequest(
      'test-user',
      'movie',
      'imdb-demand',
      {},
      res as never,
      {} as never
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockImdbAdvancedSearch.mock.calls.map((call) => call[2])).toEqual([0]);
    expect(mockTmdbResolve).toHaveBeenCalledTimes(1);
    expect(res.etagJson.mock.calls[0][0].metas).toEqual([genrelessMeta, knownGenreMeta]);

    await handleImdbCatalogRequest(
      'test-user',
      'movie',
      'imdb-demand',
      { skip: '20' },
      res as never,
      {} as never
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockImdbAdvancedSearch.mock.calls.map((call) => call[2])).toEqual([0, 20]);
    expect(mockTmdbResolve).toHaveBeenCalledTimes(2);
  });

  it('can restore next-page enrichment when demand-first fetching is disabled', async () => {
    Object.assign(serverConfig.features, { demandFirst: false });
    try {
      mockGetUserConfig.mockResolvedValue({
        preferences: {},
        catalogs: [{ catalogId: 'imdb-demand', type: 'movie', filters: {} }],
      });
      const res = { json: vi.fn(), set: vi.fn(), etagJson: vi.fn() };
      await handleImdbCatalogRequest(
        'test-user',
        'movie',
        'imdb-demand',
        {},
        res as never,
        {} as never
      );
      await vi.waitFor(() => expect(mockImdbAdvancedSearch).toHaveBeenCalledTimes(2));
      expect(mockImdbAdvancedSearch.mock.calls.map((call) => call[2])).toEqual([0, 20]);
    } finally {
      Object.assign(serverConfig.features, { demandFirst: true });
    }
  });
});

describe('TMDB catalog route', () => {
  it.each([10000, 10020])(
    'returns exhaustion for skip=%i without fetching TMDB catalogs',
    async (skip) => {
      mockGetUserConfig.mockResolvedValue({
        preferences: {},
        catalogs: [{ catalogId: 'movies', type: 'movie', filters: {} }],
      });
      const app = express();
      app.use(addonRouter);
      const response = await request(app).get(`/testuser/catalog/movie/movies/skip=${skip}.json`);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ metas: [] });
      expect(mockTmdbDiscover).not.toHaveBeenCalled();
      expect(mockTmdbDetails).not.toHaveBeenCalled();
    }
  );

  it('returns a visible validation error for a negative offset', async () => {
    mockGetUserConfig.mockResolvedValue({ preferences: {}, catalogs: [] });
    const app = express();
    app.use(addonRouter);
    const response = await request(app).get('/testuser/catalog/movie/movies/skip=-20.json');
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(mockTmdbDiscover).not.toHaveBeenCalled();
  });
  it('wires burst and invalid-ID protection through the actual addon router', async () => {
    const ip = '198.51.100.77';
    serverConfig.features.disableRateLimit = false;
    mockGetUserConfig.mockResolvedValue({
      preferences: {},
      catalogs: [{ catalogId: 'movies', type: 'movie', filters: {} }],
    });
    mockCacheWrap.mockResolvedValue([knownGenreMeta]);
    const app = express();
    app.set('trust proxy', 1);
    app.use(apiRateLimit);
    app.use(addonRouter);
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    try {
      for (let i = 0; i < 12; i++) {
        const responses = await Promise.all(
          Array.from({ length: 50 }, () =>
            request(server).get('/burstuser/catalog/movie/movies.json').set('X-Forwarded-For', ip)
          )
        );
        expect(responses.every((response) => response.status === 200)).toBe(true);
      }
      expect(mockTmdbDiscover).not.toHaveBeenCalled();
      mockGetUserConfig.mockResolvedValue(null);
      for (let i = 0; i < 30; i++) {
        const id = i < 10 ? 'x' : `missing${i}`;
        const response = await request(server)
          .get(`/${id}/catalog/movie/movies.json`)
          .set('X-Forwarded-For', ip);
        expect(response.status).toBe(i < 10 ? 400 : 200);
      }
      const lookups = mockGetUserConfig.mock.calls.length;
      const rejected = await request(server)
        .get('/missing-next/catalog/movie/movies.json')
        .set('X-Forwarded-For', ip);
      expect(rejected.status).toBe(429);
      expect(rejected.body.policy).toBe('addonInvalid');
      expect(mockGetUserConfig).toHaveBeenCalledTimes(lookups);
    } finally {
      serverConfig.features.disableRateLimit = true;
      for (const limiter of [apiRateLimit, addonRateLimit, invalidAddonRateLimit])
        limiter.resetKey(ip);
      addonUserRateLimit.resetKey('burstuser');
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });

  it('rejects invalid keys on manifest and catalog requests', async () => {
    mockGetUserConfig.mockResolvedValue({ preferences: {}, catalogs: [] });
    mockValidateApiKeyCached.mockResolvedValue({
      valid: false,
      invalidApiKey: true,
      error: 'Invalid API key',
    });
    const app = express();
    app.use(addonRouter);

    for (const path of [
      '/testuser/manifest.json',
      '/testuser/catalog/movie/movies.json',
      '/testuser/meta/movie/tmdb:550.json',
    ]) {
      const response = await request(app).get(path);
      expect(response.status).toBe(401);
      expect(response.body.code).toBe('INVALID_API_KEY');
    }
  });

  it('returns 503 when key validity cannot be verified', async () => {
    mockGetUserConfig.mockResolvedValue({ preferences: {}, catalogs: [] });
    mockValidateApiKeyCached.mockResolvedValue({
      valid: false,
      unavailable: true,
      error: 'TMDB unavailable',
    });
    const app = express();
    app.use(addonRouter);

    const response = await request(app).get('/testuser/catalog/movie/movies.json');
    expect(response.status).toBe(503);
    expect(response.body.code).toBe('TMDB_UNAVAILABLE');
  });

  it('returns an explicit validation error on every request for an invalid collection', async () => {
    const warnings: Array<Record<string, unknown> | null> = [];
    setLogSink((_level, _context, message, data) => {
      if (message === 'Invalid catalog configuration') warnings.push(data);
    });
    const cache = new CacheWrapper(new MockCacheAdapter());
    mockCacheWrap.mockImplementation(cache.wrap.bind(cache));
    mockTmdbSpecialList.mockRejectedValue(
      new AppError(
        400,
        ErrorCodes.VALIDATION_ERROR,
        'A valid collection ID is required for collection list type'
      )
    );
    mockGetUserConfig.mockResolvedValue({
      preferences: {},
      catalogs: [
        {
          catalogId: 'tmdb-invalid',
          type: 'movie',
          name: 'Invalid',
          filters: { listType: 'collection' },
        },
      ],
    });
    const app = express();
    app.use(addonRouter);
    for (let i = 0; i < 2; i++) {
      const response = await request(app).get('/testuser/catalog/movie/tmdb-invalid.json');
      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    }
    expect(mockTmdbSpecialList).toHaveBeenCalledTimes(2);
    expect(warnings).toHaveLength(2);
    for (const warning of warnings) {
      expect(warning).toMatchObject({
        classification: 'user_config',
        code: 'VALIDATION_ERROR',
        error: { statusCode: 400 },
      });
    }
  });

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
  it.each([
    ['series', 'Returning Series', 21_600],
    ['series', 'Ended', 86_400],
    ['anime', 'RELEASING', 21_600],
    ['anime', 'FINISHED', 86_400],
    ['anime', 'CANCELLED', 86_400],
    ['movie', 'Released', 86_400],
  ] as const)(
    'advertises the appropriate freshness for %s with status %s',
    async (type, status, expectedTtl) => {
      const cache = new CacheWrapper(new MockCacheAdapter());
      mockCacheWrap.mockImplementation(cache.wrap.bind(cache));
      mockGetUserConfig.mockResolvedValue({ preferences: {}, catalogs: [] });
      mockTmdbGetDetails.mockResolvedValue({ id: 550, images: { logos: [{}] } });
      mockTmdbEpisodes.mockResolvedValue([]);
      mockTmdbFullMeta.mockResolvedValue({ id: 'tmdb:550', poster: 'poster', status });
      const app = express();
      app.use(etagMiddleware);
      app.use(addonRouter);

      const response = await request(app).get(`/testuser/meta/${type}/tmdb:550.json`);
      expect(response.status).toBe(200);
      expect(response.body.cacheMaxAge).toBe(expectedTtl);
      expect(response.headers['cache-control']).toContain(`max-age=${expectedTtl}`);
    }
  );

  it('restores the original active-series response TTL when demand-first fetching is disabled', async () => {
    Object.assign(serverConfig.features, { demandFirst: false });
    try {
      const cache = new CacheWrapper(new MockCacheAdapter());
      mockCacheWrap.mockImplementation(cache.wrap.bind(cache));
      mockGetUserConfig.mockResolvedValue({ preferences: {}, catalogs: [] });
      mockTmdbGetDetails.mockResolvedValue({ id: 550, images: { logos: [{}] } });
      mockTmdbEpisodes.mockResolvedValue([]);
      mockTmdbFullMeta.mockResolvedValue({
        id: 'tmdb:550',
        poster: 'poster',
        status: 'Returning Series',
      });
      const app = express();
      app.use(etagMiddleware);
      app.use(addonRouter);

      const response = await request(app).get('/testuser/meta/series/tmdb:550.json');
      expect(response.status).toBe(200);
      expect(response.body.cacheMaxAge).toBe(86_400);
    } finally {
      Object.assign(serverConfig.features, { demandFirst: true });
    }
  });

  it('serves incomplete episodes without caching the aggregate or advertising cacheable hints', async () => {
    const cache = new CacheWrapper(new MockCacheAdapter());
    const wrap = vi.spyOn(cache, 'wrap');
    mockCacheWrap.mockImplementation(cache.wrap.bind(cache));
    mockGetUserConfig.mockResolvedValue({ preferences: {}, catalogs: [] });
    mockTmdbGetDetails.mockResolvedValue({ id: 550, images: { logos: [{}] } });
    const episodes = [{ id: 'tt0137523:1:1', season: 1, episode: 1, thumbnail: 'thumbnail' }];
    Object.defineProperty(episodes, INCOMPLETE_RESULT, { value: true });
    mockTmdbEpisodes.mockResolvedValue(episodes);
    mockTmdbFullMeta.mockImplementation(async () => ({
      id: 'tt0137523',
      poster: 'poster',
      videos: episodes,
    }));
    const app = express();
    app.use(etagMiddleware);
    app.use(addonRouter);
    for (let i = 0; i < 2; i++) {
      const response = await request(app).get('/testuser/meta/series/tmdb:550.json');
      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['x-metadata-status']).toBe('degraded');
      expect(response.body).toMatchObject({
        meta: { videos: episodes },
        cacheMaxAge: 0,
        staleRevalidate: 0,
        staleError: 0,
      });
      expect(await cache.getEntry(wrap.mock.calls[0][0])).toBeNull();
    }
    expect(mockTmdbGetDetails).toHaveBeenCalledTimes(2);
  });
  it.each(['NOT_FOUND', 'TEMPORARY_ERROR', 'RATE_LIMITED'] as const)(
    'respects cached %s without deleting or recomputing metadata',
    async (errorType) => {
      mockGetUserConfig.mockResolvedValue({ preferences: {}, catalogs: [] });
      const cache = new CacheWrapper(new MockCacheAdapter());
      mockCacheWrap.mockImplementation(cache.wrap.bind(cache));
      const failure = new CachedError(errorType, 'upstream unavailable');
      mockTmdbGetDetails.mockRejectedValueOnce(failure);
      const app = express();
      app.use(addonRouter);
      // A lower-level negative hit must not trigger a bypass and a second compute.
      const response = await request(app).get('/testuser/meta/series/tmdb:294275.json');
      expect(mockTmdbGetDetails).toHaveBeenCalledOnce();
      if (errorType === 'NOT_FOUND') {
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ meta: {}, cacheMaxAge: 60 });
        expect(response.headers['x-metadata-status']).toBe('not-found');
      } else {
        expect(response.status).toBe(503);
        expect(response.headers['cache-control']).toBe('no-store');
        expect(response.body.code).toBe('TMDB_UNAVAILABLE');
      }
    }
  );

  it('keeps an outer negative entry and retries a previously missing title after expiry', async () => {
    const adapter = new MockCacheAdapter();
    const cache = new CacheWrapper(adapter);
    const remove = vi.spyOn(cache, 'del');
    const wrap = vi.spyOn(cache, 'wrap');
    mockCacheWrap.mockImplementation(cache.wrap.bind(cache));
    mockGetUserConfig.mockResolvedValue({ preferences: {}, catalogs: [] });
    mockTmdbGetDetails.mockRejectedValue(
      Object.assign(new Error('Missing title'), { statusCode: 404 })
    );
    const app = express();
    app.use(addonRouter);
    for (let i = 0; i < 3; i++) {
      const response = await request(app).get('/testuser/meta/movie/tmdb:550.json');
      expect(response.status).toBe(200);
      expect(response.body.meta).toEqual({});
      expect(response.body.cacheMaxAge).toBe(60);
    }
    expect(remove).not.toHaveBeenCalled();
    expect(mockTmdbGetDetails).toHaveBeenCalledOnce();
    const key = wrap.mock.calls[0][0];
    const entry = await cache.getEntry(key);
    expect(entry?.__errorType).toBe('NOT_FOUND');
    if (!entry) throw new Error('Expected negative entry');
    adapter.store.set(key, { ...entry, __storedAt: Date.now() - 3_600_001 });
    mockTmdbGetDetails.mockResolvedValue({ id: 550, images: { logos: [{}] } });
    mockTmdbFullMeta.mockResolvedValue({ id: 'tmdb:550', poster: 'poster' });
    const recovered = await request(app).get('/testuser/meta/movie/tmdb:550.json');
    expect(recovered.status).toBe(200);
    expect(recovered.body.meta.id).toBe('tmdb:550');
    expect(mockTmdbGetDetails).toHaveBeenCalledTimes(2);
  });

  it('does not manufacture placeholder-only metadata for an unavailable title', async () => {
    mockGetUserConfig.mockResolvedValue({ preferences: {}, catalogs: [] });
    mockTmdbGetDetails.mockResolvedValue(null);
    const app = express();
    app.use(addonRouter);
    const response = await request(app).get('/testuser/meta/series/tmdb:294275.json');
    expect(response.body).toEqual({ meta: {}, cacheMaxAge: 60 });
    expect(response.headers['x-metadata-status']).toBe('not-found');
    expect(mockTmdbFullMeta).not.toHaveBeenCalled();
  });

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
