import NodeCache from 'node-cache';
import { CacheInterface } from './CacheInterface.js';

export class MemoryAdapter extends CacheInterface {
  constructor(options = {}) {
    super();
    this.cache = new NodeCache({
      stdTTL: 3600,
      checkperiod: 600,
      maxKeys: 5000,
      useClones: false,
      ...options,
    });
  }

  // Sync wrapper to match async interface
  async get(key) {
    return this.cache.get(key);
  }

  async set(key, value, ttlSeconds) {
    this.cache.set(key, value, ttlSeconds);
  }

  async del(key) {
    this.cache.del(key);
  }
}
