import { createLogger } from './logger.ts';

export interface RedisOrMemoryResult<T> {
  adapter: T;
  driver: 'redis' | 'memory';
  degraded: boolean;
}

/**
 * Shared driver-selection policy for the cache and IMDb-ratings adapter
 * factories: an explicit 'redis' driver (or no driver set, with a Redis URL
 * present) tries Redis first and falls back to Memory on connect failure;
 * an explicit 'memory' driver, or no Redis URL at all, always uses Memory.
 */
export async function resolveRedisOrMemory<T>(options: {
  redisUrl: string | undefined;
  driver: string | undefined;
  createRedis: (redisUrl: string) => Promise<T>;
  createMemory: () => T;
  logLabel: string;
}): Promise<RedisOrMemoryResult<T>> {
  const { redisUrl, driver, createRedis, createMemory, logLabel } = options;
  const log = createLogger(logLabel);

  if (driver !== 'memory' && redisUrl) {
    try {
      log.info(`Initializing Redis Adapter (${driver === 'redis' ? 'Explicit' : 'Auto-detected'})`);
      const adapter = await createRedis(redisUrl);
      return { adapter, driver: 'redis', degraded: false };
    } catch (err) {
      log.warn('Redis init failed, falling back to Memory Adapter', {
        error: (err as Error).message,
      });
      return { adapter: createMemory(), driver: 'memory', degraded: true };
    }
  }

  log.info(`Initializing Memory Adapter (${driver === 'memory' ? 'Explicit' : 'Default'})`);
  return { adapter: createMemory(), driver: 'memory', degraded: false };
}
