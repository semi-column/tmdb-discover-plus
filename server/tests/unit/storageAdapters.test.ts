import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('mongoose', () => {
  const mockUserConfig = {
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
    find: vi.fn(),
    findOneAndDelete: vi.fn(),
    distinct: vi.fn(),
    aggregate: vi.fn(),
  };
  return {
    default: {
      connect: vi.fn(),
      disconnect: vi.fn(),
    },
    ...{ UserConfig: mockUserConfig },
  };
});

vi.mock('../../src/models/UserConfig.ts', () => {
  const mockModel = {
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
    find: vi.fn(),
    findOneAndDelete: vi.fn(),
    distinct: vi.fn(),
    aggregate: vi.fn(),
  };
  return { UserConfig: mockModel };
});

vi.mock('../../src/utils/logger.ts', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { MongoAdapter } from '../../src/services/storage/MongoAdapter.ts';
import { UserConfig } from '../../src/models/UserConfig.ts';

const mockModel = UserConfig as unknown as Record<string, ReturnType<typeof vi.fn>>;

describe('MongoAdapter', () => {
  let adapter: MongoAdapter;

  beforeEach(() => {
    adapter = new MongoAdapter('mongodb://localhost/test');
    vi.clearAllMocks();
  });

  describe('getUserConfig', () => {
    it('returns config for valid userId', async () => {
      const mockConfig = { userId: 'user1', catalogs: [] };
      mockModel.findOne.mockReturnValue({ lean: () => Promise.resolve(mockConfig) });

      const result = await adapter.getUserConfig('user1');
      expect(result).toEqual(mockConfig);
      expect(mockModel.findOne).toHaveBeenCalledWith({ userId: 'user1' });
    });

    it('returns null for empty userId', async () => {
      const result = await adapter.getUserConfig('');
      expect(result).toBeNull();
      expect(mockModel.findOne).not.toHaveBeenCalled();
    });

    it('returns null when not found', async () => {
      mockModel.findOne.mockReturnValue({ lean: () => Promise.resolve(null) });

      const result = await adapter.getUserConfig('missing');
      expect(result).toBeNull();
    });
  });

  describe('saveUserConfig', () => {
    it('upserts config', async () => {
      const config = { userId: 'user1', catalogs: [], apiKeyId: 'key1' };
      mockModel.findOneAndUpdate.mockReturnValue({ lean: () => Promise.resolve(config) });

      const result = await adapter.saveUserConfig(config as any);
      expect(result).toEqual(config);
      expect(mockModel.findOneAndUpdate).toHaveBeenCalledWith(
        { userId: 'user1' },
        { $set: config },
        expect.objectContaining({ new: true, upsert: true })
      );
    });
  });

  describe('getConfigsByApiKeyId', () => {
    it('returns configs sorted by updatedAt', async () => {
      const configs = [{ userId: 'a' }, { userId: 'b' }];
      mockModel.find.mockReturnValue({
        sort: vi.fn().mockReturnValue({
          lean: () => Promise.resolve(configs),
        }),
      });

      const result = await adapter.getConfigsByApiKeyId('key1');
      expect(result).toEqual(configs);
    });

    it('returns empty for empty apiKeyId', async () => {
      const result = await adapter.getConfigsByApiKeyId('');
      expect(result).toEqual([]);
    });
  });

  describe('deleteUserConfig', () => {
    it('returns true when config deleted', async () => {
      mockModel.findOneAndDelete.mockResolvedValue({ userId: 'user1' });
      const result = await adapter.deleteUserConfig('user1');
      expect(result).toBe(true);
    });

    it('returns false when config not found', async () => {
      mockModel.findOneAndDelete.mockResolvedValue(null);
      const result = await adapter.deleteUserConfig('missing');
      expect(result).toBe(false);
    });

    it('returns false for empty userId', async () => {
      const result = await adapter.deleteUserConfig('');
      expect(result).toBe(false);
    });
  });

  describe('getPublicStats', () => {
    it('returns aggregated stats', async () => {
      mockModel.distinct.mockReturnValue({
        then: (fn: (ids: string[]) => number) => Promise.resolve(fn(['key1', 'key2'])),
      });
      mockModel.aggregate.mockResolvedValue([{ total: 5 }]);

      const stats = await adapter.getPublicStats();
      expect(stats).toEqual({ totalUsers: 2, totalCatalogs: 5 });
    });

    it('returns zero catalogs when none exist', async () => {
      mockModel.distinct.mockReturnValue({
        then: (fn: (ids: string[]) => number) => Promise.resolve(fn([])),
      });
      mockModel.aggregate.mockResolvedValue([]);

      const stats = await adapter.getPublicStats();
      expect(stats).toEqual({ totalUsers: 0, totalCatalogs: 0 });
    });
  });
});

vi.mock('pg', () => {
  const mockQuery = vi.fn();
  const mockRelease = vi.fn();
  const mockConnect = vi.fn(() => ({ query: mockQuery, release: mockRelease }));
  const mockEnd = vi.fn();
  function Pool() {
    return { connect: mockConnect, query: mockQuery, end: mockEnd };
  }
  Pool.prototype = {};
  return { default: { Pool }, Pool };
});

import { PostgresAdapter } from '../../src/services/storage/PostgresAdapter.ts';
import pg from 'pg';

const { Pool } = pg;

describe('PostgresAdapter', () => {
  let adapter: PostgresAdapter;
  let mockPool: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new PostgresAdapter('postgresql://localhost/test');
    mockPool = (adapter as unknown as { pool: Record<string, ReturnType<typeof vi.fn>> }).pool;
  });

  describe('getUserConfig', () => {
    it('returns config with merged fields', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{ user_id: 'user1', api_key_id: 'key1', data: { catalogs: [] } }],
      });

      const result = await adapter.getUserConfig('user1');
      expect(result).toEqual({ userId: 'user1', apiKeyId: 'key1', catalogs: [] });
    });

    it('returns null when not found', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });
      const result = await adapter.getUserConfig('missing');
      expect(result).toBeNull();
    });
  });

  describe('saveUserConfig', () => {
    it('upserts and returns saved config', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{ data: { catalogs: [], configName: 'test' } }],
      });

      const result = await adapter.saveUserConfig({
        userId: 'user1',
        apiKeyId: 'key1',
        catalogs: [],
        configName: 'test',
      } as any);
      expect(result.userId).toBe('user1');
      expect(result.apiKeyId).toBe('key1');
    });
  });

  describe('deleteUserConfig', () => {
    it('returns true when row deleted', async () => {
      mockPool.query.mockResolvedValue({ rowCount: 1 });
      expect(await adapter.deleteUserConfig('user1')).toBe(true);
    });

    it('returns false when no row matched', async () => {
      mockPool.query.mockResolvedValue({ rowCount: 0 });
      expect(await adapter.deleteUserConfig('missing')).toBe(false);
    });
  });

  describe('getConfigsByApiKeyId', () => {
    it('returns mapped configs', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          { user_id: 'u1', api_key_id: 'k1', data: { configName: 'a' } },
          { user_id: 'u2', api_key_id: 'k1', data: { configName: 'b' } },
        ],
      });

      const result = await adapter.getConfigsByApiKeyId('k1');
      expect(result).toHaveLength(2);
      expect(result[0].userId).toBe('u1');
      expect(result[1].userId).toBe('u2');
    });
  });

  describe('getPublicStats', () => {
    it('returns parsed stats', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ count: '10' }] })
        .mockResolvedValueOnce({ rows: [{ count: '25' }] });

      const stats = await adapter.getPublicStats();
      expect(stats).toEqual({ totalUsers: 10, totalCatalogs: 25 });
    });
  });
});
