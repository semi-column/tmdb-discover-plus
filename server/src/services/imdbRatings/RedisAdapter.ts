import { createClient, type RedisClientType } from 'redis';
import { ImdbRatingsAdapter } from './ImdbRatingsAdapter.ts';
import { createLogger } from '../../utils/logger.ts';

const log = createLogger('ImdbRatings:Redis');

const RATINGS_HASH = 'imdb:ratings';
const META_PREFIX = 'imdb:meta:';
const PIPELINE_BATCH = 10000;

export class RedisAdapter extends ImdbRatingsAdapter {
  private client: RedisClientType;

  constructor(redisUrl: string) {
    super();
    this.client = createClient({ url: redisUrl });
    this.client.on('error', (err: Error) =>
      log.error('Redis client error', { error: err.message })
    );
  }

  async connect(): Promise<void> {
    if (!this.client.isOpen) {
      await this.client.connect();
      log.info('Connected to Redis for IMDB ratings');
    }
  }

  private _ensureReady(): void {
    if (!this.client.isOpen) {
      throw new Error('Redis client is not connected');
    }
  }

  async set(imdbId: string, value: string): Promise<void> {
    this._ensureReady();
    await this.client.hSet(RATINGS_HASH, imdbId, value);
  }

  async get(imdbId: string): Promise<string | null> {
    this._ensureReady();
    try {
      const val = await this.client.hGet(RATINGS_HASH, imdbId);
      return val ?? null;
    } catch (err) {
      log.warn('Redis HGET error', { imdbId, error: (err as Error).message });
      return null;
    }
  }

  async getMany(imdbIds: string[]): Promise<Map<string, string>> {
    this._ensureReady();
    const result = new Map<string, string>();
    if (imdbIds.length === 0) return result;

    try {
      const pipeline = this.client.multi();
      for (const id of imdbIds) {
        pipeline.hGet(RATINGS_HASH, id);
      }
      const replies = await pipeline.exec();

      for (let i = 0; i < imdbIds.length; i++) {
        const val = replies[i];
        if (val) result.set(imdbIds[i], String(val));
      }
    } catch (err) {
      log.warn('Redis pipeline HGET error', { error: (err as Error).message });
      for (const id of imdbIds) {
        const val = await this.get(id);
        if (val) result.set(id, val);
      }
    }

    return result;
  }

  async setBatch(entries: [string, string][]): Promise<void> {
    this._ensureReady();

    for (let i = 0; i < entries.length; i += PIPELINE_BATCH) {
      const batch = entries.slice(i, i + PIPELINE_BATCH);
      const pipeline = this.client.multi();
      for (const [id, val] of batch) {
        pipeline.hSet(RATINGS_HASH, id, val);
      }
      await pipeline.exec();
    }
  }

  async clear(): Promise<void> {
    this._ensureReady();
    await this.client.del(RATINGS_HASH);
  }

  async replaceAll(entries: [string, string][]): Promise<void> {
    this._ensureReady();
    const stagingKey = `${RATINGS_HASH}:staging`;

    await this.client.del(stagingKey);

    for (let i = 0; i < entries.length; i += PIPELINE_BATCH) {
      const batch = entries.slice(i, i + PIPELINE_BATCH);
      const pipeline = this.client.multi();
      for (const [id, val] of batch) {
        pipeline.hSet(stagingKey, id, val);
      }
      await pipeline.exec();
    }

    await this.client.multi().del(RATINGS_HASH).rename(stagingKey, RATINGS_HASH).exec();
  }

  async count(): Promise<number> {
    this._ensureReady();
    try {
      return await this.client.hLen(RATINGS_HASH);
    } catch (e) {
      log.debug('Redis count failed', { error: (e as Error).message });
      return 0;
    }
  }

  async setMeta(key: string, value: string): Promise<void> {
    this._ensureReady();
    await this.client.set(`${META_PREFIX}${key}`, value);
  }

  async getMeta(key: string): Promise<string | null> {
    this._ensureReady();
    try {
      return await this.client.get(`${META_PREFIX}${key}`);
    } catch (e) {
      log.debug('Redis getMeta failed', { key, error: (e as Error).message });
      return null;
    }
  }

  async delMeta(key: string): Promise<void> {
    this._ensureReady();
    await this.client.del(`${META_PREFIX}${key}`);
  }

  async destroy(): Promise<void> {
    try {
      if (this.client.isOpen) {
        await this.client.quit();
        log.info('Redis connection closed');
      }
    } catch (err) {
      log.warn('Error closing Redis connection', { error: (err as Error).message });
    }
  }
}
