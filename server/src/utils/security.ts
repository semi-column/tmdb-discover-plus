import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { createLogger } from './logger.ts';
import { logSwallowedError } from './helpers.ts';
import { config } from '../config.ts';

import type { Logger } from '../types/index.ts';

const log = createLogger('security') as Logger;

/**
 * Token lifetime policy.
 *
 * All issued tokens carry an `exp` claim. Tokens lacking `exp` are rejected at
 * verify time — there is no never-expiring path.
 */
export const JWT_EXPIRY_REMEMBER_ME = '30d';
export const JWT_EXPIRY_SESSION = '24h';

const PBKDF2_CACHE_MAX = 1000;
const PBKDF2_CACHE_TTL_MS = 60 * 60 * 1000;
const pbkdf2Cache = new Map<string, { value: string; expiresAt: number }>();

function pbkdf2CacheKey(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

const revokedTokens = new Map<string, number>();

export interface RevocationStore {
  add(jti: string, expiresAtMs: number): Promise<void>;
  has(jti: string): Promise<boolean>;
}

let externalStore: RevocationStore | null = null;

export function setRevocationStore(store: RevocationStore): void {
  externalStore = store;
  log.info('External revocation store configured');
}

export function getRevocationStore(): RevocationStore | null {
  return externalStore;
}

const REVOKE_CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
const revokeCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [jti, expiresAt] of revokedTokens) {
    if (expiresAt <= now) revokedTokens.delete(jti);
  }
}, REVOKE_CLEANUP_INTERVAL_MS);
revokeCleanupTimer.unref();

const MAX_REVOKED_TOKENS = 10000;

function getJwtSecret(): string {
  const secret = config.jwt.secret;
  if (secret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters');
  }
  return secret;
}

export async function computeApiKeyId(apiKey: string): Promise<string> {
  if (!apiKey) return '';

  const cacheKey = pbkdf2CacheKey(apiKey);
  const cached = pbkdf2Cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const hash = await new Promise<Buffer>((resolve, reject) => {
    crypto.pbkdf2(apiKey, getJwtSecret(), 100000, 32, 'sha256', (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
  const result = hash.toString('hex');

  if (pbkdf2Cache.size >= PBKDF2_CACHE_MAX) {
    const now = Date.now();
    for (const [k, entry] of pbkdf2Cache) {
      if (entry.expiresAt <= now) pbkdf2Cache.delete(k);
    }
    if (pbkdf2Cache.size >= PBKDF2_CACHE_MAX) {
      let oldestKey: string | null = null;
      let oldestExpiry = Infinity;
      for (const [k, entry] of pbkdf2Cache) {
        if (entry.expiresAt < oldestExpiry) {
          oldestExpiry = entry.expiresAt;
          oldestKey = k;
        }
      }
      if (oldestKey) pbkdf2Cache.delete(oldestKey);
    }
  }
  pbkdf2Cache.set(cacheKey, { value: result, expiresAt: Date.now() + PBKDF2_CACHE_TTL_MS });

  return result;
}

/**
 * Issue a signed JWT.
 *
 * - `rememberMe=false` (default) → 24h session token
 * - `rememberMe=true`             → 30d token
 *
 * Tokens always include an `exp` claim. There is no never-expiring path.
 */
export async function generateToken(
  apiKey: string,
  rememberMe: boolean = false
): Promise<{ token: string; expiresIn: string }> {
  const apiKeyId = await computeApiKeyId(apiKey);
  const jti = crypto.randomUUID();
  const expiresIn = rememberMe ? JWT_EXPIRY_REMEMBER_ME : JWT_EXPIRY_SESSION;
  const token = jwt.sign({ apiKeyId, jti }, getJwtSecret(), { expiresIn });
  return { token, expiresIn };
}

export async function verifyToken(token: string): Promise<jwt.JwtPayload | null> {
  try {
    const decoded = jwt.verify(token, getJwtSecret());
    if (typeof decoded !== 'object' || decoded === null) return null;
    if (typeof decoded.jti !== 'string') return null;
    // Reject tokens without an explicit expiry — policy requires bounded lifetime.
    if (typeof decoded.exp !== 'number') {
      log.debug('Rejected token without exp claim', { jti: decoded.jti });
      return null;
    }

    if (revokedTokens.has(decoded.jti)) {
      log.debug('Rejected revoked token (local)', { jti: decoded.jti });
      return null;
    }
    if (externalStore) {
      try {
        if (await externalStore.has(decoded.jti)) {
          revokedTokens.set(decoded.jti, decoded.exp * 1000);
          log.debug('Rejected revoked token (external store)', { jti: decoded.jti });
          return null;
        }
      } catch (err) {
        log.warn('External revocation check failed, rejecting token', {
          error: (err as Error).message,
        });
        return null;
      }
    }
    return decoded;
  } catch (error) {
    log.debug('Token verification failed', { error: (error as Error).message });
    return null;
  }
}

export function revokeToken(token: string): boolean {
  try {
    const decoded = jwt.decode(token);
    if (
      !decoded ||
      typeof decoded === 'string' ||
      typeof decoded.jti !== 'string' ||
      typeof decoded.exp !== 'number'
    ) {
      return false;
    }
    if (revokedTokens.size >= MAX_REVOKED_TOKENS) {
      const now = Date.now();
      for (const [jti, expiresAt] of revokedTokens) {
        if (expiresAt <= now) revokedTokens.delete(jti);
      }
      if (revokedTokens.size >= MAX_REVOKED_TOKENS) {
        const oldest = revokedTokens.keys().next().value;
        if (oldest) revokedTokens.delete(oldest);
      }
    }
    const expiresAtMs = decoded.exp * 1000;
    revokedTokens.set(decoded.jti, expiresAtMs);

    if (externalStore) {
      externalStore.add(decoded.jti as string, expiresAtMs).catch((err) => {
        log.warn('Failed to persist revocation externally', {
          jti: decoded.jti,
          error: (err as Error).message,
        });
      });
    }

    log.debug('Token revoked', { jti: decoded.jti });
    return true;
  } catch (err) {
    logSwallowedError('security:revoke-token', err);
    return false;
  }
}

export function destroySecurity(): void {
  clearInterval(revokeCleanupTimer);
  revokedTokens.clear();
  pbkdf2Cache.clear();
  externalStore = null;
}

export function getSecurityMetrics(): { pbkdf2CacheSize: number; revokedTokensSize: number } {
  return {
    pbkdf2CacheSize: pbkdf2Cache.size,
    revokedTokensSize: revokedTokens.size,
  };
}
