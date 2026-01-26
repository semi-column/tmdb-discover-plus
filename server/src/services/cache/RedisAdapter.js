import { createClient } from 'redis';
import { CacheInterface } from './CacheInterface.js';
import { createLogger } from '../../utils/logger.js';

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
      return val ? JSON.parse(val) : null;
    } catch (err) {
      log.warn('Redis get error', { key, error: err.message });
      return null;
    }
  }

  async set(key, value, ttlSeconds) {
    try {
      await this.client.set(key, JSON.stringify(value), { EX: ttlSeconds });
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
