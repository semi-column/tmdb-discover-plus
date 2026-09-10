import { beforeEach, describe, expect, it, vi } from 'vitest';

const { cacheSet, cacheGet, mockDiscover, mockGetUserConfig } = vi.hoisted(() => ({
  cacheSet: vi.fn(),
  cacheGet: vi.fn(),
  mockDiscover: vi.fn(),
  mockGetUserConfig: vi.fn(),
}));

vi.mock('../../src/services/cache/index.ts', () => ({
  getCache: () => ({
    get: cacheGet,
    set: cacheSet,
  }),
}));

vi.mock('../../src/services/mal/index.ts', () => ({
  discover: mockDiscover,
  batchConvertToStremioMeta: vi.fn((anime) =>
    anime.map((item) => ({ id: item.id, title: item.title }))
  ),
  getGenres: vi.fn(() => []),
}));

vi.mock('../../src/services/configService.ts', () => ({
  getUserConfig: mockGetUserConfig,
}));

vi.mock('../../src/services/artworkService.ts', () => ({
  createArtworkOptions: vi.fn(() => null),
  resolveContentType: vi.fn((value) => value),
  applyArtworkOverridesToMetaPreviews: vi.fn(async (metas) => metas),
}));

vi.mock('../../src/utils/encryption.ts', () => ({
  decrypt: vi.fn(() => null),
}));

vi.mock('../../src/constants.ts', () => ({
  buildCatalogId: vi.fn(() => 'mal-test'),
  CIRCUIT_BREAKER_DEFAULTS: {
    THRESHOLD: 10,
    WINDOW_MS: 60_000,
    COOLDOWN_MS: 30_000,
  },
}));

import { handleMalCatalogRequest } from '../../src/routes/handlers/malHandler.ts';

describe('mal handler empty results cache behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cacheGet.mockResolvedValue(null);
    mockDiscover.mockResolvedValue({ anime: [], hasMore: false, total: 0 });
    mockGetUserConfig.mockResolvedValue({
      preferences: null,
      catalogs: [
        {
          _id: 'mal-test',
          name: 'MAL Test',
          type: 'movie',
          source: 'mal',
          enabled: true,
          filters: { malRankingType: 'all' },
        },
      ],
    });
  });

  it('does not cache empty MAL catalog responses', async () => {
    const res = {
      json: vi.fn(),
      set: vi.fn(),
    };

    await handleMalCatalogRequest('user-1', 'movie', 'mal-test', {}, res as any, {} as any);

    expect(cacheSet).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ metas: [] });
  });
});
