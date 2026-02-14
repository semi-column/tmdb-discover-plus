import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MockStorageAdapter } from './helpers/mocks.ts';

const mockStorage = new MockStorageAdapter();

vi.mock('../../src/services/storage/index.js', () => ({
  getStorage: vi.fn(() => mockStorage),
}));
vi.mock('../../src/infrastructure/configCache.js', () => {
  const cache = new Map<string, unknown>();
  return {
    getConfigCache: vi.fn(() => ({
      getOrLoad: vi.fn(async (key: string, loader: () => Promise<unknown>) => {
        if (cache.has(key)) return cache.get(key);
        const val = await loader();
        cache.set(key, val);
        return val;
      }),
      invalidate: vi.fn((key: string) => cache.delete(key)),
      set: vi.fn((key: string, val: unknown) => cache.set(key, val)),
      _cache: cache,
    })),
  };
});

import {
  getUserConfig,
  saveUserConfig,
  getConfigsByApiKey,
  getApiKeyFromConfig,
  deleteUserConfig,
} from '../../src/services/configService.js';
import { encrypt } from '../../src/utils/encryption.ts';
import { computeApiKeyId } from '../../src/utils/security.ts';

describe('Config CRUD lifecycle', () => {
  const TEST_API_KEY = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4';
  const USER_ID = 'testuser01';

  beforeEach(() => {
    mockStorage.configs.clear();
    vi.clearAllMocks();
  });

  it('creates a new user config', async () => {
    const encKey = encrypt(TEST_API_KEY);
    await saveUserConfig({
      userId: USER_ID,
      tmdbApiKeyEncrypted: encKey,
      catalogs: [{ name: 'Popular', type: 'movie', filters: {} }],
      preferences: {},
    });

    const stored = await getUserConfig(USER_ID);
    expect(stored).not.toBeNull();
    expect(stored.userId).toBe(USER_ID);
    expect(stored.catalogs).toHaveLength(1);
  });

  it('loads config by userId', async () => {
    const encKey = encrypt(TEST_API_KEY);
    await saveUserConfig({
      userId: USER_ID,
      tmdbApiKeyEncrypted: encKey,
      catalogs: [],
      preferences: {},
    });

    const config = await getUserConfig(USER_ID);
    expect(config).not.toBeNull();
    expect(config.userId).toBe(USER_ID);
  });

  it('loads configs by apiKeyId', async () => {
    const encKey = encrypt(TEST_API_KEY);
    const apiKeyId = await computeApiKeyId(TEST_API_KEY);

    await saveUserConfig({
      userId: USER_ID,
      tmdbApiKeyEncrypted: encKey,
      catalogs: [],
      preferences: {},
    });

    const configs = await getConfigsByApiKey(TEST_API_KEY);
    expect(configs).toHaveLength(1);
    expect((configs[0] as Record<string, unknown>).userId).toBe(USER_ID);
  });

  it('decrypts API key from config', async () => {
    const encKey = encrypt(TEST_API_KEY);
    await saveUserConfig({
      userId: USER_ID,
      tmdbApiKeyEncrypted: encKey,
      catalogs: [],
      preferences: {},
    });

    const config = await getUserConfig(USER_ID);
    expect(getApiKeyFromConfig(config)).toBe(TEST_API_KEY);
  });

  it('updates existing config', async () => {
    const encKey = encrypt(TEST_API_KEY);
    await saveUserConfig({
      userId: USER_ID,
      tmdbApiKeyEncrypted: encKey,
      catalogs: [],
      preferences: {},
    });

    await saveUserConfig({
      userId: USER_ID,
      tmdbApiKeyEncrypted: encKey,
      configName: 'My Setup',
      catalogs: [
        { name: 'Trending', type: 'movie', filters: { sortBy: 'popularity.desc' } },
        { name: 'Top Rated', type: 'series', filters: { sortBy: 'vote_average.desc' } },
      ],
      preferences: { defaultLanguage: 'es' },
    });

    const config = await getUserConfig(USER_ID);
    expect(config.configName).toBe('My Setup');
    expect(config.catalogs).toHaveLength(2);
    expect(config.preferences.defaultLanguage).toBe('es');
  });

  it('deletes a config', async () => {
    const encKey = encrypt(TEST_API_KEY);
    await saveUserConfig({
      userId: USER_ID,
      tmdbApiKeyEncrypted: encKey,
      catalogs: [],
      preferences: {},
    });

    await deleteUserConfig(USER_ID, TEST_API_KEY);

    const config = await getUserConfig(USER_ID);
    expect(config).toBeNull();
  });

  it('reject delete with wrong API key', async () => {
    const encKey = encrypt(TEST_API_KEY);
    await saveUserConfig({
      userId: USER_ID,
      tmdbApiKeyEncrypted: encKey,
      catalogs: [],
      preferences: {},
    });

    await expect(deleteUserConfig(USER_ID, 'b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5')).rejects.toThrow(
      'Access denied'
    );
  });

  it('returns null for non-existent userId', async () => {
    const config = await getUserConfig('nonexistent');
    expect(config).toBeNull();
  });
});
