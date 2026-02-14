import type { ICacheAdapter, CacheWrapperEntry } from '../../../src/types/index.ts';

export class MockCacheAdapter implements ICacheAdapter {
  store = new Map<string, unknown>();

  async get(key: string): Promise<unknown> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: unknown, _ttl?: number): Promise<void> {
    this.store.set(key, value);
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

export class FailingCacheAdapter implements ICacheAdapter {
  async get(_key: string): Promise<unknown> {
    throw new Error('Cache get failed');
  }
  async set(_key: string, _value: unknown): Promise<void> {
    throw new Error('Cache set failed');
  }
  async del(_key: string): Promise<void> {
    throw new Error('Cache del failed');
  }
}

export function createMockTmdbResponse(overrides: Record<string, unknown> = {}) {
  return {
    page: 1,
    total_pages: 10,
    total_results: 200,
    results: [
      {
        id: 550,
        title: 'Fight Club',
        popularity: 61.4,
        vote_average: 8.4,
        poster_path: '/poster.jpg',
        release_date: '1999-10-15',
      },
      {
        id: 680,
        title: 'Pulp Fiction',
        popularity: 55.2,
        vote_average: 8.5,
        poster_path: '/poster2.jpg',
        release_date: '1994-09-10',
      },
    ],
    ...overrides,
  };
}

export class MockStorageAdapter {
  configs = new Map<string, unknown>();

  async connect(): Promise<void> {}

  async getUserConfig(userId: string): Promise<unknown> {
    return this.configs.get(userId) ?? null;
  }

  async saveUserConfig(config: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.configs.set(config.userId as string, config);
    return config;
  }

  async deleteUserConfig(userId: string): Promise<void> {
    this.configs.delete(userId);
  }

  async getAllConfigs(): Promise<unknown[]> {
    return Array.from(this.configs.values());
  }

  async getConfigsByApiKeyId(apiKeyId: string): Promise<unknown[]> {
    const results: unknown[] = [];
    for (const config of this.configs.values()) {
      if ((config as Record<string, unknown>).apiKeyId === apiKeyId) {
        results.push(config);
      }
    }
    return results;
  }

  async getPublicStats(): Promise<{ totalUsers: number; totalCatalogs: number }> {
    let totalCatalogs = 0;
    for (const config of this.configs.values()) {
      totalCatalogs += (((config as Record<string, unknown>).catalogs as unknown[]) || []).length;
    }
    return { totalUsers: this.configs.size, totalCatalogs };
  }
}
