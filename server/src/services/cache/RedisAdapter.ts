import { createClient, type RedisClientType } from 'redis';
import { createLogger } from '../../utils/logger.ts';
import { awaitRedisCommand, redisRecoveryOptions } from '../../utils/redisConnection.ts';
import { TIMEOUTS } from '../../constants.ts';
import type { ICacheAdapter } from '../../types/index.ts';

const log = createLogger('RedisAdapter');

export class RedisAdapter implements ICacheAdapter {
  private client: RedisClientType;

  constructor(url: string) {
    this.client = createClient({
      url,
      disableOfflineQueue: true,
      commandOptions: { timeout: TIMEOUTS.REDIS_STARTUP_MS },
      ...redisRecoveryOptions(),
    });
    this.client.on('error', (err: Error) =>
      log.error('Redis Client Error', { error: err.message })
    );
  }

  // node-redis retries until connected; this only rejects if the client is destroyed.
  async connect(): Promise<void> {
    await this.client.connect();
    log.info('Connected to Redis');
  }

  async get(key: string): Promise<unknown | null> {
    try {
      const val = await awaitRedisCommand(this.client.get(key));
      if (val) {
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
      await awaitRedisCommand(this.client.set(key, stringified, { EX: ttlSeconds }));
    } catch (err) {
      log.warn('Redis set error', { key, error: (err as Error).message });
    }
  }

  async del(key: string): Promise<void> {
    try {
      await awaitRedisCommand(this.client.del(key));
    } catch (err) {
      log.warn('Redis del error', { key, error: (err as Error).message });
    }
  }

  getStats(): Record<string, unknown> {
    return { driver: 'redis', connected: this.client.isReady };
  }
}
