import NodeCache from 'node-cache';
import { CacheInterface } from './CacheInterface.ts';
import { createLogger } from '../../utils/logger.ts';
import { config } from '../../config.ts';

const log = createLogger('MemoryAdapter');

const MAX_KEYS = config.cache.maxKeys;

export class MemoryAdapter extends CacheInterface {
  constructor(options = {}) {
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

  // Sync wrapper to match async interface
  async get(key) {
    return this.cache.get(key);
  }

  async set(key, value, ttlSeconds) {
    try {
      this.cache.set(key, value, ttlSeconds);
    } catch (err) {
      if (err.message && err.message.includes('max keys')) {
        // Evict expired + oldest entries, then retry once
        this._evict();
        try {
          this.cache.set(key, value, ttlSeconds);
        } catch {
          // Still full after eviction — skip silently
        }
      }
    }
  }

  async del(key) {
    this.cache.del(key);
  }

  /**
   * Evict entries when cache is full.
   * 1. Flush all expired keys (node-cache may hold them until checkperiod)
   * 2. If still at capacity, delete ~10% of oldest entries by TTL remaining
   */
  _evict() {
    // Force expire check
    const keys = this.cache.keys();
    const now = Date.now();

    // Collect entries with their remaining TTL
    const entries = [];
    for (const key of keys) {
      const ttl = this.cache.getTtl(key);
      if (!ttl || ttl <= now) {
        // Already expired — delete immediately
        this.cache.del(key);
        this.evictions++;
      } else {
        entries.push({ key, ttl });
      }
    }

    // If still above 90% capacity, evict the 10% with shortest remaining TTL
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

  getStats() {
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
