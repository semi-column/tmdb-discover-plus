import { createClient, type RedisClientType } from 'redis';
import { createLogger } from '../utils/logger.ts';
import type { RevocationStore } from '../utils/security.ts';

const log = createLogger('RevocationStore');

const REVOCATION_KEY_PREFIX = 'jwt:revoked:';

/**
 * Redis-backed JWT revocation store.
 *
 * Each revocation is written as `jwt:revoked:<jti>` with a TTL matching the
 * token's remaining lifetime. Once Redis evicts the key the token has already
 * expired, so no manual cleanup is required.
 *
 * Failures from Redis are propagated up so callers can decide policy
 * (`verifyToken` rejects on store failure — fail closed).
 */
export class RedisRevocationStore implements RevocationStore {
  private client: RedisClientType;
  private connected = false;

  constructor(url: string) {
    this.client = createClient({ url });
    this.client.on('error', (err: Error) =>
      log.error('Redis revocation store error', { error: err.message })
    );
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    await this.client.connect();
    this.connected = true;
    log.info('Connected to Redis revocation store');
  }

  async add(jti: string, expiresAtMs: number): Promise<void> {
    const ttlSeconds = Math.max(1, Math.ceil((expiresAtMs - Date.now()) / 1000));
    await this.client.set(`${REVOCATION_KEY_PREFIX}${jti}`, '1', { EX: ttlSeconds });
  }

  async has(jti: string): Promise<boolean> {
    const result = await this.client.exists(`${REVOCATION_KEY_PREFIX}${jti}`);
    return result === 1;
  }

  async destroy(): Promise<void> {
    if (!this.connected) return;
    try {
      await this.client.quit();
    } finally {
      this.connected = false;
    }
  }
}
