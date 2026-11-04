import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { CacheWrapper } from '../../src/services/cache/CacheWrapper.ts';
import { MockCacheAdapter } from './helpers/mocks.ts';
import { requestIdMiddleware } from '../../src/utils/requestContext.ts';

const { fetchTmdb, fetchImdb, validateKey } = vi.hoisted(() => ({
  fetchTmdb: vi.fn(),
  fetchImdb: vi.fn(),
  validateKey: vi.fn(),
}));
let cache: CacheWrapper;

vi.mock('../../src/config.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/config.ts')>();
  return {
    ...actual,
    config: {
      ...actual.config,
      cache: { ...actual.config.cache, redisUrl: '' },
      features: { ...actual.config.features, demandFirst: true, backgroundPriority: true },
    },
  };
});
vi.mock('../../src/services/cache/index.ts', () => ({ getCache: () => cache }));
vi.mock('../../src/services/configService.ts', () => ({
  getUserConfig: async (userId: string) => ({ userId, preferences: {}, catalogs: [] }),
  getApiKeyFromConfig: () => 'test-key',
  getSimklKeyFromConfig: () => null,
}));
vi.mock('../../src/services/tmdb/client.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/tmdb/client.ts')>()),
  tmdbFetch: fetchTmdb,
  validateApiKeyCached: validateKey,
}));
vi.mock('../../src/services/imdb/index.ts', () => ({
  isImdbApiEnabled: () => true,
  getEpisodesBySeason: fetchImdb,
}));
vi.mock('../../src/routes/handlers/sharedHelpers.ts', () => ({
  buildArtworkOptions: (user: { userId: string }) => ({
    poster: null,
    backdrop: null,
    logo: null,
    landscape: null,
    episode: {
      service: 'customUrl',
      customUrlPattern: `https://${user.userId}.example/{season}/{episode}`,
    },
  }),
  getPlaceholderUrls: () => ({
    posterPlaceholder: 'https://example.test/placeholder-poster.svg',
    backdropPlaceholder: 'https://example.test/placeholder-thumbnail.svg',
  }),
}));

import { addonRouter } from '../../src/routes/addon.ts';

const details = {
  id: 123,
  name: 'Example Series',
  status: 'Returning Series',
  first_air_date: '2020-01-01',
  backdrop_path: '/backdrop.jpg',
  poster_path: '/poster.jpg',
  original_language: 'en',
  genres: [],
  credits: { cast: [], crew: [] },
  images: { logos: [{ file_path: '/logo.png', iso_639_1: 'en' }], posters: [], backdrops: [] },
  external_ids: { imdb_id: 'tt1234567' },
  seasons: [1, 2].map((season_number) => ({
    id: season_number,
    season_number,
    episode_count: 1,
    poster_path: null,
    air_date: '2020-01-01',
  })),
};

beforeEach(() => {
  cache = new CacheWrapper(new MockCacheAdapter());
  fetchTmdb.mockReset();
  fetchImdb.mockReset();
  validateKey.mockReset().mockResolvedValue({ valid: true });
  fetchTmdb.mockImplementation(async (_endpoint, _key, params) => {
    if (!params.append_to_response.startsWith('season/')) return details;
    return Object.fromEntries(
      params.append_to_response.split(',').map((path: string) => {
        const season = Number(path.split('/').at(-1));
        return [
          path,
          {
            episodes: [
              {
                season_number: season,
                episode_number: 1,
                name: `Episode ${season}`,
                overview: '',
                air_date: '2020-01-01',
                still_path: null,
                runtime: 45,
              },
            ],
          },
        ];
      })
    );
  });
  fetchImdb.mockImplementation(async (_id, { season }) => ({
    title: {
      episodes: {
        episodes: {
          edges:
            season === 1
              ? [{ position: 2, node: { id: 'tt9999991', titleText: { text: 'IMDb only' } } }]
              : [],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    },
  }));
});

describe('metadata request flow', () => {
  it('shares complete episode data across configurations without sharing artwork or bypassing auth', async () => {
    const app = express();
    app.use(requestIdMiddleware());
    app.use(addonRouter);

    const first = await request(app).get('/firstuser/meta/series/tmdb:123.json');
    const second = await request(app).get('/seconduser/meta/series/tmdb:123.json');
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.meta).toMatchObject({
      id: 'tmdb:123',
      type: 'series',
      name: 'Example Series',
      videos: [
        { id: 'tt1234567:1:1', season: 1, episode: 1 },
        { id: 'tt9999991', season: 1, episode: 2 },
        { id: 'tt1234567:2:1', season: 2, episode: 1 },
      ],
    });
    expect(second.body.meta.videos.map((video: { id: string }) => video.id)).toEqual(
      first.body.meta.videos.map((video: { id: string }) => video.id)
    );
    expect(first.body.meta.videos[0].thumbnail).toBe('https://firstuser.example/1/1');
    expect(second.body.meta.videos[0].thumbnail).toBe('https://seconduser.example/1/1');
    expect(fetchImdb).toHaveBeenCalledTimes(4);
    expect(
      fetchTmdb.mock.calls.filter(([, , params]) => params.append_to_response.startsWith('season/'))
    ).toHaveLength(1);

    validateKey.mockResolvedValue({ valid: false, invalidApiKey: true });
    const rejected = await request(app).get('/firstuser/meta/series/tmdb:123.json');
    expect(rejected.status).toBe(401);
    expect(rejected.headers['cache-control']).toBe('no-store');
  });
});
