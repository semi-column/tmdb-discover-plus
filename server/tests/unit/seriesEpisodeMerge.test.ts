import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/services/tmdb/client.ts', () => ({ tmdbFetch: vi.fn() }));
vi.mock('../../src/services/imdb/index.ts', () => ({ getEpisodesBySeason: vi.fn() }));
vi.mock('../../src/services/cache/index.ts', () => ({
  getCache: vi.fn(() => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
  })),
}));
vi.mock('../../src/config.ts', () => ({
  config: {
    logging: { level: 'error', format: 'text' },
    tmdb: { debug: false, apiKey: '', rateLimit: 35 },
    nodeEnv: 'test',
    imdbApi: { enabled: false },
    imdbRatings: { disabled: true, updateIntervalHours: 24, minVotes: 100 },
    rpdb: { apiKey: '' },
    cache: { driver: '', redisUrl: '', maxKeys: 1000, versionOverride: '', warmRegions: [] },
  },
}));

import { getSeriesEpisodes } from '../../src/services/tmdb/details.ts';
import * as imdb from '../../src/services/imdb/index.ts';
import { tmdbFetch } from '../../src/services/tmdb/client.ts';

const mockedFetch = tmdbFetch as ReturnType<typeof vi.fn>;
const mockedImdb = imdb.getEpisodesBySeason as ReturnType<typeof vi.fn>;

const BASE_DETAILS = {
  seasons: [{ season_number: 1, poster_path: '/season1.jpg' }],
  backdrop_path: '/backdrop.jpg',
  external_ids: { imdb_id: 'tt1234567' },
};

const TMDB_STILL = 'https://image.tmdb.org/t/p/w500/tmdb-still.jpg';
const IMDB_STILL = 'https://m.media-amazon.com/images/imdb-still.jpg';

function makeTmdbSeasonResponse(stillPath: string | null) {
  return {
    episodes: [
      {
        season_number: 1,
        episode_number: 1,
        name: 'Pilot',
        overview: 'TMDB overview',
        air_date: '2020-01-01',
        still_path: stillPath ? '/tmdb-still.jpg' : null,
        runtime: 45,
      },
    ],
  };
}

function makeImdbSeasonResponse(imageUrl: string | null) {
  return {
    title: {
      episodes: {
        episodes: {
          edges: [
            {
              position: 1,
              node: {
                id: 'tt9999991',
                titleText: { text: 'Pilot' },
                plot: { plotText: { plainText: 'IMDb overview' } },
                releaseDate: { year: 2020, month: 1, day: 1 },
                runtime: { seconds: 2700 },
                primaryImage: imageUrl ? { url: imageUrl } : null,
              },
            },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    },
  };
}

describe('getSeriesEpisodes — thumbnail priority', () => {
  it('prefers TMDB thumbnail over IMDb when both are available', async () => {
    mockedFetch.mockResolvedValue(makeTmdbSeasonResponse('/tmdb-still.jpg'));
    mockedImdb.mockResolvedValue(makeImdbSeasonResponse(IMDB_STILL));

    const videos = await getSeriesEpisodes('api-key', 123, BASE_DETAILS as any);
    const ep = videos.find((v) => v.season === 1 && v.episode === 1);

    expect(ep).toBeDefined();
    expect(ep!.thumbnail).toBe(TMDB_STILL);
  });

  it('falls back to IMDb thumbnail when TMDB has no still', async () => {
    mockedFetch.mockResolvedValue(makeTmdbSeasonResponse(null));
    mockedImdb.mockResolvedValue(makeImdbSeasonResponse(IMDB_STILL));

    const videos = await getSeriesEpisodes('api-key', 123, BASE_DETAILS as any);
    const ep = videos.find((v) => v.season === 1 && v.episode === 1);

    expect(ep).toBeDefined();
    expect(ep!.thumbnail).toBe(IMDB_STILL);
  });

  it('uses TMDB thumbnail when IMDb has no image', async () => {
    mockedFetch.mockResolvedValue(makeTmdbSeasonResponse('/tmdb-still.jpg'));
    mockedImdb.mockResolvedValue(makeImdbSeasonResponse(null));

    const videos = await getSeriesEpisodes('api-key', 123, BASE_DETAILS as any);
    const ep = videos.find((v) => v.season === 1 && v.episode === 1);

    expect(ep).toBeDefined();
    expect(ep!.thumbnail).toBe(TMDB_STILL);
  });

  it('preserves TMDB-style episode id for stream resolution', async () => {
    mockedFetch.mockResolvedValue(makeTmdbSeasonResponse('/tmdb-still.jpg'));
    mockedImdb.mockResolvedValue(makeImdbSeasonResponse(IMDB_STILL));

    const videos = await getSeriesEpisodes('api-key', 123, BASE_DETAILS as any);
    const ep = videos.find((v) => v.season === 1 && v.episode === 1);

    expect(ep!.id).toBe('tt1234567:1:1');
  });

  it('prefers IMDb overview over TMDB', async () => {
    mockedFetch.mockResolvedValue(makeTmdbSeasonResponse('/tmdb-still.jpg'));
    mockedImdb.mockResolvedValue(makeImdbSeasonResponse(IMDB_STILL));

    const videos = await getSeriesEpisodes('api-key', 123, BASE_DETAILS as any);
    const ep = videos.find((v) => v.season === 1 && v.episode === 1);

    expect(ep!.overview).toBe('IMDb overview');
  });

  it('includes IMDb-only episodes not present in TMDB', async () => {
    mockedFetch.mockResolvedValue({
      episodes: [],
    });
    mockedImdb.mockResolvedValue(makeImdbSeasonResponse(IMDB_STILL));

    const videos = await getSeriesEpisodes('api-key', 123, BASE_DETAILS as any);
    const ep = videos.find((v) => v.season === 1 && v.episode === 1);

    expect(ep).toBeDefined();
    expect(ep!.thumbnail).toBe(IMDB_STILL);
  });
});
