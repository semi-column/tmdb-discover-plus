import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtworkOptions } from '../../src/types/index.ts';
import {
  CacheWrapper,
  INCOMPLETE_RESULT,
  STALE_RESULT,
} from '../../src/services/cache/CacheWrapper.ts';
import { MockCacheAdapter } from './helpers/mocks.ts';
import {
  getRequestSignal,
  getBackgroundWorkStats,
  abortRequestContext,
  startOpportunisticWork,
  withRequestAbortContext,
} from '../../src/utils/requestContext.ts';

const { fetchTmdb, fetchImdb, imdbEnabled, flags } = vi.hoisted(() => ({
  fetchTmdb: vi.fn(),
  fetchImdb: vi.fn(),
  imdbEnabled: vi.fn(),
  flags: {
    demandFirst: true,
    endedEpisodeSwr: true,
    backgroundPriority: true,
    disableRateLimit: false,
  },
}));
let cache: CacheWrapper;
let adapter: MockCacheAdapter;

vi.mock('../../src/config.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/config.ts')>();
  return { ...actual, config: { ...actual.config, features: flags } };
});
vi.mock('../../src/services/cache/index.ts', () => ({ getCache: () => cache }));
vi.mock('../../src/services/tmdb/client.ts', () => ({ tmdbFetch: fetchTmdb }));
vi.mock('../../src/services/imdb/index.ts', () => ({
  getEpisodesBySeason: fetchImdb,
  isImdbApiEnabled: imdbEnabled,
}));

import { getSeriesEpisodes } from '../../src/services/tmdb/details.ts';

const seasons = Array.from({ length: 12 }, (_, index) => ({
  id: index + 1,
  season_number: index + 1,
  episode_count: 1,
  poster_path: null,
  name: `Season ${index + 1}`,
  overview: '',
  air_date: '2020-01-01',
  vote_average: 0,
}));
const details = {
  seasons,
  status: 'Returning Series',
  backdrop_path: '/series.jpg',
  external_ids: { imdb_id: 'tt1234567' },
};

function artwork(host: string): ArtworkOptions {
  return {
    poster: null,
    backdrop: null,
    logo: null,
    landscape: null,
    episode: { service: 'customUrl', customUrlPattern: `https://${host}/{season}/{episode}` },
  };
}

