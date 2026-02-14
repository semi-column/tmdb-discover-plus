import { describe, it, expect, vi, beforeEach } from 'vitest';

const acquireSpy = vi.fn(async () => {});

vi.mock('../../src/services/cache/index.js', () => ({
  getCache: vi.fn(() => ({
    get: vi.fn(async () => null),
    set: vi.fn(async () => {}),
    getEntry: vi.fn(async () => null),
    setError: vi.fn(async () => {}),
  })),
}));

vi.mock('../../src/infrastructure/tmdbThrottle.js', () => ({
  getTmdbThrottle: vi.fn(() => ({
    acquire: acquireSpy,
  })),
}));

vi.mock('../../src/infrastructure/metrics.js', () => ({
  getMetrics: vi.fn(() => ({
    trackProviderCall: vi.fn(),
    trackError: vi.fn(),
  })),
}));

vi.mock('node-fetch', () => ({
  default: vi.fn(async () => ({
    ok: true,
    text: async () => '{"results":[]}',
  })),
}));

import { tmdbWebsiteFetchJson } from '../../src/services/tmdb/client.ts';

describe('tmdbWebsiteFetchJson', () => {
  beforeEach(() => {
    acquireSpy.mockClear();
  });

  it('calls throttle.acquire before fetching', async () => {
    await tmdbWebsiteFetchJson('/search/keyword', { query: 'test' });

    expect(acquireSpy).toHaveBeenCalled();
  });
});
