import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/services/tmdb/client.ts', () => ({ tmdbFetch: vi.fn() }));
vi.mock('../../src/services/imdb/index.ts', () => ({
  getEpisodesBySeason: vi.fn(),
  isImdbApiEnabled: () => true,
}));
vi.mock('../../src/utils/requestContext.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/utils/requestContext.ts')>()),
  getRequestId: vi.fn(),
  throwIfRequestAborted: vi.fn(),
  getRequestRemainingMs: vi.fn(() => Infinity),
  isRequestAborted: vi.fn(() => false),
  isOpportunisticWork: vi.fn(() => false),
}));
vi.mock('../../src/services/cache/index.ts', () => ({
  getCache: vi.fn(() => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    wrap: vi.fn((_key, fetch) => fetch()),
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
import { INCOMPLETE_RESULT } from '../../src/services/cache/CacheWrapper.ts';
import * as imdb from '../../src/services/imdb/index.ts';
import { tmdbFetch } from '../../src/services/tmdb/client.ts';
import { getRequestRemainingMs, throwIfRequestAborted } from '../../src/utils/requestContext.ts';

const mockedFetch = tmdbFetch as ReturnType<typeof vi.fn>;
const mockedImdb = imdb.getEpisodesBySeason as ReturnType<typeof vi.fn>;
const mockedRequestAborted = throwIfRequestAborted as ReturnType<typeof vi.fn>;
const mockedRemainingMs = getRequestRemainingMs as ReturnType<typeof vi.fn>;

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
  it('marks missing primary season data as partial while retaining IMDb fallback', async () => {
    mockedFetch.mockRejectedValue(Object.assign(new Error('Missing season'), { statusCode: 404 }));
    mockedImdb.mockResolvedValue(makeImdbSeasonResponse(IMDB_STILL));
    const videos = await getSeriesEpisodes('api-key', 123, BASE_DETAILS as any);
    expect(
      videos.some((video) => video.season === 1 && video.episode === 1 && video.id === 'tt9999991')
    ).toBe(true);
    expect(INCOMPLETE_RESULT in videos).toBe(true);
  });
  it('does not start provider batches for an aborted request', async () => {
    mockedFetch.mockClear();
    mockedImdb.mockClear();
    mockedRequestAborted.mockImplementation(() => {
      throw new DOMException('Cancelled', 'AbortError');
    });

    await expect(getSeriesEpisodes('api-key', 123, BASE_DETAILS as any)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(mockedFetch).not.toHaveBeenCalled();
    expect(mockedImdb).not.toHaveBeenCalled();
    mockedRequestAborted.mockReset();
  });

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

  it.each([35, 51])(
    'loads all %s TMDB seasons without dropping IMDb enrichment',
    async (seasonCount) => {
      mockedFetch.mockClear();
      mockedImdb.mockClear();
      mockedFetch.mockImplementation(async (endpoint, _key, params) => {
        if (endpoint === '/tv/123') {
          return Object.fromEntries(
            params.append_to_response.split(',').map((path: string) => {
              const response = makeTmdbSeasonResponse('/still.jpg');
              response.episodes[0].season_number = Number(path.split('/').at(-1));
              return [path, response];
            })
          );
        }
        const season = Number(endpoint.split('/').at(-1));
        const response = makeTmdbSeasonResponse('/still.jpg');
        response.episodes[0].season_number = season;
        return response;
      });
      mockedImdb.mockResolvedValue({ title: { episodes: { episodes: { edges: [] } } } });
      const videos = await getSeriesEpisodes('key', 123, {
        ...BASE_DETAILS,
        seasons: Array.from({ length: seasonCount }, (_, index) => ({ season_number: index + 1 })),
      } as any);
      expect(videos).toHaveLength(seasonCount);
      expect(videos.at(-1)?.season).toBe(seasonCount);
      expect(mockedFetch).toHaveBeenCalledTimes(Math.ceil(seasonCount / 20));
      expect(
        mockedFetch.mock.calls.every(
          ([, , params]) => params.append_to_response.split(',').length <= 20
        )
      ).toBe(true);
      expect(mockedImdb).toHaveBeenCalledTimes(seasonCount + 2);
    }
  );

  it('falls back individually when a season batch omits or malforms a season', async () => {
    mockedFetch.mockReset();
    mockedImdb.mockResolvedValue({ title: { episodes: { episodes: { edges: [] } } } });
    mockedFetch.mockImplementation(async (endpoint) => {
      if (endpoint === '/tv/123') {
        return { 'season/1': makeTmdbSeasonResponse('/still.jpg'), 'season/2': {} };
      }
      const response = makeTmdbSeasonResponse('/still.jpg');
      response.episodes[0].season_number = Number(endpoint.split('/').at(-1));
      return response;
    });

    const videos = await getSeriesEpisodes('key', 123, {
      ...BASE_DETAILS,
      seasons: [1, 2, 3].map((season_number) => ({ season_number })),
    } as any);
    expect(videos.map((video) => video.season)).toEqual([1, 2, 3]);
    expect(mockedFetch).toHaveBeenCalledTimes(3);
    expect(
      mockedFetch.mock.calls
        .slice(1)
        .map(([endpoint]) => endpoint)
        .sort()
    ).toEqual(['/tv/123/season/2', '/tv/123/season/3']);
  });

  it('returns TMDB episodes without IMDb enrichment when the request deadline is near', async () => {
    mockedFetch.mockReset();
    mockedImdb.mockClear();
    mockedFetch.mockResolvedValue(makeTmdbSeasonResponse('/tmdb-still.jpg'));
    mockedRemainingMs.mockReturnValue(5_000);

    const videos = await getSeriesEpisodes('api-key', 123, BASE_DETAILS as any);

    expect(videos).toHaveLength(1);
    expect(videos[0].overview).toBe('TMDB overview');
    expect(mockedImdb).not.toHaveBeenCalled();
    mockedRemainingMs.mockReturnValue(Infinity);
  });

  it('stops waiting for slow IMDb pages at the deadline and keeps seasons that finished', async () => {
    mockedFetch.mockReset();
    mockedImdb.mockReset();
    mockedFetch.mockResolvedValue(makeTmdbSeasonResponse('/tmdb-still.jpg'));
    // Season 1 answers; the probe seasons hang like a page stuck behind the throttle queue.
    mockedImdb.mockImplementation((_id, { season }) =>
      season === 1 ? Promise.resolve(makeImdbSeasonResponse(IMDB_STILL)) : new Promise(() => {})
    );
    mockedRemainingMs.mockReturnValue(8_050);

    const started = Date.now();
    const videos = await getSeriesEpisodes('api-key', 123, BASE_DETAILS as any);

    expect(Date.now() - started).toBeLessThan(1_000);
    expect(videos).toHaveLength(1);
    expect(videos[0].overview).toBe('IMDb overview');
    mockedRemainingMs.mockReturnValue(Infinity);
  });
});
