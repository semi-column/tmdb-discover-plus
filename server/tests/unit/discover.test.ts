import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockedFetch } = vi.hoisted(() => ({ mockedFetch: vi.fn() }));
const mockWebsiteFetch = vi.fn();

vi.stubGlobal('fetch', mockWebsiteFetch);

vi.mock('../../src/services/tmdb/client.ts', () => ({
  tmdbFetch: mockedFetch,
}));

vi.mock('../../src/services/cache/index.ts', () => ({
  getCache: vi.fn(() => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../src/utils/helpers.ts', async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return { ...orig, shuffleArray: vi.fn((arr: unknown[]) => arr) };
});

import { discover, fetchSpecialList } from '../../src/services/tmdb/discover.ts';

beforeEach(() => {
  vi.clearAllMocks();
  mockWebsiteFetch.mockReset();
});

describe('discover', () => {
  it('calls /discover/movie with default params', async () => {
    mockedFetch.mockResolvedValue({ page: 1, results: [{ id: 1 }], total_pages: 5 });
    await discover('test-key', { type: 'movie' });
    expect(mockedFetch).toHaveBeenCalledWith(
      '/discover/movie',
      'test-key',
      expect.objectContaining({ sort_by: 'popularity.desc', page: 1, include_adult: false })
    );
  });

  it('calls /discover/tv for series type', async () => {
    mockedFetch.mockResolvedValue({ page: 1, results: [] });
    await discover('key', { type: 'series' });
    expect(mockedFetch).toHaveBeenCalledWith('/discover/tv', 'key', expect.any(Object));
  });

  it('returns an empty page above TMDB’s limit without an upstream request', async () => {
    await expect(discover('key', { page: 501 })).resolves.toEqual({
      page: 501,
      results: [],
      total_pages: 0,
      total_results: 0,
    });
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('still fetches the last TMDB page', async () => {
    mockedFetch.mockResolvedValue({ page: 500, results: [] });
    await discover('key', { page: 500 });
    expect(mockedFetch).toHaveBeenCalledWith(
      '/discover/movie',
      'key',
      expect.objectContaining({ page: 500 })
    );
  });

  it.each([0, -2, NaN, Infinity, -Infinity])(
    'normalizes invalid page %s to page 1',
    async (page) => {
      mockedFetch.mockResolvedValue({ page: 1, results: [] });
      await discover('key', { page });
      expect(mockedFetch).toHaveBeenCalledWith(
        '/discover/movie',
        'key',
        expect.objectContaining({ page: 1 })
      );
    }
  );

  it('keeps randomized discovery working when the requested page is above the limit', async () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.999);
    mockedFetch
      .mockResolvedValueOnce({ page: 1, results: [], total_pages: 600 })
      .mockResolvedValueOnce({ page: 500, results: [{ id: 1 }], total_pages: 600 });
    try {
      await discover('key', { page: 501, randomize: true });
      expect(mockedFetch).toHaveBeenCalledTimes(2);
      expect(mockedFetch.mock.calls[0][2]).toMatchObject({ page: 1 });
      expect(mockedFetch.mock.calls[1][2]).toMatchObject({ page: 500 });
    } finally {
      random.mockRestore();
    }
  });

  it('maps genres with correct separator for match mode', async () => {
    mockedFetch.mockResolvedValue({ page: 1, results: [] });
    await discover('key', { type: 'movie', genres: ['28', '12'], genreMatchMode: 'all' });
    expect(mockedFetch).toHaveBeenCalledWith(
      '/discover/movie',
      'key',
      expect.objectContaining({ with_genres: '28,12' })
    );

    mockedFetch.mockClear();
    await discover('key', { type: 'movie', genres: ['28', '12'], genreMatchMode: 'any' });
    expect(mockedFetch).toHaveBeenCalledWith(
      '/discover/movie',
      'key',
      expect.objectContaining({ with_genres: '28|12' })
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
      })
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
      })
    );
  });

  it('passes vote average range', async () => {
    mockedFetch.mockResolvedValue({ page: 1, results: [] });
    await discover('key', { type: 'movie', ratingMin: 7, ratingMax: 10 });
    expect(mockedFetch).toHaveBeenCalledWith(
      '/discover/movie',
      'key',
      expect.objectContaining({ 'vote_average.gte': 7, 'vote_average.lte': 10 })
    );
  });

  it('sets watch providers and region', async () => {
    mockedFetch.mockResolvedValue({ page: 1, results: [] });
    await discover('key', { type: 'movie', watchRegion: 'US', watchProviders: ['8', '337'] });
    expect(mockedFetch).toHaveBeenCalledWith(
      '/discover/movie',
      'key',
      expect.objectContaining({ watch_region: 'US', with_watch_providers: '8|337' })
    );
  });

  it('maps certifications with country', async () => {
    mockedFetch.mockResolvedValue({ page: 1, results: [] });
    await discover('key', { type: 'movie', certifications: ['PG-13', 'R'] });
    expect(mockedFetch).toHaveBeenCalledWith(
      '/discover/movie',
      'key',
      expect.objectContaining({ certification: 'PG-13|R', certification_country: 'US' })
    );
  });

  it('passes region and release type for series discovery', async () => {
    mockedFetch.mockResolvedValue({ page: 1, results: [] });
    await discover('key', { type: 'series', region: 'DE', releaseTypes: ['4'] });
    expect(mockedFetch).toHaveBeenCalledWith(
      '/discover/tv',
      'key',
      expect.objectContaining({ region: 'DE', with_release_type: '4' })
    );
  });

  it('keeps using TMDB discover for company filters in normal discover mode', async () => {
    mockedFetch.mockResolvedValue({ page: 1, results: [] });

    await discover('key', {
      type: 'movie',
      withCompanies: '13510',
    });

    expect(mockWebsiteFetch).not.toHaveBeenCalled();
    expect(mockedFetch).toHaveBeenCalledWith(
      '/discover/movie',
      'key',
      expect.objectContaining({ with_companies: '13510' })
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
      expect.objectContaining({ language: 'de', region: 'DE' })
    );
  });

  it('fetches collection items and paginates parts', async () => {
    mockedFetch.mockResolvedValue({
      id: 10,
      name: 'Example Collection',
      parts: Array.from({ length: 25 }, (_, i) => ({
        id: i + 1,
        title: `Movie ${i + 1}`,
        release_date: `2020-01-${String((i % 28) + 1).padStart(2, '0')}`,
      })),
    });

    const result = (await fetchSpecialList('key', 'collection', 'movie', {
      collectionId: 10,
      page: 2,
    })) as {
      page: number;
      total_pages: number;
      total_results: number;
      results: Array<{ id: number }>;
    };

    expect(mockedFetch).toHaveBeenCalledWith('/collection/10', 'key', {});
    expect(result.page).toBe(2);
    expect(result.total_pages).toBe(2);
    expect(result.total_results).toBe(25);
    expect(result.results).toHaveLength(5);
    expect(result.results[0].id).toBe(21);
  });

  it('preserves the requested collection page instead of clamping to the last page', async () => {
    mockedFetch.mockResolvedValue({
      id: 10,
      name: 'Example Collection',
      parts: Array.from({ length: 25 }, (_, i) => ({ id: i + 1 })),
    });

    await expect(
      fetchSpecialList('key', 'collection', 'movie', { collectionId: 10, page: 3 })
    ).resolves.toMatchObject({
      page: 3,
      total_pages: 2,
      total_results: 25,
      results: [],
    });
    expect(mockedFetch).toHaveBeenCalledExactlyOnceWith('/collection/10', 'key', {});
  });

  it('returns an empty collection page above TMDB’s limit without fetching the collection', async () => {
    await expect(
      fetchSpecialList('key', 'collection', 'movie', { collectionId: 10, page: 501 })
    ).resolves.toEqual({
      page: 501,
      results: [],
      total_pages: 0,
      total_results: 0,
    });
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('returns an empty special-list page above TMDB’s limit without an upstream request', async () => {
    await expect(fetchSpecialList('key', 'popular', 'movie', { page: 501 })).resolves.toEqual({
      page: 501,
      results: [],
      total_pages: 0,
      total_results: 0,
    });
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('still fetches the last TMDB special-list page', async () => {
    mockedFetch.mockResolvedValue({ page: 500, results: [] });
    await fetchSpecialList('key', 'popular', 'movie', { page: 500 });
    expect(mockedFetch).toHaveBeenCalledWith(
      '/movie/popular',
      'key',
      expect.objectContaining({ page: 500 })
    );
  });

  it.each([0, -2, NaN, Infinity, -Infinity])(
    'normalizes special-list page %s to page 1',
    async (page) => {
      mockedFetch.mockResolvedValue({ page: 1, results: [] });
      await fetchSpecialList('key', 'popular', 'movie', { page });
      expect(mockedFetch).toHaveBeenCalledWith(
        '/movie/popular',
        'key',
        expect.objectContaining({ page: 1 })
      );
    }
  );

  it('fetches studio credits through the official API without narrowing Discover filters', async () => {
    mockedFetch.mockResolvedValue({
      page: 2,
      results: [{ id: 222218, genre_ids: [28] }, { id: 225067 }],
      total_results: 147,
      total_pages: 8,
    });

    const result = (await fetchSpecialList('key', 'studio', 'collection', {
      studioId: 13510,
      page: 2,
      displayLanguage: 'de-DE',
      region: 'US',
      genres: ['28'],
      ratingMin: 8,
      releasedOnly: true,
    })) as {
      page: number;
      total_pages: number;
      total_results: number;
      results: Array<{ id: number }>;
      __companyFilmographyIdsOnly?: boolean;
    };

    expect(mockWebsiteFetch).not.toHaveBeenCalled();
    expect(mockedFetch).toHaveBeenCalledExactlyOnceWith('/discover/movie', 'key', {
      page: 2,
      with_companies: '13510',
      sort_by: 'popularity.desc',
      language: 'de-DE',
      include_image_language: 'de-DE,null',
      include_adult: false,
      include_video: true,
      'vote_count.gte': 0,
    });
    expect(result.__companyFilmographyIdsOnly).toBe(true);
    expect(result.total_results).toBe(147);
    expect(result.total_pages).toBe(8);
    expect(result.results).toEqual([{ id: 222218 }, { id: 225067 }]);
    expect(result.page).toBe(2);
  });

  it('honors a supported studio sort and accepts an empty filmography', async () => {
    mockedFetch.mockResolvedValue({ page: 1, results: [], total_results: 0, total_pages: 0 });
    const result = await fetchSpecialList('key', 'studio', 'collection', {
      studioId: '42',
      sortBy: 'release_date.asc',
    });
    expect(mockedFetch.mock.calls[0][2].sort_by).toBe('primary_release_date.asc');
    expect(result).toMatchObject({ results: [], total_results: 0 });
  });

  it('propagates API failures without a website or unfiltered fallback', async () => {
    const error = new Error('TMDB unavailable');
    mockedFetch.mockRejectedValueOnce(error);
    await expect(fetchSpecialList('key', 'studio', 'collection', { studioId: '42' })).rejects.toBe(
      error
    );
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(mockWebsiteFetch).not.toHaveBeenCalled();
  });

  it('keeps studio randomization company-scoped and within the API page limit', async () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.999);
    mockedFetch
      .mockResolvedValueOnce({ page: 1, results: [], total_pages: 600 })
      .mockResolvedValueOnce({
        page: 500,
        results: [{ id: 42 }],
        total_pages: 600,
        total_results: 12000,
      });
    try {
      const result = await fetchSpecialList('key', 'studio', 'collection', {
        studioId: '42',
        sortBy: 'random',
      });
      expect(mockedFetch).toHaveBeenCalledTimes(2);
      for (const call of mockedFetch.mock.calls) {
        expect(call[0]).toBe('/discover/movie');
        expect(call[2].with_companies).toBe('42');
      }
      expect(mockedFetch.mock.calls[1][2].page).toBe(500);
      expect(result).toMatchObject({
        page: 500,
        results: [{ id: 42 }],
        __companyFilmographyIdsOnly: true,
      });
    } finally {
      random.mockRestore();
    }
  });

  it('rejects unsupported studio sorting rather than changing it silently', async () => {
    await expect(
      fetchSpecialList('key', 'studio', 'collection', {
        studioId: '42',
        sortBy: 'collection_order',
      })
    ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it.each([undefined, '', '0', '-1', 'abc', '1|2', ['1'], {}, 1.5, '9007199254740992'])(
    'rejects invalid collection ID %s before an upstream call',
    async (collectionId) => {
      mockedFetch.mockClear();

      await expect(
        fetchSpecialList('key', 'collection', 'movie', { collectionId: collectionId as any })
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
      });
      expect(mockedFetch).not.toHaveBeenCalled();
    }
  );

  it.each([undefined, '', '0', '-1', 'abc', '1|2', ['1'], {}, 1.5])(
    'rejects invalid studio ID %s before any upstream call',
    async (studioId) => {
      await expect(
        fetchSpecialList('key', 'studio', 'collection', { studioId: studioId as any })
      ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
      expect(mockedFetch).not.toHaveBeenCalled();
      expect(mockWebsiteFetch).not.toHaveBeenCalled();
    }
  );

  it('throws when collection list is requested for series type', async () => {
    await expect(
      fetchSpecialList('key', 'collection', 'series', { collectionId: 10 })
    ).rejects.toThrow('TMDB collections are only supported for movies');
  });

  it('throws when studio list is requested for movie type', async () => {
    await expect(fetchSpecialList('key', 'studio', 'movie', { studioId: 10 })).rejects.toThrow(
      'TMDB studio lists are only supported for collection type catalogs'
    );
  });

  it('throws when studio list is requested for series type', async () => {
    await expect(fetchSpecialList('key', 'studio', 'series', { studioId: 10 })).rejects.toThrow(
      'TMDB studio lists are only supported for collection type catalogs'
    );
  });
});

describe('discover — releasedOnly filter', () => {
  it('sets digital-only release type and primary_release_date.lte for movies without region', async () => {
    mockedFetch.mockResolvedValue({ page: 1, results: [] });
    await discover('key', { type: 'movie', releasedOnly: true });
    expect(mockedFetch).toHaveBeenCalledWith(
      '/discover/movie',
      'key',
      expect.objectContaining({
        with_release_type: '4',
        'primary_release_date.lte': expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      })
    );
    const call = mockedFetch.mock.calls[0][2] as Record<string, unknown>;
    expect(call).not.toHaveProperty('release_date.lte');
  });

  it('uses release_date.lte when region is set for movies', async () => {
    mockedFetch.mockResolvedValue({ page: 1, results: [] });
    await discover('key', { type: 'movie', releasedOnly: true, region: 'US' });
    expect(mockedFetch).toHaveBeenCalledWith(
      '/discover/movie',
      'key',
      expect.objectContaining({
        with_release_type: '4',
        'release_date.lte': expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      })
    );
    const call = mockedFetch.mock.calls[0][2] as Record<string, unknown>;
    expect(call).not.toHaveProperty('primary_release_date.lte');
  });

  it('does not override explicit with_release_type when releasedOnly is set for movies', async () => {
    mockedFetch.mockResolvedValue({ page: 1, results: [] });
    await discover('key', { type: 'movie', releasedOnly: true, region: 'US', releaseTypes: ['3'] });
    const call = mockedFetch.mock.calls[0][2] as Record<string, unknown>;
    expect(call.with_release_type).toBe('3');
  });

  it('sets with_status and first_air_date.lte for TV', async () => {
    mockedFetch.mockResolvedValue({ page: 1, results: [] });
    await discover('key', { type: 'series', releasedOnly: true });
    expect(mockedFetch).toHaveBeenCalledWith(
      '/discover/tv',
      'key',
      expect.objectContaining({
        with_status: '0|3|4|5',
        'first_air_date.lte': expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      })
    );
    const call = mockedFetch.mock.calls[0][2] as Record<string, unknown>;
    expect(call).not.toHaveProperty('air_date.lte');
  });

  it('clamps movie yearTo to today when releasedOnly is set and yearTo is in the future', async () => {
    mockedFetch.mockResolvedValue({ page: 1, results: [] });
    await discover('key', { type: 'movie', releasedOnly: true, yearFrom: 2015, yearTo: 2026 });
    const call = mockedFetch.mock.calls[0][2] as Record<string, unknown>;
    const today = new Date().toISOString().split('T')[0];
    expect(call['primary_release_date.lte']).toBe(today);
    expect(call['primary_release_date.gte']).toBe('2015-01-01');
  });

  it('clamps TV yearTo to today when releasedOnly is set and yearTo is in the future', async () => {
    mockedFetch.mockResolvedValue({ page: 1, results: [] });
    await discover('key', { type: 'series', releasedOnly: true, yearFrom: 2015, yearTo: 2026 });
    const call = mockedFetch.mock.calls[0][2] as Record<string, unknown>;
    const today = new Date().toISOString().split('T')[0];
    expect(call['first_air_date.lte']).toBe(today);
    expect(call['first_air_date.gte']).toBe('2015-01-01');
  });

  it('keeps past yearTo date when releasedOnly is set and yearTo is in the past', async () => {
    mockedFetch.mockResolvedValue({ page: 1, results: [] });
    await discover('key', { type: 'movie', releasedOnly: true, yearFrom: 2010, yearTo: 2020 });
    const call = mockedFetch.mock.calls[0][2] as Record<string, unknown>;
    expect(call['primary_release_date.lte']).toBe('2020-12-31');
  });
});