beforeEach(() => {
  adapter = new MockCacheAdapter();
  cache = new CacheWrapper(adapter);
  fetchTmdb.mockReset();
  fetchImdb.mockReset();
  imdbEnabled.mockReturnValue(true);
  flags.demandFirst = true;
  flags.endedEpisodeSwr = true;
  flags.backgroundPriority = true;
  const seasonResponse = (season: number) => ({
    episodes: [
      {
        season_number: season,
        episode_number: 1,
        name: `TMDB ${season}`,
        overview: 'TMDB overview',
        air_date: '2020-01-01',
        still_path: null,
        runtime: 45,
      },
    ],
  });
  fetchTmdb.mockImplementation(async (endpoint, _key, params) => {
    if (endpoint === '/tv/123') {
      return Object.fromEntries(
        params.append_to_response
          .split(',')
          .map((path: string) => [path, seasonResponse(Number(path.split('/').at(-1)))])
      );
    }
    return seasonResponse(Number(endpoint.split('/').at(-1)));
  });
  fetchImdb.mockImplementation(async (_id, { season }) => ({
    title: {
      episodes: {
        episodes: {
          edges:
            season === 1 || season === 13
              ? [
                  {
                    position: season === 1 ? 2 : 1,
                    node: { id: `tt999${season}`, titleText: { text: 'IMDb only' } },
                  },
                ]
              : [],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    },
  }));
});

describe('ended-series stale snapshots', () => {
  const endedDetails = { ...details, status: 'Ended' };
  const day = 86_400_000;

  async function seedSnapshot(status = 'Ended', age = day + 1) {
    const complete = await getSeriesEpisodes('key', 123, { ...details, status });
    const key = [...adapter.store.keys()].find((key) => key.startsWith('episodes:canonical:'))!;
    const entry = (await cache.getEntry(key))!;
    entry.__storedAt = Date.now() - age;
    fetchImdb.mockClear();
    return { complete, key, storedAt: entry.__storedAt };
  }

  it('does not rebuild a fresh ended snapshot', async () => {
    await seedSnapshot('Ended', day - 60_000);
    const fresh = await getSeriesEpisodes('key', 123, endedDetails);
    expect(STALE_RESULT in fresh).toBe(false);
    expect(fetchImdb).not.toHaveBeenCalled();
  });

  it.each(['Ended', 'Canceled'])(
    'returns a complete stale %s snapshot while one sequential refresh is blocked',
    async (status) => {
      const { complete, key, storedAt } = await seedSnapshot(status);
      const gate = Promise.withResolvers<void>();
      const fetch = fetchImdb.getMockImplementation()!;
      fetchImdb.mockImplementation(async (...args) => {
        await gate.promise;
        return fetch(...args);
      });
      try {
        const reads = Array.from({ length: 8 }, (_, index) =>
          getSeriesEpisodes(
            'key',
            123,
            { ...details, status },
            {
              artworkOptions: artwork(`user${index}.example`),
            }
          )
        );
        const results = await Promise.all(reads);
        expect(results.every((result) => STALE_RESULT in result)).toBe(true);
        expect(results.every((result) => !(INCOMPLETE_RESULT in result))).toBe(true);
        expect(results[0].map(({ id }) => id)).toEqual(complete.map(({ id }) => id));
        expect(results[0][0].thumbnail).toBe('https://user0.example/1/1');
        expect(results[1][0].thumbnail).toBe('https://user1.example/1/1');
        await vi.waitFor(() => expect(fetchImdb).toHaveBeenCalledTimes(1));
        expect(getBackgroundWorkStats().active).toBe(1);
        expect((await cache.getEntry(key))?.__storedAt).toBe(storedAt);
      } finally {
        gate.resolve();
        await vi.waitFor(() => expect(getBackgroundWorkStats().active).toBe(0));
      }
      const fresh = await getSeriesEpisodes('key', 123, { ...details, status });
      expect(STALE_RESULT in fresh).toBe(false);
      expect(fetchImdb).toHaveBeenCalledTimes(14);
    }
  );

  it.each([
    'cold',
    'expired',
    'language',
    'season metadata',
    'rollback',
    'background rollback',
    'ongoing',
  ])('keeps the existing foreground completeness path for %s snapshots', async (scenario) => {
    if (scenario !== 'cold')
      await seedSnapshot(
        scenario === 'ongoing' ? details.status : 'Ended',
        scenario === 'expired' ? 2 * day : day + 1
      );
    if (scenario === 'rollback') flags.endedEpisodeSwr = false;
    if (scenario === 'background rollback') flags.backgroundPriority = false;
    const gate = Promise.withResolvers<void>();
    const fetch = fetchImdb.getMockImplementation()!;
    fetchImdb.mockImplementation(async (...args) => {
      await gate.promise;
      return fetch(...args);
    });
    const updated =
      scenario === 'ongoing'
        ? details
        : scenario === 'season metadata'
          ? {
              ...endedDetails,
              seasons: seasons.map((s) => ({ ...s, poster_path: '/changed.jpg' })),
            }
          : endedDetails;
    let settled = false;
    const result = getSeriesEpisodes('key', 123, updated, {
      language: scenario === 'language' ? 'fr' : 'en',
    }).then((videos) => {
      settled = true;
      return videos;
    });
    try {
      await vi.waitFor(() => expect(fetchImdb).toHaveBeenCalledTimes(5));
      expect(settled).toBe(false);
    } finally {
      gate.resolve();
      const videos = await result;
      expect(STALE_RESULT in videos).toBe(false);
      expect(INCOMPLETE_RESULT in videos).toBe(false);
    }
  });

  it('preserves IMDb-only episodes after a degraded refresh and applies valid removals later', async () => {
    const { complete, key, storedAt } = await seedSnapshot();
    fetchImdb.mockRejectedValue(new Error('IMDb unavailable'));
    const stale = await getSeriesEpisodes('key', 123, endedDetails);
    await vi.waitFor(() => expect(getBackgroundWorkStats().active).toBe(0));
    expect(stale.map(({ id }) => id)).toEqual(complete.map(({ id }) => id));
    expect((await cache.getEntry(key))?.__storedAt).toBe(storedAt);
    fetchImdb.mockResolvedValue({
      title: { episodes: { episodes: { edges: [], pageInfo: { hasNextPage: false } } } },
    });
    await getSeriesEpisodes('key', 123, endedDetails);
    await vi.waitFor(() => expect(getBackgroundWorkStats().active).toBe(0));
    const corrected = await getSeriesEpisodes('key', 123, endedDetails);
    expect(corrected).toHaveLength(12);
    expect(corrected.some(({ id }) => id === 'tt99913')).toBe(false);
    expect(STALE_RESULT in corrected).toBe(false);
    expect(INCOMPLETE_RESULT in corrected).toBe(false);
  });

  it('serves stale without renewing age when the background cap skips the refresh', async () => {
    const { key, storedAt } = await seedSnapshot();
    const gate = Promise.withResolvers<void>();
    const tasks = [0, 1].map(() => startOpportunisticWork(() => gate.promise)!);
    try {
      const stale = await getSeriesEpisodes('key', 123, endedDetails);
      expect(STALE_RESULT in stale).toBe(true);
      expect(fetchImdb).not.toHaveBeenCalled();
      expect((await cache.getEntry(key))?.__storedAt).toBe(storedAt);
    } finally {
      gate.resolve();
      await Promise.all(tasks.map(({ promise }) => promise));
    }
  });

  it('keeps the complete snapshot when a disconnect cancels its refresh', async () => {
    const { key, storedAt } = await seedSnapshot();
    const gate = Promise.withResolvers<void>();
    const fetch = fetchImdb.getMockImplementation()!;
    fetchImdb.mockImplementation(async (...args) => {
      await gate.promise;
      return fetch(...args);
    });
    try {
      await withRequestAbortContext(async () => {
        expect(STALE_RESULT in (await getSeriesEpisodes('key', 123, endedDetails))).toBe(true);
        await vi.waitFor(() => expect(fetchImdb).toHaveBeenCalledTimes(1));
        abortRequestContext(new DOMException('Disconnected', 'AbortError'));
        await vi.waitFor(() => expect(getBackgroundWorkStats().active).toBe(0));
      });
      expect((await cache.getEntry(key))?.__storedAt).toBe(storedAt);
    } finally {
      gate.resolve();
      await vi.waitFor(() => expect(cache.getStats().inFlightRequests).toBe(0));
    }
  });

  it('bounds duplicate work from independent wrappers without claiming distributed single-flight', async () => {
    await seedSnapshot();
    const gate = Promise.withResolvers<void>();
    const fetch = fetchImdb.getMockImplementation()!;
    fetchImdb.mockImplementation(async (...args) => {
      await gate.promise;
      return fetch(...args);
    });
    try {
      const first = await getSeriesEpisodes('key', 123, endedDetails);
      cache = new CacheWrapper(adapter);
      const second = await getSeriesEpisodes('key', 123, endedDetails);
      expect(first.map(({ id }) => id)).toEqual(second.map(({ id }) => id));
      expect(STALE_RESULT in second).toBe(true);
      await vi.waitFor(() => expect(fetchImdb).toHaveBeenCalledTimes(2));
      expect(getBackgroundWorkStats().active).toBe(2);
    } finally {
      gate.resolve();
      await vi.waitFor(() => expect(getBackgroundWorkStats().active).toBe(0));
    }
    expect(fetchImdb).toHaveBeenCalledTimes(28);
  });
});

describe('shared complete series episodes', () => {
  it('reuses a complete 12-season build without sharing personalized thumbnails', async () => {
    const first = await getSeriesEpisodes('key', 123, details, {
      language: 'en',
      artworkOptions: artwork('first.example'),
    });
    const second = await getSeriesEpisodes('key', 123, details, {
      language: 'en',
      artworkOptions: artwork('second.example'),
    });

    expect(fetchTmdb).toHaveBeenCalledTimes(1);
    expect(fetchImdb).toHaveBeenCalledTimes(14);
    expect(first.map(({ id }) => id)).toEqual(second.map(({ id }) => id));
    expect(first).toHaveLength(14);
    expect(first.find((video) => video.season === 1 && video.episode === 2)?.id).toBe('tt9991');
    expect(first.find((video) => video.season === 13)?.id).toBe('tt99913');
    expect(first[0].thumbnail).toBe('https://first.example/1/1');
    expect(second[0].thumbnail).toBe('https://second.example/1/1');
    expect(fetchImdb.mock.calls[0][1].season).toBe(12);
    expect(fetchImdb.mock.calls.find(([, params]) => params.season === 1)?.[1].maxStaleAgeMs).toBe(
      21 * 86_400_000
    );
    expect(fetchImdb.mock.calls.find(([, params]) => params.season === 12)?.[1].maxStaleAgeMs).toBe(
      undefined
    );
  });

  it('coalesces concurrent builds but keeps their artwork separate', async () => {
    const gate = Promise.withResolvers<void>();
    const fetch = fetchImdb.getMockImplementation()!;
    fetchImdb.mockImplementation(async (...args) => {
      await gate.promise;
      return fetch(...args);
    });
    const first = getSeriesEpisodes('key', 123, details, {
      artworkOptions: artwork('first.example'),
    });
    await vi.waitFor(() => expect(fetchImdb).toHaveBeenCalledTimes(5));
    const second = getSeriesEpisodes('key', 123, details, {
      artworkOptions: artwork('second.example'),
    });
    gate.resolve();
    const [a, b] = await Promise.all([first, second]);

    expect(fetchImdb).toHaveBeenCalledTimes(14);
    expect(a[0].thumbnail).toBe('https://first.example/1/1');
    expect(b[0].thumbnail).toBe('https://second.example/1/1');
  });

  it('batches background TMDB seasons and fetches IMDb seasons sequentially', async () => {
    const tmdbGate = Promise.withResolvers<void>();
    const imdbGate = Promise.withResolvers<void>();
    const tmdb = fetchTmdb.getMockImplementation()!;
    const imdb = fetchImdb.getMockImplementation()!;
    fetchTmdb.mockImplementation(async (...args) => {
      if (args[0] === '/tv/123') await tmdbGate.promise;
      return tmdb(...args);
    });
    fetchImdb.mockImplementation(async (...args) => {
      await imdbGate.promise;
      return imdb(...args);
    });
    const background = startOpportunisticWork(() => getSeriesEpisodes('key', 123, details))!;
    try {
      await vi.waitFor(() => expect(fetchTmdb).toHaveBeenCalledTimes(1));
      tmdbGate.resolve();
      await vi.waitFor(() => expect(fetchImdb).toHaveBeenCalledTimes(1));
      imdbGate.resolve();
      expect(await background.promise).toHaveLength(14);
      expect(fetchTmdb).toHaveBeenCalledTimes(1);
      expect(fetchImdb).toHaveBeenCalledTimes(14);
    } finally {
      tmdbGate.resolve();
      imdbGate.resolve();
    }
  });

  it('can disable shared snapshots and historical IMDb freshness for rollback', async () => {
    flags.demandFirst = false;
    await getSeriesEpisodes('key', 123, details);
    await getSeriesEpisodes('key', 123, details);
    expect(fetchImdb).toHaveBeenCalledTimes(28);
    expect(fetchImdb.mock.calls[0][1].season).toBe(1);
    expect(fetchImdb.mock.calls.every(([, params]) => params.maxStaleAgeMs === undefined)).toBe(
      true
    );
    expect((await cache.getEntry('season_123_1_en'))?.__ttl).toBe(14 * 86_400);
    expect((await cache.getEntry('season_123_12_en'))?.__ttl).toBe(86_400);
  });

  it.each([
    { name: 'Episode 1', episode: 1, gap: true },
    { name: 'EPISODE   1', episode: 1, gap: true },
    { name: 'Episode -1', episode: -1, gap: true },
    { name: 'Episode 01', episode: 1, gap: false },
    { name: 'Pilot', episode: 1, gap: false },
  ])('prioritizes a season with a generic title: $name', async ({ name, episode, gap }) => {
    const fetch = fetchTmdb.getMockImplementation()!;
    fetchTmdb.mockImplementation(async (endpoint, key, params, retries, options) => {
      const data = await fetch(endpoint, key, params, retries, options);
      if (endpoint === '/tv/123') {
        data['season/1'].episodes[0].name = name;
        data['season/1'].episodes[0].episode_number = episode;
      }
      return data;
    });

    await getSeriesEpisodes('key', 123, { ...details, seasons: seasons.slice(0, 2) });

    expect(fetchImdb.mock.calls[0][1].season).toBe(gap ? 1 : 2);
    expect(fetchImdb.mock.calls.find(([, params]) => params.season === 1)?.[1].maxStaleAgeMs).toBe(
      gap ? undefined : 21 * 86_400_000
    );
  });

  it('does not cache a snapshot when IMDb enrichment fails', async () => {
    const fetch = fetchImdb.getMockImplementation()!;
    fetchImdb.mockImplementationOnce(async () => {
      throw new Error('IMDb unavailable');
    });
    const partial = await getSeriesEpisodes('key', 123, details);
    expect(INCOMPLETE_RESULT in partial).toBe(true);

    fetchImdb.mockImplementation(fetch);
    const complete = await getSeriesEpisodes('key', 123, details);
    expect(INCOMPLETE_RESULT in complete).toBe(false);
    expect(complete).toHaveLength(14);
    expect(fetchImdb).toHaveBeenCalledTimes(28);
  });

  it('retains the last complete snapshot when a refresh loses IMDb-only episodes', async () => {
    vi.useFakeTimers();
    try {
      const complete = await getSeriesEpisodes('key', 123, details);
      const fetch = fetchImdb.getMockImplementation()!;
      await vi.advanceTimersByTimeAsync(6 * 3_600_000 + 1);
      fetchImdb.mockImplementation(async (id, params) => {
        if (params.season === 13) throw new Error('IMDb unavailable');
        return fetch(id, params);
      });

      const degraded = await getSeriesEpisodes('key', 123, details);
      expect(degraded.map((video) => video.id)).toEqual(complete.map((video) => video.id));
      expect(INCOMPLETE_RESULT in degraded).toBe(true);

      fetchImdb.mockImplementation(fetch);
      const recovered = await getSeriesEpisodes('key', 123, details);
      expect(recovered.map((video) => video.id)).toEqual(complete.map((video) => video.id));
      expect(INCOMPLETE_RESULT in recovered).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the complete TMDB episode list when IMDb is disabled', async () => {
    imdbEnabled.mockReturnValue(false);
    const videos = await getSeriesEpisodes('key', 123, details);
    expect(videos).toHaveLength(12);
    expect(videos[0].id).toBe('tt1234567:1:1');
    expect(fetchImdb).not.toHaveBeenCalled();
    expect(INCOMPLETE_RESULT in videos).toBe(false);
  });

  it('marks missing season lists as incomplete instead of caching an empty series', async () => {
    const videos = await getSeriesEpisodes('key', 123, { ...details, seasons: undefined });
    expect(videos).toEqual([]);
    expect(INCOMPLETE_RESULT in videos).toBe(true);
    expect(fetchTmdb).not.toHaveBeenCalled();
    expect(fetchImdb).not.toHaveBeenCalled();
  });

  it('recomputes availability when a cached future episode is released', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T22:00:00Z'));
      const fetch = fetchTmdb.getMockImplementation()!;
      fetchTmdb.mockImplementation(async (endpoint, key, params, retries, options) => {
        const data = await fetch(endpoint, key, params, retries, options);
        if (endpoint === '/tv/123') data['season/1'].episodes[0].air_date = '2026-01-02';
        return data;
      });
      const first = await getSeriesEpisodes('key', 123, details);
      expect(first.find((video) => video.season === 1 && video.episode === 1)?.available).toBe(
        false
      );
      await vi.advanceTimersByTimeAsync(3 * 3_600_000);
      const second = await getSeriesEpisodes('key', 123, details);
      expect(second.find((video) => video.season === 1 && video.episode === 1)?.available).toBe(
        true
      );
      expect(fetchImdb).toHaveBeenCalledTimes(14);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels timed-out background enrichment without aborting its foreground parent', async () => {
    vi.useFakeTimers();
    const gate = Promise.withResolvers<unknown>();
    try {
      fetchImdb.mockImplementation(() => gate.promise);
      await withRequestAbortContext(async () => {
        const foreground = getRequestSignal()!;
        const background = startOpportunisticWork(() => getSeriesEpisodes('key', 123, details))!;
        const rejected = expect(background.promise).rejects.toMatchObject({
          code: 'OPPORTUNISTIC_SKIPPED',
        });
        await vi.advanceTimersByTimeAsync(0);
        expect(fetchImdb).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(22_001);
        await rejected;
        expect(background.signal.aborted).toBe(true);
        expect(foreground.aborted).toBe(false);
      });
    } finally {
      gate.resolve({ title: { episodes: { episodes: { edges: [] } } } });
      vi.useRealTimers();
    }
  });

  it.each([
    { title: null },
    { title: { episodes: null } },
    { title: { episodes: { episodes: null } } },
  ])('accepts a nullable empty IMDb first page', async (emptyResponse) => {
    const fetch = fetchImdb.getMockImplementation()!;
    fetchImdb.mockImplementation(async (id, params) =>
      params.season === 1 ? emptyResponse : fetch(id, params)
    );
    const videos = await getSeriesEpisodes('key', 123, details);
    expect(videos).toHaveLength(13);
    expect(INCOMPLETE_RESULT in videos).toBe(false);
  });

  it('keeps language and changed season metadata in separate snapshots', async () => {
    await getSeriesEpisodes('key', 123, details, { language: 'en' });
    await getSeriesEpisodes('key', 123, details, { language: 'fr' });
    await getSeriesEpisodes(
      'key',
      123,
      { ...details, backdrop_path: '/updated.jpg' },
      {
        language: 'en',
      }
    );
    expect(fetchImdb).toHaveBeenCalledTimes(42);
  });

  it('refreshes an older season payload when TMDB reports new episodes', async () => {
    await getSeriesEpisodes('key', 123, details, { language: 'en' });
    const fetch = fetchTmdb.getMockImplementation()!;
    fetchTmdb.mockImplementation(async (endpoint, key, params, retries, options) => {
      if (endpoint === '/tv/123/season/12') {
        return {
          episodes: [1, 2].map((number) => ({
            season_number: 12,
            episode_number: number,
            name: `TMDB 12-${number}`,
            overview: '',
            air_date: '2020-01-01',
            still_path: null,
            runtime: 45,
          })),
        };
      }
      return fetch(endpoint, key, params, retries, options);
    });
    const updated = {
      ...details,
      seasons: details.seasons.map((season) =>
        season.season_number === 12 ? { ...season, episode_count: 2 } : season
      ),
    };

    const videos = await getSeriesEpisodes('key', 123, updated, { language: 'en' });
    expect(videos.some((video) => video.season === 12 && video.episode === 2)).toBe(true);
    expect(fetchTmdb).toHaveBeenCalledWith('/tv/123/season/12', 'key', { language: 'en' }, 3, {
      skipCache: true,
    });
  });

  it('refreshes an older season when TMDB removes an episode', async () => {
    await getSeriesEpisodes('key', 123, details, { language: 'en' });
    const fetch = fetchTmdb.getMockImplementation()!;
    fetchTmdb.mockImplementation(async (endpoint, key, params, retries, options) => {
      if (endpoint === '/tv/123/season/12') return { episodes: [] };
      return fetch(endpoint, key, params, retries, options);
    });
    const updated = {
      ...details,
      seasons: details.seasons.map((season) =>
        season.season_number === 12 ? { ...season, episode_count: 0 } : season
      ),
    };

    const videos = await getSeriesEpisodes('key', 123, updated, { language: 'en' });
    expect(videos.some((video) => video.season === 12)).toBe(false);
    expect(INCOMPLETE_RESULT in videos).toBe(false);
    expect(fetchTmdb).toHaveBeenCalledWith('/tv/123/season/12', 'key', { language: 'en' }, 3, {
      skipCache: true,
    });
  });

  it.each(['unavailable', 'lagging'])(
    'retains a usable season and bounds retries when TMDB is %s',
    async (failure) => {
      vi.useFakeTimers();
      try {
        await getSeriesEpisodes('key', 123, details, { language: 'en' });
        const fetch = fetchTmdb.getMockImplementation()!;
        fetchTmdb.mockImplementation(async (endpoint, key, params, retries, options) => {
          if (endpoint === '/tv/123/season/12') {
            if (failure === 'unavailable') throw new Error('TMDB unavailable');
            return fetch(endpoint, key, params, retries, options);
          }
          return fetch(endpoint, key, params, retries, options);
        });
        const updated = {
          ...details,
          seasons: details.seasons.map((season) =>
            season.season_number === 12 ? { ...season, episode_count: 2 } : season
          ),
        };

        const first = await getSeriesEpisodes('key', 123, updated, { language: 'en' });
        const second = await getSeriesEpisodes('key', 123, updated, { language: 'en' });
        expect(first.find((video) => video.season === 12)?.id).toBe('tt1234567:12:1');
        expect(INCOMPLETE_RESULT in first).toBe(true);
        expect(INCOMPLETE_RESULT in second).toBe(true);
        expect(
          fetchTmdb.mock.calls.filter(([endpoint]) => endpoint.endsWith('/season/12'))
        ).toHaveLength(1);

        await vi.advanceTimersByTimeAsync(60_001);
        await getSeriesEpisodes('key', 123, updated, { language: 'en' });
        expect(
          fetchTmdb.mock.calls.filter(([endpoint]) => endpoint.endsWith('/season/12'))
        ).toHaveLength(2);
      } finally {
        vi.useRealTimers();
      }
    }
  );
});
