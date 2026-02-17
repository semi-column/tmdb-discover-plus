import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IImdbRatingsAdapter } from '../../src/types/index.ts';

vi.mock('node-fetch', () => ({ default: vi.fn() }));
vi.mock('../../src/utils/logger.ts', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));
vi.mock('../../src/config.ts', () => ({
  config: {
    imdbRatings: {
      updateIntervalHours: 24,
      minVotes: 1000,
      disabled: false,
    },
    cache: { redisUrl: '' },
  },
}));

import {
  initializeRatings,
  getImdbRating,
  getImdbRatingString,
  batchGetImdbRatings,
  forceUpdate,
  isLoaded,
  getStats,
  destroyRatings,
} from '../../src/services/imdbRatings/imdbRatings.ts';
import { MemoryAdapter } from '../../src/services/imdbRatings/MemoryAdapter.ts';

function createMockAdapter(): IImdbRatingsAdapter {
  const ratings = new Map<string, string>();
  const meta = new Map<string, string>();
  return {
    set: vi.fn(async (id, val) => {
      ratings.set(id, val);
    }),
    get: vi.fn(async (id) => ratings.get(id) ?? null),
    getMany: vi.fn(async (ids) => {
      const result = new Map<string, string>();
      for (const id of ids) {
        const val = ratings.get(id);
        if (val) result.set(id, val);
      }
      return result;
    }),
    setBatch: vi.fn(async (entries) => {
      for (const [id, val] of entries) ratings.set(id, val);
    }),
    replaceAll: vi.fn(async (entries) => {
      ratings.clear();
      for (const [id, val] of entries) ratings.set(id, val);
    }),
    clear: vi.fn(async () => {
      ratings.clear();
    }),
    count: vi.fn(async () => ratings.size),
    setMeta: vi.fn(async (key, val) => {
      meta.set(key, val);
    }),
    getMeta: vi.fn(async (key) => meta.get(key) ?? null),
    delMeta: vi.fn(async (key) => {
      meta.delete(key);
    }),
    destroy: vi.fn(async () => {
      ratings.clear();
      meta.clear();
    }),
  };
}

describe('imdbRatings', () => {
  let adapter: IImdbRatingsAdapter;

  beforeEach(async () => {
    await destroyRatings();
    adapter = createMockAdapter();
  });

  afterEach(async () => {
    await destroyRatings();
  });

  describe('getImdbRating', () => {
    it('returns null when not initialized', async () => {
      expect(await getImdbRating('tt1234567')).toBeNull();
    });

    it('returns rating from adapter', async () => {
      await adapter.set('tt1234567', '8.5|150000');
      await initializeRatings(adapter);

      const result = await getImdbRating('tt1234567');
      expect(result).toEqual({ rating: 8.5, votes: 150000 });
    });

    it('returns null for missing ID', async () => {
      await initializeRatings(adapter);
      expect(await getImdbRating('tt9999999')).toBeNull();
    });

    it('returns null for empty string', async () => {
      await initializeRatings(adapter);
      expect(await getImdbRating('')).toBeNull();
    });
  });

  describe('getImdbRatingString', () => {
    it('returns rating as string', async () => {
      await adapter.set('tt1234567', '7.3|50000');
      await initializeRatings(adapter);

      expect(await getImdbRatingString('tt1234567')).toBe('7.3');
    });

    it('returns null for missing ratings', async () => {
      await initializeRatings(adapter);
      expect(await getImdbRatingString('tt9999999')).toBeNull();
    });
  });

  describe('batchGetImdbRatings', () => {
    it('returns ratings map for multiple items', async () => {
      await adapter.set('tt1111111', '8.0|100000');
      await adapter.set('tt2222222', '6.5|50000');
      await initializeRatings(adapter);

      const items = [{ imdb_id: 'tt1111111' }, { imdb_id: 'tt2222222' }, { imdb_id: 'tt3333333' }];
      const result = await batchGetImdbRatings(items);
      expect(result.get('tt1111111')).toBe('8');
      expect(result.get('tt2222222')).toBe('6.5');
      expect(result.has('tt3333333')).toBe(false);
    });

    it('returns empty map when not initialized', async () => {
      const result = await batchGetImdbRatings([{ imdb_id: 'tt1234567' }]);
      expect(result.size).toBe(0);
    });

    it('returns empty map for empty input', async () => {
      await initializeRatings(adapter);
      const result = await batchGetImdbRatings([]);
      expect(result.size).toBe(0);
    });

    it('filters invalid IMDb IDs', async () => {
      await initializeRatings(adapter);
      const items = [{ imdb_id: 'invalid' }, { imdb_id: '' }, {}];
      const result = await batchGetImdbRatings(items);
      expect(result.size).toBe(0);
    });

    it('deduplicates IDs', async () => {
      await adapter.set('tt1234567', '9.0|200000');
      await initializeRatings(adapter);

      const items = [{ imdb_id: 'tt1234567' }, { imdb_id: 'tt1234567' }];
      await batchGetImdbRatings(items);
      expect(adapter.getMany).toHaveBeenCalledWith(['tt1234567']);
    });
  });

  describe('isLoaded / getStats', () => {
    it('reports not loaded before initialization', () => {
      expect(isLoaded()).toBe(false);
    });

    it('reports stats shape', async () => {
      await initializeRatings(adapter);
      const stats = getStats();
      expect(stats).toHaveProperty('loaded');
      expect(stats).toHaveProperty('count');
      expect(stats).toHaveProperty('downloading');
      expect(stats).toHaveProperty('adapter');
      expect(stats).toHaveProperty('totalRequests');
      expect(stats).toHaveProperty('datasetHits');
      expect(stats).toHaveProperty('datasetMisses');
    });
  });

  describe('forceUpdate', () => {
    it('returns failure when not initialized', async () => {
      const result = await forceUpdate();
      expect(result.success).toBe(false);
      expect(result.message).toBe('Not initialized');
    });

    it('clears etag before re-downloading', async () => {
      await adapter.setMeta('etag', 'old-etag');
      await initializeRatings(adapter);
      await forceUpdate();
      expect(adapter.delMeta).toHaveBeenCalledWith('etag');
    });
  });

  describe('destroyRatings', () => {
    it('resets all state', async () => {
      await initializeRatings(adapter);
      await destroyRatings();
      expect(isLoaded()).toBe(false);
      expect(getStats().count).toBe(0);
    });
  });
});

