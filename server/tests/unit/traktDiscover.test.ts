import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockedTraktFetch } = vi.hoisted(() => ({
  mockedTraktFetch: vi.fn(),
}));

vi.mock('../../src/services/trakt/client.ts', () => ({
  traktFetch: mockedTraktFetch,
}));

import { discover, normalizeTraktListType } from '../../src/services/trakt/discover.ts';

function responseForListType(listType: string) {
  if (listType === 'trending') {
    return [{ watchers: 1, movie: { title: 'A', ids: { trakt: 1, slug: 'a' } } }];
  }
  if (listType === 'popular') {
    return [{ title: 'B', ids: { trakt: 2, slug: 'b' } }];
  }
  if (listType === 'anticipated') {
    return [{ list_count: 1, movie: { title: 'C', ids: { trakt: 3, slug: 'c' } } }];
  }
  if (listType === 'recommended' || listType === 'favorited') {
    return [{ user_count: 1, movie: { title: 'D', ids: { trakt: 4, slug: 'd' } } }];
  }
  if (listType === 'watched' || listType === 'played' || listType === 'collected') {
    return [
      {
        watcher_count: 1,
        play_count: 1,
        collected_count: 1,
        movie: { title: 'E', ids: { trakt: 5, slug: 'e' } },
      },
    ];
  }
  if (listType === 'boxoffice') {
    return [{ revenue: 1, movie: { title: 'F', ids: { trakt: 6, slug: 'f' } } }];
  }
  if (listType === 'calendar' || listType === 'recently_aired') {
    return [{ released: '2024-01-01', movie: { title: 'G', ids: { trakt: 7, slug: 'g' } } }];
  }
  return [];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('trakt discover routing', () => {
  it('normalizes legacy community_stats list type', () => {
    expect(normalizeTraktListType('community_stats')).toBe('watched');
    expect(normalizeTraktListType(undefined)).toBe('calendar');
  });

  it('falls back to calendar when list type is omitted', async () => {
    mockedTraktFetch.mockResolvedValue([
      {
        released: '2025-01-01',
        movie: {
          title: 'Default Calendar',
          ids: { trakt: 999, slug: 'default-calendar' },
        },
      },
    ]);

    const result = await discover(
      {
        traktGenres: ['action'],
      },
      'movie',
      1,
      'client-id'
    );

    expect(mockedTraktFetch).toHaveBeenCalledWith(
      expect.stringContaining('/calendars/all/movies/'),
      'client-id'
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.title).toBe('Default Calendar');
  });

  it('applies endpoint filters to trending lists', async () => {
    mockedTraktFetch.mockResolvedValue([
      {
        watchers: 42,
        movie: {
          title: 'Test',
          ids: { trakt: 1, slug: 'test' },
        },
      },
    ]);

    await discover(
      {
        traktListType: 'trending',
        traktGenres: ['action'],
        traktRatingMin: 80,
      },
      'movie',
      1,
      'client-id'
    );

    expect(mockedTraktFetch).toHaveBeenCalledWith(
      expect.stringContaining('/movies/trending?page=1&limit=20&extended=full'),
      'client-id'
    );
    expect(mockedTraktFetch).toHaveBeenCalledWith(
      expect.stringContaining('genres=action'),
      'client-id'
    );
    expect(mockedTraktFetch).toHaveBeenCalledWith(
      expect.stringContaining('ratings=80-100'),
      'client-id'
    );
  });

  it('serializes year/runtime/country/language filters for trending discover', async () => {
    mockedTraktFetch.mockResolvedValue([
      {
        watchers: 10,
        movie: {
          title: 'Filtered Trending',
          ids: { trakt: 11, slug: 'filtered-trending' },
        },
      },
    ]);

    await discover(
      {
        traktYearMin: 2000,
        traktYearMax: 2025,
        traktRuntimeMin: 30,
        traktRuntimeMax: 120,
        traktCountries: ['IN'],
        traktLanguages: ['hi'],
      },
      'movie',
      1,
      'client-id'
    );

    expect(mockedTraktFetch).toHaveBeenCalledWith(
      expect.stringContaining('years=2000-2025'),
      'client-id'
    );
    expect(mockedTraktFetch).toHaveBeenCalledWith(
      expect.stringContaining('runtimes=30-120'),
      'client-id'
    );
    expect(mockedTraktFetch).toHaveBeenCalledWith(
      expect.stringContaining('countries=IN'),
      'client-id'
    );
    expect(mockedTraktFetch).toHaveBeenCalledWith(
      expect.stringContaining('languages=hi'),
      'client-id'
    );
  });

  it('does not send filters to box office endpoint', async () => {
    mockedTraktFetch.mockResolvedValue([
      {
        revenue: 123,
        movie: {
          title: 'Box',
          ids: { trakt: 2, slug: 'box' },
        },
      },
    ]);

    await discover(
      {
        traktListType: 'boxoffice',
        traktGenres: ['action'],
        traktRatingMin: 80,
      },
      'movie',
      1,
      'client-id'
    );

    expect(mockedTraktFetch).toHaveBeenCalledWith('/movies/boxoffice?extended=full', 'client-id');
  });

  it('routes legacy community_stats to watched endpoint with filters', async () => {
    mockedTraktFetch.mockResolvedValue([
      {
        watcher_count: 10,
        play_count: 12,
        collected_count: 7,
        movie: {
          title: 'Watched',
          ids: { trakt: 3, slug: 'watched' },
        },
      },
    ]);

    await discover(
      {
        traktListType: 'community_stats',
        traktPeriod: 'monthly',
        traktVotesMin: 500,
      },
      'movie',
      1,
      'client-id'
    );

    expect(mockedTraktFetch).toHaveBeenCalledWith(
      expect.stringContaining('/movies/watched/monthly?page=1&limit=20&extended=full'),
      'client-id'
    );
    expect(mockedTraktFetch).toHaveBeenCalledWith(
      expect.stringContaining('votes=500-'),
      'client-id'
    );
  });

  it('does not append filter params for custom list endpoint', async () => {
    mockedTraktFetch.mockResolvedValue([
      {
        rank: 1,
        id: 1,
        listed_at: '2024-01-01T00:00:00.000Z',
        type: 'movie',
        movie: {
          title: 'List Item',
          ids: { trakt: 4, slug: 'list-item' },
        },
      },
    ]);

    await discover(
      {
        traktListType: 'list',
        traktListId: 'username',
        traktGenres: ['comedy'],
      },
      'movie',
      1,
      'client-id'
    );

    expect(mockedTraktFetch).toHaveBeenCalledWith(
      '/users/username/items/movies?page=1&limit=20&extended=full',
      'client-id'
    );
  });

  it.each([
    ['trending', '/movies/trending?'],
    ['popular', '/movies/popular?'],
    ['anticipated', '/movies/anticipated?'],
    ['recommended', '/movies/recommended/monthly?'],
    ['favorited', '/movies/favorited/monthly?'],
    ['watched', '/movies/watched/monthly?'],
    ['played', '/movies/played/monthly?'],
    ['collected', '/movies/collected/monthly?'],
    ['calendar', '/calendars/all/movies/'],
    ['recently_aired', '/calendars/all/movies/'],
    ['boxoffice', '/movies/boxoffice?extended=full'],
  ])('routes %s option to expected endpoint', async (listType, expectedPath) => {
    mockedTraktFetch.mockResolvedValue(responseForListType(listType));

    await discover(
      {
        traktListType: listType,
        traktPeriod: 'monthly',
        traktCalendarType: 'movies',
        traktCalendarDays: 7,
      },
      'movie',
      1,
      'client-id'
    );

    const firstUrl = String(mockedTraktFetch.mock.calls[0][0]);
    expect(firstUrl).toContain(expectedPath);
  });

  it('supports long-range upcoming calendar windows (12 months preset)', async () => {
    mockedTraktFetch.mockResolvedValue(responseForListType('calendar'));

    await discover(
      {
        traktListType: 'calendar',
        traktCalendarType: 'movies',
        traktCalendarDays: 365,
      },
      'movie',
      1,
      'client-id-12mo'
    );

    expect(mockedTraktFetch.mock.calls.length).toBeGreaterThan(1);
    expect(String(mockedTraktFetch.mock.calls[0][0])).toContain('/calendars/all/movies/');
  });

  it('derives future-looking dynamic preset range from today for calendar windows', async () => {
    mockedTraktFetch.mockResolvedValue(responseForListType('calendar'));

    await discover(
      {
        traktListType: 'calendar',
        traktCalendarType: 'movies',
        traktCalendarDays: 30,
      },
      'movie',
      1,
      'client-id-dynamic-preset'
    );

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const expectedStartString = today.toISOString().split('T')[0];

    const firstUrl = String(mockedTraktFetch.mock.calls[0][0]);
    expect(firstUrl).toContain(`/calendars/all/movies/${expectedStartString}/30`);
  });

  it('derives full multi-year dynamic preset range from today for recently aired windows', async () => {
    mockedTraktFetch.mockResolvedValue(responseForListType('recently_aired'));

    await discover(
      {
        traktListType: 'recently_aired',
        traktCalendarType: 'movies',
        traktCalendarDays: 1095,
      },
      'movie',
      1,
      'client-id-dynamic-multi-year-preset'
    );

    const firstUrl = String(mockedTraktFetch.mock.calls[0][0]);
    expect(firstUrl).toContain('/calendars/all/movies/');
    expect(firstUrl).toMatch(/\/(6|33)\?/);
  });

  it('chunks explicit calendar date ranges into <=33 day windows', async () => {
    mockedTraktFetch.mockResolvedValue(responseForListType('calendar'));

    await discover(
      {
        traktListType: 'calendar',
        traktCalendarType: 'movies',
        traktCalendarStartDate: '2024-01-01',
        traktCalendarEndDate: '2024-02-15',
      },
      'movie',
      1,
      'client-id-range'
    );

    const calls = mockedTraktFetch.mock.calls.map((call) => String(call[0]));
    expect(calls.length).toBeGreaterThan(1);
    expect(calls.some((url) => url.includes('/calendars/all/movies/2024-01-01/33'))).toBe(true);
    expect(calls.some((url) => url.includes('/calendars/all/movies/2024-02-03/13'))).toBe(true);
  });

  it('supports descending date order for upcoming calendar range', async () => {
    mockedTraktFetch.mockResolvedValue([
      {
        released: '2024-01-01',
        movie: {
          title: 'Older Upcoming',
          ids: { trakt: 301, slug: 'older-upcoming' },
        },
      },
      {
        released: '2024-01-03',
        movie: {
          title: 'Newer Upcoming',
          ids: { trakt: 302, slug: 'newer-upcoming' },
        },
      },
    ]);

    const result = await discover(
      {
        traktListType: 'calendar',
        traktCalendarType: 'movies',
        traktCalendarDays: 7,
        traktCalendarSort: 'desc',
      },
      'movie',
      1,
      'client-id-calendar-desc'
    );

    expect(result.items[0]?.title).toBe('Newer Upcoming');
    expect(result.items[1]?.title).toBe('Older Upcoming');
  });

  it('defaults upcoming calendar date order to newest first when sort is omitted', async () => {
    mockedTraktFetch.mockResolvedValue([
      {
        released: '2024-01-01',
        movie: {
          title: 'Older Upcoming',
          ids: { trakt: 303, slug: 'older-upcoming-default' },
        },
      },
      {
        released: '2024-01-03',
        movie: {
          title: 'Newer Upcoming',
          ids: { trakt: 304, slug: 'newer-upcoming-default' },
        },
      },
    ]);

    const result = await discover(
      {
        traktListType: 'calendar',
        traktCalendarType: 'movies',
        traktCalendarDays: 7,
      },
      'movie',
      1,
      'client-id-calendar-default-desc'
    );

    expect(result.items[0]?.title).toBe('Newer Upcoming');
    expect(result.items[1]?.title).toBe('Older Upcoming');
  });

  it('supports ascending date order for recently aired range', async () => {
    mockedTraktFetch.mockResolvedValue([
      {
        released: '2024-01-01',
        movie: {
          title: 'Older Aired',
          ids: { trakt: 311, slug: 'older-aired' },
        },
      },
      {
        released: '2024-01-03',
        movie: {
          title: 'Newer Aired',
          ids: { trakt: 312, slug: 'newer-aired' },
        },
      },
    ]);

    const result = await discover(
      {
        traktListType: 'recently_aired',
        traktCalendarType: 'movies',
        traktCalendarDays: 7,
        traktCalendarSort: 'asc',
      },
      'movie',
      1,
      'client-id-recent-asc'
    );

    expect(result.items[0]?.title).toBe('Older Aired');
    expect(result.items[1]?.title).toBe('Newer Aired');
  });

  it('uses latest entries first for long explicit range with descending sort', async () => {
    mockedTraktFetch.mockImplementation(async (url) => {
      const start =
        String(url).match(/\/calendars\/all\/movies\/(\d{4}-\d{2}-\d{2})\//)?.[1] ?? '2000-01-01';
      return [
        {
          released: start,
          movie: {
            title: `Item ${start}`,
            ids: { trakt: Number(start.replace(/-/g, '')), slug: `item-${start}` },
          },
        },
      ];
    });

    const result = await discover(
      {
        traktListType: 'calendar',
        traktCalendarType: 'movies',
        traktCalendarStartDate: '2020-01-01',
        traktCalendarEndDate: '2026-04-07',
        traktCalendarSort: 'desc',
      },
      'movie',
      1,
      'client-id-long-range-desc'
    );

    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items[0]?.title).toContain('2026');
  });

  it('sends Trakt Min Votes as API query param (server-side filtering)', async () => {
    mockedTraktFetch.mockResolvedValue([
      {
        released: '2024-01-01',
        movie: {
          title: 'Low Votes',
          votes: 10,
          ids: { trakt: 71, slug: 'low-votes' },
        },
      },
      {
        released: '2024-01-02',
        movie: {
          title: 'High Votes',
          votes: 500,
          ids: { trakt: 72, slug: 'high-votes' },
        },
      },
    ]);

    await discover(
      {
        traktListType: 'calendar',
        traktCalendarType: 'movies',
        traktCalendarDays: 7,
        traktVotesMin: 100,
      },
      'movie',
      1,
      'client-id-calendar-filter-check'
    );

    // Votes filtering is sent to the API as a query param
    const firstUrl = String(mockedTraktFetch.mock.calls[0][0]);
    expect(firstUrl).toContain('votes=100-');
  });

  it('sends Trakt Rating as API query param (server-side filtering)', async () => {
    mockedTraktFetch.mockResolvedValue([
      {
        released: '2024-01-01',
        movie: {
          title: 'Rated 7.9',
          rating: 7.9,
          ids: { trakt: 81, slug: 'rated-79' },
        },
      },
      {
        released: '2024-01-02',
        movie: {
          title: 'Rated 8.2',
          rating: 8.2,
          ids: { trakt: 82, slug: 'rated-82' },
        },
      },
    ]);

    await discover(
      {
        traktListType: 'calendar',
        traktCalendarType: 'movies',
        traktCalendarDays: 7,
        traktRatingMin: 80,
      },
      'movie',
      1,
      'client-id-calendar-external-strip'
    );

    // Rating filtering is sent to the API as a query param
    const firstUrl = String(mockedTraktFetch.mock.calls[0][0]);
    expect(firstUrl).toContain('ratings=80-100');
  });

  it('sends only supported external rating/vote filters to movie calendar endpoints', async () => {
    mockedTraktFetch.mockResolvedValue([
      {
        released: '2024-01-01',
        movie: {
          title: 'Calendar Item',
          ids: { trakt: 91, slug: 'calendar-item' },
        },
      },
    ]);

    await discover(
      {
        traktListType: 'calendar',
        traktCalendarType: 'movies',
        traktCalendarDays: 7,
        traktImdbRatingMin: 8,
        traktTmdbRatingMin: 7,
        traktRtMeterMin: 80,
        traktRtUserMeterMin: 80,
        traktMetascoreMin: 80,
        traktImdbVotesMin: 1000,
        traktTmdbVotesMin: 1000,
      },
      'movie',
      1,
      'client-id-calendar-external-strip-check'
    );

    const firstUrl = String(mockedTraktFetch.mock.calls[0][0]);
    expect(firstUrl).toContain('imdb_ratings=8-10');
    expect(firstUrl).toContain('tmdb_ratings=7-10');
    expect(firstUrl).toContain('rt_meters=80-100');
    expect(firstUrl).toContain('rt_user_meters=80-100');
    expect(firstUrl).toContain('imdb_votes=1000-');
    expect(firstUrl).toContain('tmdb_votes=1000-');
    expect(firstUrl).not.toContain('metascores=');
  });

  it('sends only supported external rating/vote filters to series calendar endpoints', async () => {
    mockedTraktFetch.mockResolvedValue([
      {
        first_aired: '2024-01-01T00:00:00.000Z',
        show: {
          title: 'Calendar Series Item',
          ids: { trakt: 901, slug: 'calendar-series-item' },
        },
      },
    ]);

    await discover(
      {
        traktListType: 'calendar',
        traktCalendarType: 'shows',
        traktCalendarDays: 7,
        traktImdbRatingMin: 8,
        traktTmdbRatingMin: 7,
        traktRtMeterMin: 80,
        traktRtUserMeterMin: 80,
        traktMetascoreMin: 80,
        traktImdbVotesMin: 1000,
        traktTmdbVotesMin: 1000,
      },
      'series',
      1,
      'client-id-calendar-series-filter-support'
    );

    const firstUrl = String(mockedTraktFetch.mock.calls[0][0]);
    expect(firstUrl).not.toContain('imdb_ratings=');
    expect(firstUrl).toContain('tmdb_ratings=7-10');
    expect(firstUrl).not.toContain('rt_meters=');
    expect(firstUrl).not.toContain('rt_user_meters=');
    expect(firstUrl).not.toContain('metascores=');
    expect(firstUrl).not.toContain('imdb_votes=');
    expect(firstUrl).toContain('tmdb_votes=1000-');
  });

  it('sends Trakt Min Votes as API query param for trending endpoint', async () => {
    mockedTraktFetch.mockResolvedValue([
      {
        watchers: 1,
        movie: {
          title: 'Trending Low Votes',
          votes: 10,
          ids: { trakt: 101, slug: 'trending-low-votes' },
        },
      },
      {
        watchers: 1,
        movie: {
          title: 'Trending High Votes',
          votes: 2000,
          ids: { trakt: 102, slug: 'trending-high-votes' },
        },
      },
    ]);

    await discover(
      {
        traktListType: 'trending',
        traktVotesMin: 100,
      },
      'movie',
      1,
      'client-id'
    );

    // Votes filtering is sent to the API as a query param
    const firstUrl = String(mockedTraktFetch.mock.calls[0][0]);
    expect(firstUrl).toContain('votes=100-');
  });

  it('sends aired episode range as direct endpoint filter when provided', async () => {
    mockedTraktFetch.mockResolvedValue([
      {
        watchers: 1,
        show: {
          title: 'Series Match',
          aired_episodes: 45,
          ids: { trakt: 201, slug: 'series-match' },
        },
      },
    ]);

    await discover(
      {
        traktListType: 'trending',
        traktAiredEpisodesMin: 10,
        traktAiredEpisodesMax: 100,
      },
      'series',
      1,
      'client-id-aired-direct'
    );

    const firstUrl = String(mockedTraktFetch.mock.calls[0][0]);
    expect(firstUrl).toContain('aired_episodes=10-100');
  });

  it('applies aired episode range post-filter as fallback safety net', async () => {
    mockedTraktFetch.mockResolvedValue([
      {
        watchers: 1,
        show: {
          title: 'Short Run',
          aired_episodes: 8,
          ids: { trakt: 211, slug: 'short-run' },
        },
      },
      {
        watchers: 1,
        show: {
          title: 'Long Run',
          aired_episodes: 120,
          ids: { trakt: 212, slug: 'long-run' },
        },
      },
    ]);

    const result = await discover(
      {
        traktListType: 'trending',
        traktAiredEpisodesMin: 50,
      },
      'series',
      1,
      'client-id-aired-fallback'
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.title).toBe('Long Run');
  });

  it('excludes single-season shows for recently aired results', async () => {
    mockedTraktFetch.mockResolvedValue([
      {
        first_aired: '2024-01-01T00:00:00.000Z',
        episode: {
          season: 1,
          number: 4,
          title: 'Episode 4',
          ids: { trakt: 3001, slug: 's1e4' },
        },
        show: {
          title: 'Single Season Show',
          ids: { trakt: 221, slug: 'single-season-show' },
        },
      },
      {
        first_aired: '2024-01-02T00:00:00.000Z',
        episode: {
          season: 2,
          number: 1,
          title: 'Season 2 Premiere',
          ids: { trakt: 3002, slug: 's2e1' },
        },
        show: {
          title: 'Returning Show',
          ids: { trakt: 222, slug: 'returning-show' },
        },
      },
    ]);

    const result = await discover(
      {
        traktListType: 'recently_aired',
        traktCalendarType: 'shows',
        traktCalendarDays: 7,
        traktExcludeSingleSeason: true,
      },
      'series',
      1,
      'client-id-single-season-toggle'
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.title).toBe('Returning Show');
  });

  it('uses different calendar cache identity when single-season toggle changes', async () => {
    mockedTraktFetch.mockResolvedValue([
      {
        first_aired: '2024-01-01T00:00:00.000Z',
        episode: {
          season: 1,
          number: 4,
          title: 'Episode 4',
          ids: { trakt: 3301, slug: 'cache-s1e4' },
        },
        show: {
          title: 'Cached Single Season',
          ids: { trakt: 231, slug: 'cached-single-season' },
        },
      },
      {
        first_aired: '2024-01-02T00:00:00.000Z',
        episode: {
          season: 2,
          number: 1,
          title: 'Season 2 Premiere',
          ids: { trakt: 3302, slug: 'cache-s2e1' },
        },
        show: {
          title: 'Cached Returning Show',
          ids: { trakt: 232, slug: 'cached-returning-show' },
        },
      },
    ]);

    const baseFilters = {
      traktListType: 'recently_aired',
      traktCalendarType: 'shows',
      traktCalendarDays: 7,
    };

    const withoutToggle = await discover(baseFilters, 'series', 1, 'client-id-cache-identity');
    expect(withoutToggle.items).toHaveLength(2);

    const withToggle = await discover(
      {
        ...baseFilters,
        traktExcludeSingleSeason: true,
      },
      'series',
      1,
      'client-id-cache-identity'
    );

    expect(withToggle.items).toHaveLength(1);
    expect(withToggle.items[0]?.title).toBe('Cached Returning Show');
    // Raw cache reuses API data — only 1 fetch needed
    expect(mockedTraktFetch).toHaveBeenCalledTimes(1);
  });
});
