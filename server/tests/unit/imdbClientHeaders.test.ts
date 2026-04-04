import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockFetch,
  mockConfig,
  cacheGet,
  cacheSet,
  cacheSetError,
  throttleAcquire,
  trackProviderCall,
  recordImdbApiCall,
} = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockConfig: {
    imdbApi: {
      apiKey: 'test-key',
      apiHost: 'imdb-api.semicolumn.workers.dev',
      apiKeyHeader: 'x-rapidapi-key',
      apiHostHeader: 'x-rapidapi-host',
      rateLimit: 5,
    },
    addon: {
      variant: 'nightly',
    },
    baseUrl: 'https://tmdb-nightly.elfhosted.com',
    logging: { level: 'info', format: 'text' },
    nodeEnv: 'test',
  },
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  cacheSetError: vi.fn(),
  throttleAcquire: vi.fn(),
  trackProviderCall: vi.fn(),
  recordImdbApiCall: vi.fn(),
}));

vi.mock('node-fetch', () => ({
  default: mockFetch,
}));

vi.mock('../../src/config.ts', () => ({
  config: mockConfig,
}));

vi.mock('../../src/services/cache/index.ts', () => ({
  getCache: vi.fn(() => ({
    get: cacheGet,
    set: cacheSet,
    setError: cacheSetError,
  })),
}));

vi.mock('../../src/infrastructure/imdbThrottle.ts', () => ({
  getImdbThrottle: vi.fn(() => ({
    acquire: throttleAcquire,
  })),
}));

vi.mock('../../src/infrastructure/imdbQuota.ts', () => ({
  isQuotaExceeded: vi.fn(() => false),
  recordImdbApiCall,
}));

vi.mock('../../src/infrastructure/metrics.ts', () => ({
  getMetrics: vi.fn(() => ({
    trackProviderCall,
  })),
}));

vi.mock('../../src/utils/requestContext.ts', () => ({
  getRequestId: vi.fn(() => 'req-test-1'),
}));

import { imdbFetch, resetImdbCircuitBreaker } from '../../src/services/imdb/client.ts';

describe('imdb client outbound caller headers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetImdbCircuitBreaker();
    cacheGet.mockResolvedValue(null);
    cacheSet.mockResolvedValue(undefined);
    cacheSetError.mockResolvedValue(undefined);
    throttleAcquire.mockResolvedValue(undefined);
    mockConfig.addon.variant = 'nightly';
    mockConfig.baseUrl = 'https://tmdb-nightly.elfhosted.com';

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
  });

  it('sends attribution headers with nightly variant and host label', async () => {
    await imdbFetch('/api/imdb/genres', {}, 120, 0);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, options] = mockFetch.mock.calls[0] as [string, { headers: Record<string, string> }];
    const headers = options.headers;

    expect(headers['x-tmdbdp-source']).toBe('tmdb-discover-plus');
    expect(headers['x-tmdbdp-variant']).toBe('nightly');
    expect(headers['x-tmdbdp-caller']).toBe('nightly:tmdb-nightly.elfhosted.com');
    expect(headers['x-rapidapi-key']).toBe('test-key');
    expect(headers['x-rapidapi-host']).toBe('imdb-api.semicolumn.workers.dev');
  });

  it('falls back to stable:unknown when variant and base url are not set', async () => {
    mockConfig.addon.variant = '';
    mockConfig.baseUrl = '';

    await imdbFetch('/api/imdb/genres', {}, 120, 0);

    const [, options] = mockFetch.mock.calls[0] as [string, { headers: Record<string, string> }];
    const headers = options.headers;

    expect(headers['x-tmdbdp-variant']).toBe('stable');
    expect(headers['x-tmdbdp-caller']).toBe('stable:unknown');
  });
});
