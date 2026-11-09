import { createHash } from 'node:crypto';
import { createClient, type RedisClientType } from 'redis';
import { getConfigCache } from './configCache.ts';
import { config } from '../config.ts';
import { createLogger } from '../utils/logger.ts';
import {
  awaitRedisCommand,
  awaitRedisStartup,
  redisRecoveryOptions,
} from '../utils/redisConnection.ts';
import { isValidUserId } from '../utils/validation.ts';
import { TIMEOUTS } from '../constants.ts';
import type { IStorageAdapter } from '../types/index.ts';

const log = createLogger('ConfigInvalidation');

/** TTL remains the recovery backstop for failed publications and missed notifications. */
export class ConfigInvalidation {
  private publisher: RedisClientType;
  private subscriber: RedisClientType;
  private channel: string;

  constructor(url: string, storageIdentity: string) {
    this.channel = `config:invalidate:${createHash('sha256').update(storageIdentity).digest('hex')}`;
    this.publisher = createClient({
      url,
      disableOfflineQueue: true,
      commandOptions: { timeout: TIMEOUTS.REDIS_STARTUP_MS },
      ...redisRecoveryOptions(),
    });
    this.subscriber = this.publisher.duplicate();
    for (const client of [this.publisher, this.subscriber]) {
      client.on('error', (error: Error) => {
        getConfigCache().clear();
        log.warn('Config invalidation Redis error; retaining TTL recovery', {
          error: error.message,
        });
      });
    }
    this.subscriber.on('ready', () => getConfigCache().clear());
  }

  async connect(): Promise<void> {
    await Promise.all([
      this.publisher.connect(),
      this.subscriber.connect().then(() =>
        this.subscriber.subscribe(this.channel, (userId) => {
          if (!isValidUserId(userId)) {
            log.warn('Invalid config invalidation notification');
            return;
          }
          getConfigCache().invalidate(userId);
        })
      ),
    ]);
  }

  async invalidate(userId: string): Promise<void> {
    getConfigCache().invalidate(userId);
    try {
      await awaitRedisCommand(this.publisher.publish(this.channel, userId));
    } catch (error) {
      log.warn('Config saved/deleted but invalidation publication failed; TTL recovery remains', {
        error: (error as Error).message,
      });
    }
  }

  destroy(): void {
    if (this.subscriber.isOpen) this.subscriber.destroy();
    if (this.publisher.isOpen) this.publisher.destroy();
  }
}

export function synchronizeConfigWrites(storage: IStorageAdapter): void {
  const sharedStorage =
    config.database.driver !== 'memory' &&
    !!(config.database.postgresUri || config.database.mongodbUri);
  const sync =
    sharedStorage && config.cache.redisUrl
      ? new ConfigInvalidation(
          config.cache.redisUrl,
          config.database.driver === 'mongo'
            ? config.database.mongodbUri
            : config.database.postgresUri || config.database.mongodbUri
        )
      : null;
  if (sync) {
    void awaitRedisStartup(sync.connect()).catch((error: Error) =>
      log.warn('Config invalidation startup incomplete; TTL recovery remains', {
        error: error.message,
      })
    );
  }
  const invalidate = async (userId: string) => {
    if (sync) await sync.invalidate(userId);
    else getConfigCache().invalidate(userId);
  };
  const save = storage.saveUserConfig.bind(storage);
  storage.saveUserConfig = async (value) => {
    const result = await save(value);
    await invalidate(result.userId);
    return result;
  };
  const remove = storage.deleteUserConfig.bind(storage);
  storage.deleteUserConfig = async (userId) => {
    const result = await remove(userId);
    await invalidate(userId);
    return result;
  };
  const disconnect = storage.disconnect.bind(storage);
  storage.disconnect = async () => {
    sync?.destroy();
    await disconnect();
  };
}
