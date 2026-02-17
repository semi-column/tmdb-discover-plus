import { createClient, type RedisClientType } from 'redis';
import { CacheInterface } from './CacheInterface.ts';
import { createLogger } from '../../utils/logger.ts';

const log = createLogger('RedisAdapter');

export class RedisAdapter extends CacheInterface {
  private client: RedisClientType;

  constructor(url: string) {
    super();
    this.client = createClient({ url });
    this.client.on('error', (err: Error) =>
      log.error('Redis Client Error', { error: err.message })
    );
  }

  async connect(): Promise<void> {
    await this.client.connect();
    log.info('Connected to Redis');
  }

  async get(key: string): Promise<unknown | null> {
    try {
      const val = await this.client.get(key);
      if (val) {
        if (key.includes('tmdb_')) {
          log.debug(`Redis GET ${key}:`, {
            type: typeof val,
            length: val.length,
            preview: val.substring(0, 100),
          });
        }
        return JSON.parse(val);
      }
      return null;
    } catch (err) {
      log.warn('Redis get error', { key, error: (err as Error).message });
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
      const stringified = JSON.stringify(value);
      if (key.includes('tmdb_')) {
        log.debug(`Redis SET ${key}:`, {
          originalType: typeof value,
          stringLength: stringified.length,
          ttl: ttlSeconds,
        });
      }
      await this.client.set(key, stringified, { EX: ttlSeconds });
    } catch (err) {
      log.warn('Redis set error', { key, error: (err as Error).message });
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch (err) {
      log.warn('Redis del error', { key, error: (err as Error).message });
    }
  }

  getStats(): Record<string, unknown> {
    return { driver: 'redis' };
  }
}
