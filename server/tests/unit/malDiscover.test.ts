import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockedJikanFetch } = vi.hoisted(() => ({
  mockedJikanFetch: vi.fn(),
}));

vi.mock('../../src/services/mal/client.ts', () => ({
  jikanFetch: mockedJikanFetch,
}));

import { discover, getRanking } from '../../src/services/mal/discover.ts';

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

  it('returns empty result when Jikan returns 500 in discover', async () => {
    mockedJikanFetch.mockRejectedValueOnce(
      Object.assign(new Error('Jikan API error: 500'), { statusCode: 500 })
    );

    const result = await discover({}, 'movie', 1);

    expect(result).toEqual({ anime: [], hasMore: false, total: 0, upstreamUnavailable: true });
  });
});
