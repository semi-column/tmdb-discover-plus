import NodeCache from 'node-cache';
import { CacheInterface } from './CacheInterface.ts';
import { createLogger } from '../../utils/logger.ts';
import { config } from '../../config.ts';

const log = createLogger('MemoryAdapter');

const MAX_KEYS = config.cache.maxKeys;

export class MemoryAdapter extends CacheInterface {
  private cache: NodeCache;
  private evictions: number;

  constructor(options: NodeCache.Options = {}) {
    super();
    this.cache = new NodeCache({
      stdTTL: 3600,
      checkperiod: 300,
      maxKeys: MAX_KEYS,
      useClones: false,
      ...options,
    });
    this.evictions = 0;
  }
  async get(key: string): Promise<unknown | null> {
    return this.cache.get(key);
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
      this.cache.set(key, value, ttlSeconds);
    } catch (err) {
      if ((err as Error).message && (err as Error).message.includes('max keys')) {
        this._evict();
        try {
          this.cache.set(key, value, ttlSeconds);
        } catch (e) {
          log.warn('Cache still full after eviction', { key, error: (e as Error).message });
        }
      }
    }
  }

  async del(key: string): Promise<void> {
    this.cache.del(key);
  }
  private _evict(): void {
    const keys = this.cache.keys();
    const now = Date.now();
    const entries: { key: string; ttl: number }[] = [];
    for (const key of keys) {
      const ttl = this.cache.getTtl(key);
      if (!ttl || ttl <= now) {
        this.cache.del(key);
        this.evictions++;
      } else {
        entries.push({ key, ttl });
      }
    }
    const threshold = Math.floor(MAX_KEYS * 0.9);
    if (entries.length > threshold) {
      entries.sort((a, b) => a.ttl - b.ttl);
      const toEvict = Math.max(entries.length - threshold, Math.floor(MAX_KEYS * 0.1));
      for (let i = 0; i < toEvict && i < entries.length; i++) {
        this.cache.del(entries[i].key);
        this.evictions++;
      }
      log.info('Cache eviction completed', {
        evicted: toEvict,
        remaining: this.cache.keys().length,
        totalEvictions: this.evictions,
      });
    }
  }

  getStats(): Record<string, unknown> {
    const stats = this.cache.getStats();
    return {
      keys: this.cache.keys().length,
      maxKeys: MAX_KEYS,
      hits: stats.hits,
      misses: stats.misses,
      evictions: this.evictions,
    };
  }
}
