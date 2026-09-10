import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockedJikanFetch } = vi.hoisted(() => ({
  mockedJikanFetch: vi.fn(),
}));

vi.mock('../../src/services/mal/client.ts', () => ({
  jikanFetch: mockedJikanFetch,
}));

import {
  browseAnime,
  discover,
  getRanking,
  getSeasonal,
  randomPageWithin,
} from '../../src/services/mal/discover.ts';

beforeEach(() => {
  vi.clearAllMocks();
  mockedJikanFetch.mockResolvedValue({
    pagination: {
      last_visible_page: 1,
      has_next_page: false,
      current_page: 1,
      items: { count: 0, total: 0, per_page: 25 },
    },
    data: [],
  });
});

describe('mal discover ranking query mapping', () => {
  it('selects random pages inclusively within the reported last page', () => {
    expect(randomPageWithin(10, () => 0)).toBe(1);
    expect(randomPageWithin(10, () => 0.999999)).toBe(10);
    expect(randomPageWithin(0, () => 0.5)).toBe(1);
    expect(randomPageWithin(undefined, () => 0.5)).toBe(1);
  });

  it('exposes Jikan last_visible_page for bounded randomization', async () => {
    mockedJikanFetch.mockResolvedValueOnce({
      pagination: {
        last_visible_page: 37,
        has_next_page: true,
        current_page: 1,
        items: { count: 25, total: 905, per_page: 25 },
      },
      data: [],
    });

    const result = await browseAnime({}, 'movie', 1);

    expect(result.lastPage).toBe(37);
  });

  it('adds movie type param for rankingType all on movie', async () => {
    mockedJikanFetch.mockResolvedValueOnce({
      pagination: {
        last_visible_page: 20,
        has_next_page: true,
        current_page: 1,
        items: { count: 25, total: 5077, per_page: 25 },
      },
      data: [],
    });

    const result = await getRanking('all', 'movie', 1);

    const calledPath = String(mockedJikanFetch.mock.calls[0][0]);
    expect(calledPath).toContain('/top/anime?');
    expect(calledPath).toContain('page=1');
    expect(calledPath).not.toContain('sfw=');
    expect(calledPath).toContain('type=movie');
    expect(result).toMatchObject({ total: 5077 });
  });

  it('ignores legacy includeAdult settings without adding an SFW parameter', async () => {
    await discover({ includeAdult: true }, 'movie', 1);

    const calledPath = String(mockedJikanFetch.mock.calls[0][0]);
    expect(calledPath).not.toContain('sfw=');
  });

  it('adds tv type param for rankingType all on series', async () => {
    await getRanking('all', 'series', 1);

    const calledPath = String(mockedJikanFetch.mock.calls[0][0]);
    expect(calledPath).toContain('type=tv');
  });

  it('keeps all unscoped for anime type', async () => {
    await getRanking('all', 'anime', 1);

    const calledPath = String(mockedJikanFetch.mock.calls[0][0]);
    expect(calledPath).not.toContain('type=');
  });

  it('keeps type param for filter rankings', async () => {
    await getRanking('airing', 'movie', 1);

    const calledPath = String(mockedJikanFetch.mock.calls[0][0]);
    expect(calledPath).toContain('filter=airing');
    expect(calledPath).toContain('type=movie');
  });

  it('maps seasonal sort values to valid Jikan params', async () => {
    mockedJikanFetch.mockResolvedValueOnce({
      pagination: {
        last_visible_page: 1,
        has_next_page: false,
        current_page: 1,
        items: { count: 1, total: 1, per_page: 25 },
      },
      data: [
        {
          mal_id: 1,
          title: 'Example',
          images: { jpg: { image_url: 'https://example.com/poster.jpg' } },
          type: 'tv',
          score: 8,
          popularity: 42,
          genres: [],
          studios: [],
        },
      ],
    });

    await getSeasonal(2024, 'spring', 'anime_num_list_users', 'series', 1);

    const calledPath = String(mockedJikanFetch.mock.calls[0][0]);
    expect(calledPath).toContain('order_by=members');
    expect(calledPath).toContain('sort=desc');
  });

  it('applies browse filters for status, rating, type, and ordering', async () => {
    mockedJikanFetch.mockResolvedValueOnce({
      pagination: {
        last_visible_page: 1,
        has_next_page: false,
        current_page: 1,
        items: { count: 1, total: 1, per_page: 25 },
      },
      data: [
        {
          mal_id: 1,
          title: 'Example',
          images: { jpg: { image_url: 'https://example.com/poster.jpg' } },
          type: 'movie',
          score: 8,
          popularity: 42,
          genres: [],
          studios: [],
        },
      ],
    });

    await browseAnime(
      {
        malMediaType: ['movie'],
        malStatus: ['airing'],
        malRating: 'pg13',
        malGenres: [1, 2],
        malOrderBy: 'score',
      },
      'movie',
      1
    );

    const calledPath = String(mockedJikanFetch.mock.calls[0][0]);
    expect(calledPath).toContain('type=movie');
    expect(calledPath).toContain('status=airing');
    expect(calledPath).toContain('rating=pg13');
    expect(calledPath).toContain('genres=1%2C2');
    expect(calledPath).toContain('order_by=score');
    expect(calledPath).toContain('sort=desc');
  });

  it('uses comma-separated `types` when multiple media types are selected', async () => {
    await browseAnime({ malMediaType: ['tv', 'movie', 'ona'] }, 'anime', 1);

    const calledPath = String(mockedJikanFetch.mock.calls[0][0]);
    expect(calledPath).toContain('types=tv%2Cmovie%2Cona');
    expect(calledPath).not.toMatch(/[?&]type=/);
  });

  it('applies exclude_types, sfw, and aired date range filters', async () => {
    await browseAnime(
      {
        malExcludeMediaType: ['music', 'pv'],
        malSfw: true,
        malAiredFrom: '2020-01-01',
        malAiredTo: '2021-01-01',
      },
      'anime',
      1
    );

    const calledPath = String(mockedJikanFetch.mock.calls[0][0]);
    expect(calledPath).toContain('exclude_types=music%2Cpv');
    expect(calledPath).toContain('sfw=true');
    expect(calledPath).toContain('start_date=2020-01-01');
    expect(calledPath).toContain('end_date=2021-01-01');
  });

  it('falls back to the ranking endpoint when a special media type query returns no results', async () => {
    mockedJikanFetch
      .mockResolvedValueOnce({
        pagination: {
          last_visible_page: 1,
          has_next_page: false,
          current_page: 1,
          items: { count: 0, total: 0, per_page: 25 },
        },
        data: [],
      })
      .mockResolvedValueOnce({
        pagination: {
          last_visible_page: 2,
          has_next_page: true,
          current_page: 1,
          items: { count: 25, total: 50, per_page: 25 },
        },
        data: [
          {
            mal_id: 42,
            title: 'Special fallback result',
            images: { jpg: { image_url: 'https://example.com/poster.jpg' } },
            type: 'special',
            score: 7.8,
            popularity: 14,
            genres: [],
            studios: [],
          },
        ],
      });

    const result = await browseAnime({ malMediaType: ['special'] }, 'movie', 1);

    expect(result.anime).toHaveLength(1);
    expect(result.anime[0].title).toBe('Special fallback result');
    expect(String(mockedJikanFetch.mock.calls[0][0])).toContain('type=special');
    expect(String(mockedJikanFetch.mock.calls[1][0])).toContain('/top/anime?');
    expect(String(mockedJikanFetch.mock.calls[1][0])).toContain('type=special');
  });

  it('returns empty result with upstreamUnavailable when both primary and fallback Jikan calls fail', async () => {
    mockedJikanFetch
      .mockRejectedValueOnce(Object.assign(new Error('Jikan API error: 500'), { statusCode: 500 }))
      .mockRejectedValueOnce(Object.assign(new Error('Jikan API error: 500'), { statusCode: 500 }));

    const result = await discover({}, 'movie', 1);

    expect(result).toEqual({ anime: [], hasMore: false, total: 0, upstreamUnavailable: true });
  });
});