describe('MemoryAdapter', () => {
  let adapter: MemoryAdapter;

  beforeEach(() => {
    adapter = new MemoryAdapter();
  });

  it('stores and retrieves ratings', async () => {
    await adapter.set('tt1234567', '8.5|100000');
    expect(await adapter.get('tt1234567')).toBe('8.5|100000');
  });

  it('returns null for missing keys', async () => {
    expect(await adapter.get('tt9999999')).toBeNull();
  });

  it('batch sets entries', async () => {
    await adapter.setBatch([
      ['tt1111111', '7.0|50000'],
      ['tt2222222', '6.0|30000'],
    ]);
    expect(await adapter.count()).toBe(2);
    expect(await adapter.get('tt1111111')).toBe('7.0|50000');
  });

  it('getMany returns subset', async () => {
    await adapter.setBatch([
      ['tt1111111', '7.0|50000'],
      ['tt2222222', '6.0|30000'],
    ]);
    const result = await adapter.getMany(['tt1111111', 'tt9999999']);
    expect(result.size).toBe(1);
    expect(result.get('tt1111111')).toBe('7.0|50000');
  });

  it('replaceAll atomically swaps data', async () => {
    await adapter.setBatch([['tt0000001', '1.0|100']]);
    expect(await adapter.count()).toBe(1);

    await adapter.replaceAll([
      ['tt1111111', '8.0|50000'],
      ['tt2222222', '9.0|60000'],
    ]);
    expect(await adapter.count()).toBe(2);
    expect(await adapter.get('tt0000001')).toBeNull();
    expect(await adapter.get('tt1111111')).toBe('8.0|50000');
  });

  it('clears all ratings', async () => {
    await adapter.set('tt1234567', '8.0|100000');
    await adapter.clear();
    expect(await adapter.count()).toBe(0);
  });

  it('manages metadata', async () => {
    await adapter.setMeta('etag', 'abc123');
    expect(await adapter.getMeta('etag')).toBe('abc123');
    await adapter.delMeta('etag');
    expect(await adapter.getMeta('etag')).toBeNull();
  });

  it('destroy clears all data', async () => {
    await adapter.set('tt1234567', '8.0|100000');
    await adapter.setMeta('etag', 'test');
    await adapter.destroy();
    expect(await adapter.count()).toBe(0);
    expect(await adapter.getMeta('etag')).toBeNull();
  });
});
