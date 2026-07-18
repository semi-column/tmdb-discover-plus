import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const acquireSpy = vi.fn(async () => {});
const fetchMock = vi.fn(async () => ({
  ok: true,
  text: async () => '{"results":[]}',
}));

vi.mock('../../src/services/cache/index.ts', () => ({
  getCache: vi.fn(() => ({
    get: vi.fn(async () => null),
    set: vi.fn(async () => {}),
    getEntry: vi.fn(async () => null),
    setError: vi.fn(async () => {}),
  })),
}));

vi.mock('../../src/infrastructure/tmdbThrottle.ts', () => ({
  getTmdbThrottle: vi.fn(() => ({
    acquire: acquireSpy,
  })),
}));

import { tmdbWebsiteFetchJson } from '../../src/services/tmdb/client.ts';

describe('tmdbWebsiteFetchJson', () => {
  beforeEach(() => {
    acquireSpy.mockClear();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('calls throttle.acquire before fetching', async () => {
    await tmdbWebsiteFetchJson('/search/keyword', { query: 'test' });

    expect(acquireSpy).toHaveBeenCalled();
  });
});
