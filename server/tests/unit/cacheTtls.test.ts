import { afterEach, describe, expect, it, vi } from 'vitest';
import { CACHE_TTLS, catalogServerTtl, tmdbResponseTtl } from '../../src/cacheTtls.ts';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('selective cache policy', () => {
  it('uses a strict six-calendar-month cutoff, including month-end clamping', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-31T00:00:00Z'));
    vi.stubEnv('CACHE_TTL_DETAIL', '172800');
    vi.resetModules();
    const policy = await import('../../src/cacheTtls.ts');
    expect(policy.tmdbResponseTtl('/movie/1', { release_date: '2026-02-27' })).toBe(172800);
    expect(policy.tmdbResponseTtl('/movie/1', { release_date: '2026-02-28' })).toBe(
      CACHE_TTLS.TMDB_MOVIE_DETAIL
    );
    expect(policy.tmdbResponseTtl('/movie/1', { release_date: '2026-07-01' })).toBe(
      CACHE_TTLS.TMDB_MOVIE_DETAIL
    );
    expect(policy.tmdbResponseTtl('/movie/1', { release_date: '2026-08-01' })).toBe(
      CACHE_TTLS.TMDB_RECENT_DETAIL
    );
    expect(policy.tmdbResponseTtl('/movie/1', { release_date: '2027-01-01' })).toBe(
      CACHE_TTLS.TMDB_RECENT_DETAIL
    );
    expect(policy.tmdbResponseTtl('/movie/1', { release_date: 'invalid' })).toBe(
      CACHE_TTLS.TMDB_RECENT_DETAIL
    );
    expect(policy.tmdbResponseTtl('/movie/1', { release_date: '2026-02-30' })).toBe(
      CACHE_TTLS.TMDB_RECENT_DETAIL
    );
  });

  it.each(['original_title.asc', 'primary_release_date.asc', 'revenue.desc'])(
    'aligns raw and rendered stable discovery TTL for %s',
    (sort) => {
      expect(tmdbResponseTtl('/discover/movie', {}, new URLSearchParams({ sort_by: sort }))).toBe(
        CACHE_TTLS.TMDB_DISCOVER_STABLE
      );
      expect(catalogServerTtl('discover', { sortBy: sort })).toBe(CACHE_TTLS.TMDB_DISCOVER_STABLE);
    }
  );

  it.each([
    'popularity.desc',
    'vote_average.desc',
    'primary_release_date.desc',
    'random',
    'unknown',
  ])('keeps changing and unrecognized discovery sorts short: %s', (sort) => {
    expect(tmdbResponseTtl('/discover/movie', {}, new URLSearchParams({ sort_by: sort }))).toBe(
      CACHE_TTLS.CATALOG_SERVER_TRENDING
    );
    expect(catalogServerTtl('discover', { sortBy: sort })).toBe(CACHE_TTLS.CATALOG_SERVER_TRENDING);
  });

  it('keeps date-filtered discovery and season batches short, even with ended TV status', () => {
    expect(
      tmdbResponseTtl(
        '/discover/tv',
        {},
        new URLSearchParams({
          sort_by: 'first_air_date.asc',
          'first_air_date.lte': '2026-11-09',
        })
      )
    ).toBe(CACHE_TTLS.CATALOG_SERVER_TRENDING);
    expect(catalogServerTtl('discover', { sortBy: 'original_title.asc', yearFrom: 2000 })).toBe(
      CACHE_TTLS.CATALOG_SERVER_TRENDING
    );
    expect(catalogServerTtl('discover', { sortBy: 'original_title.asc', releasedOnly: true })).toBe(
      CACHE_TTLS.CATALOG_SERVER_TRENDING
    );
    expect(catalogServerTtl('discover', { sortBy: 'original_title.asc', lastXYears: 2 })).toBe(
      CACHE_TTLS.CATALOG_SERVER_TRENDING
    );
    expect(
      tmdbResponseTtl(
        '/tv/1',
        { status: 'Ended' },
        new URLSearchParams({
          append_to_response: 'season/1,season/2',
        })
      )
    ).toBe(CACHE_TTLS.TMDB_RECENT_DETAIL);
    expect(tmdbResponseTtl('/tv/1', {})).toBe(CACHE_TTLS.TMDB_ACTIVE_SERIES);
    expect(tmdbResponseTtl('/find/tt1234567', {})).toBe(CACHE_TTLS.TMDB_API_RESPONSE);
    expect(tmdbResponseTtl('/find/tt1234567', { movie_results: [], tv_results: [] })).toBe(60);
    expect(tmdbResponseTtl('/search/movie', { results: [] })).toBe(60);
  });

  it.each(['0', '-1', '1.5', '10seconds', '', '31536001'])(
    'rejects invalid TTL override %j explicitly',
    async (value) => {
      vi.stubEnv('CACHE_TTL_TMDB_API_RESPONSE', value);
      vi.resetModules();
      await expect(import('../../src/cacheTtls.ts')).rejects.toThrow(
        'CACHE_TTL_TMDB_API_RESPONSE must be an integer'
      );
    }
  );
});
