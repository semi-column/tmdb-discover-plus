import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockedFetch } = vi.hoisted(() => ({ mockedFetch: vi.fn() }));

vi.mock('../../src/services/tmdb/client.ts', () => ({
  tmdbFetch: mockedFetch,
}));

vi.mock('../../src/services/cache/index.js', () => ({
  getCache: vi.fn(() => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../src/utils/helpers.js', async (importOriginal) => {
  const orig = await importOriginal() as Record<string, unknown>;
  return { ...orig, shuffleArray: vi.fn((arr: unknown[]) => arr) };
});

import { discover, fetchSpecialList } from '../../src/services/tmdb/discover.ts';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('discover', () => {
  it('calls /discover/movie with default params', async () => {
    mockedFetch.mockResolvedValue({ page: 1, results: [{ id: 1 }], total_pages: 5 });
    await discover('test-key', { type: 'movie' });
    expect(mockedFetch).toHaveBeenCalledWith(
      '/discover/movie',
      'test-key',
      expect.objectContaining({ sort_by: 'popularity.desc', page: 1, include_adult: false }),
    );
  });

  it('calls /discover/tv for series type', async () => {
    mockedFetch.mockResolvedValue({ page: 1, results: [] });
    await discover('key', { type: 'series' });
    expect(mockedFetch).toHaveBeenCalledWith('/discover/tv', 'key', expect.any(Object));
  });

  it('maps genres with correct separator for match mode', async () => {
    mockedFetch.mockResolvedValue({ page: 1, results: [] });
    await discover('key', { type: 'movie', genres: ['28', '12'], genreMatchMode: 'all' });
    expect(mockedFetch).toHaveBeenCalledWith(
      '/discover/movie',
      'key',
      expect.objectContaining({ with_genres: '28,12' }),
    );

    mockedFetch.mockClear();
    await discover('key', { type: 'movie', genres: ['28', '12'], genreMatchMode: 'any' });
    expect(mockedFetch).toHaveBeenCalledWith(
      '/discover/movie',
      'key',
      expect.objectContaining({ with_genres: '28|12' }),
    );
  });

  it('maps year range to date params for movies', async () => {
    mockedFetch.mockResolvedValue({ page: 1, results: [] });
    await discover('key', { type: 'movie', yearFrom: 2020, yearTo: 2025 });
    expect(mockedFetch).toHaveBeenCalledWith(
      '/discover/movie',
      'key',
      expect.objectContaining({
        'primary_release_date.gte': '2020-01-01',
        'primary_release_date.lte': '2025-12-31',
      }),
    );
  });

  it('maps year range to first_air_date for TV', async () => {
    mockedFetch.mockResolvedValue({ page: 1, results: [] });
    await discover('key', { type: 'series', yearFrom: 2015, yearTo: 2020 });
    expect(mockedFetch).toHaveBeenCalledWith(
      '/discover/tv',
      'key',
      expect.objectContaining({
        'first_air_date.gte': '2015-01-01',
        'first_air_date.lte': '2020-12-31',
      }),
    );
  });

  it('passes vote average range', async () => {
    mockedFetch.mockResolvedValue({ page: 1, results: [] });
    await discover('key', { type: 'movie', ratingMin: 7, ratingMax: 10 });
    expect(mockedFetch).toHaveBeenCalledWith(
      '/discover/movie',
      'key',
      expect.objectContaining({ 'vote_average.gte': 7, 'vote_average.lte': 10 }),
    );
  });

  it('sets watch providers and region', async () => {
    mockedFetch.mockResolvedValue({ page: 1, results: [] });
    await discover('key', { type: 'movie', watchRegion: 'US', watchProviders: ['8', '337'] });
    expect(mockedFetch).toHaveBeenCalledWith(
      '/discover/movie',
      'key',
      expect.objectContaining({ watch_region: 'US', with_watch_providers: '8|337' }),
    );
  });

  it('maps certifications with country', async () => {
    mockedFetch.mockResolvedValue({ page: 1, results: [] });
    await discover('key', { type: 'movie', certifications: ['PG-13', 'R'] });
    expect(mockedFetch).toHaveBeenCalledWith(
      '/discover/movie',
      'key',
      expect.objectContaining({ certification: 'PG-13|R', certification_country: 'US' }),
    );
  });
});

describe('fetchSpecialList', () => {
  it('maps trending_day to correct endpoint', async () => {
    mockedFetch.mockResolvedValue({ page: 1, results: [] });
    await fetchSpecialList('key', 'trending_day', 'movie');
    expect(mockedFetch).toHaveBeenCalledWith('/trending/movie/day', 'key', expect.any(Object));
  });

  it('maps trending_week for series', async () => {
    mockedFetch.mockResolvedValue({ page: 1, results: [] });
    await fetchSpecialList('key', 'trending_week', 'series');
    expect(mockedFetch).toHaveBeenCalledWith('/trending/tv/week', 'key', expect.any(Object));
  });

  it('maps now_playing, upcoming, airing_today, on_the_air', async () => {
    mockedFetch.mockResolvedValue({ page: 1, results: [] });

    await fetchSpecialList('key', 'now_playing', 'movie');
    expect(mockedFetch).toHaveBeenLastCalledWith('/movie/now_playing', 'key', expect.any(Object));

    await fetchSpecialList('key', 'upcoming', 'movie');
    expect(mockedFetch).toHaveBeenLastCalledWith('/movie/upcoming', 'key', expect.any(Object));

    await fetchSpecialList('key', 'airing_today', 'tv');
    expect(mockedFetch).toHaveBeenLastCalledWith('/tv/airing_today', 'key', expect.any(Object));

    await fetchSpecialList('key', 'on_the_air', 'tv');
    expect(mockedFetch).toHaveBeenLastCalledWith('/tv/on_the_air', 'key', expect.any(Object));
  });

  it('maps top_rated and popular', async () => {
    mockedFetch.mockResolvedValue({ page: 1, results: [] });

    await fetchSpecialList('key', 'top_rated', 'movie');
    expect(mockedFetch).toHaveBeenLastCalledWith('/movie/top_rated', 'key', expect.any(Object));

    await fetchSpecialList('key', 'popular', 'series');
    expect(mockedFetch).toHaveBeenLastCalledWith('/tv/popular', 'key', expect.any(Object));
  });

  it('passes language and region params', async () => {
    mockedFetch.mockResolvedValue({ page: 1, results: [] });
    await fetchSpecialList('key', 'popular', 'movie', { displayLanguage: 'de', region: 'DE' });
    expect(mockedFetch).toHaveBeenCalledWith(
      '/movie/popular',
      'key',
      expect.objectContaining({ language: 'de', region: 'DE' }),
    );
  });
});
