import { createClient } from 'redis';
import { CacheInterface } from './CacheInterface.ts';
import { createLogger } from '../../utils/logger.ts';

const log = createLogger('RedisAdapter');

export class RedisAdapter extends CacheInterface {
  constructor(url) {
    super();
    this.client = createClient({ url });
    this.client.on('error', (err) => log.error('Redis Client Error', { error: err.message }));
  }

  async connect() {
    await this.client.connect();
    log.info('Connected to Redis');
  }

  async get(key) {
    try {
      const val = await this.client.get(key);
      if (val) {
        // Trace what exactly we are getting from Redis
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
      log.warn('Redis get error', { key, error: err.message });
      return null;
    }
  }

  async set(key, value, ttlSeconds) {
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
      log.warn('Redis set error', { key, error: err.message });
    }
  }

  async del(key) {
    try {
      await this.client.del(key);
    } catch (err) {
      log.warn('Redis del error', { key, error: err.message });
    }
  }
}
