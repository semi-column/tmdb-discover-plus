import type { ICacheAdapter } from '../../types/index.ts';

export abstract class CacheInterface implements ICacheAdapter {
  abstract get(key: string): Promise<unknown | null>;
  abstract set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  abstract del(key: string): Promise<void>;
}
