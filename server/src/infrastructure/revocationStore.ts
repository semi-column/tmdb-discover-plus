import { createClient, type RedisClientType } from 'redis';
import { createLogger } from '../utils/logger.ts';
import { awaitRedisCommand, redisRecoveryOptions } from '../utils/redisConnection.ts';
import { TIMEOUTS } from '../constants.ts';
import type { RevocationStore } from '../utils/security.ts';

const log = createLogger('RevocationStore');

const REVOCATION_KEY_PREFIX = 'jwt:revoked:';

/**
 * Redis-backed JWT revocation store.
 *
 * Each revocation is written as `jwt:revoked:<jti>` with a TTL matching the
 * token's remaining lifetime, so normal TTL expiration needs no manual cleanup.
 * Redis eviction or data loss before then can make a revoked token valid again.
 *
 * Failures from Redis are propagated up so callers can decide policy
 * (`verifyToken` rejects on store failure — fail closed).
 */
export class RedisRevocationStore implements RevocationStore {
  private client: RedisClientType;

  constructor(url: string) {
    this.client = createClient({
      url,
      disableOfflineQueue: true,
      commandOptions: { timeout: TIMEOUTS.REDIS_STARTUP_MS },
      ...redisRecoveryOptions(),
    });
    this.client.on('error', (err: Error) =>
      log.error('Redis revocation store error', { error: err.message })
    );
    this.client.on('ready', () => log.info('Connected to Redis revocation store'));
  }

  get isReady(): boolean {
    return this.client.isReady;
  }

  async connect(): Promise<void> {
    if (this.client.isOpen) return;
    await this.client.connect();
  }

  async add(jti: string, expiresAtMs: number): Promise<void> {
    const ttlSeconds = Math.max(1, Math.ceil((expiresAtMs - Date.now()) / 1000));
    await awaitRedisCommand(
      this.client.set(`${REVOCATION_KEY_PREFIX}${jti}`, '1', { EX: ttlSeconds })
    );
  }

  async has(jti: string): Promise<boolean> {
    const result = await awaitRedisCommand(this.client.exists(`${REVOCATION_KEY_PREFIX}${jti}`));
    return result === 1;
  }

  async destroy(): Promise<void> {
    if (this.client.isOpen) this.client.destroy();
  }
}
