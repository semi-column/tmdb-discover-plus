import { createClient } from 'redis';
import { ImdbRatingsAdapter } from './ImdbRatingsAdapter.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('ImdbRatings:Redis');

/**
 * Redis adapter for IMDb ratings using a Hash (HSET / HGET).
 *
 * Best for environments with Redis (e.g. ElfHosted / Docker).
 * Typical Redis memory cost: ~40–50 MB for ~600K entries.
 * Data persists across restarts; ETag-based conditional downloads skip
 * re-import when the upstream dataset hasn't changed.
 */

const RATINGS_HASH = 'imdb:ratings';
const META_PREFIX = 'imdb:meta:';
const PIPELINE_BATCH = 10000;

export class RedisAdapter extends ImdbRatingsAdapter {
  /**
   * @param {string} redisUrl - Redis connection URL (e.g. redis://localhost:6379)
   */
  constructor(redisUrl) {
    super();
    this.client = createClient({ url: redisUrl });
    this.client.on('error', (err) => log.error('Redis client error', { error: err.message }));
  }

  async connect() {
    if (!this.client.isOpen) {
      await this.client.connect();
      log.info('Connected to Redis for IMDB ratings');
    }
  }

  /** Ensure connected before any operation */
  _ensureReady() {
    if (!this.client.isOpen) {
      throw new Error('Redis client is not connected');
    }
  }

  async set(imdbId, value) {
    this._ensureReady();
    await this.client.hSet(RATINGS_HASH, imdbId, value);
  }

  async get(imdbId) {
    this._ensureReady();
    try {
      const val = await this.client.hGet(RATINGS_HASH, imdbId);
      return val ?? null;
    } catch (err) {
      log.warn('Redis HGET error', { imdbId, error: err.message });
      return null;
    }
  }

  async getMany(imdbIds) {
    this._ensureReady();
    const result = new Map();
    if (imdbIds.length === 0) return result;

    try {
      // Use pipeline for efficient batch reads
      const pipeline = this.client.multi();
      for (const id of imdbIds) {
        pipeline.hGet(RATINGS_HASH, id);
      }
      const replies = await pipeline.exec();

      for (let i = 0; i < imdbIds.length; i++) {
        const val = replies[i];
        if (val) result.set(imdbIds[i], val);
      }
    } catch (err) {
      log.warn('Redis pipeline HGET error', { error: err.message });
      // Fallback: individual lookups
      for (const id of imdbIds) {
        const val = await this.get(id);
        if (val) result.set(id, val);
      }
    }

    return result;
  }

  async setBatch(entries) {
    this._ensureReady();

    // Write in pipelined batches for performance
    for (let i = 0; i < entries.length; i += PIPELINE_BATCH) {
      const batch = entries.slice(i, i + PIPELINE_BATCH);
      const pipeline = this.client.multi();
      for (const [id, val] of batch) {
        pipeline.hSet(RATINGS_HASH, id, val);
      }
      await pipeline.exec();
    }
  }

  async clear() {
    this._ensureReady();
    await this.client.del(RATINGS_HASH);
  }

  async count() {
    this._ensureReady();
    try {
      return await this.client.hLen(RATINGS_HASH);
    } catch {
      return 0;
    }
  }

  async setMeta(key, value) {
    this._ensureReady();
    await this.client.set(`${META_PREFIX}${key}`, value);
  }

  async getMeta(key) {
    this._ensureReady();
    try {
      return await this.client.get(`${META_PREFIX}${key}`);
    } catch {
      return null;
    }
  }

  async delMeta(key) {
    this._ensureReady();
    await this.client.del(`${META_PREFIX}${key}`);
  }

  async destroy() {
    try {
      if (this.client.isOpen) {
        await this.client.quit();
        log.info('Redis connection closed');
      }
    } catch (err) {
      log.warn('Error closing Redis connection', { error: err.message });
    }
  }
}
