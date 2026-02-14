import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { createLogger } from './logger.ts';
import { config } from '../config.ts';

import type { Logger } from '../types/index.ts';

const log = createLogger('security') as Logger;

const JWT_EXPIRY_PERSISTENT = '7d';
const JWT_EXPIRY_SESSION = '24h';

const PBKDF2_CACHE_MAX = 1000;
const PBKDF2_CACHE_TTL_MS = 60 * 60 * 1000;
const pbkdf2Cache = new Map<string, { value: string; expiresAt: number }>();

function pbkdf2CacheKey(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

const revokedTokens = new Map<string, number>();

const REVOKE_CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [jti, expiresAt] of revokedTokens) {
    if (expiresAt <= now) revokedTokens.delete(jti);
  }
}, REVOKE_CLEANUP_INTERVAL_MS);

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
    const firstKey = pbkdf2Cache.keys().next().value;
    if (firstKey) pbkdf2Cache.delete(firstKey);
  }
  pbkdf2Cache.set(cacheKey, { value: result, expiresAt: Date.now() + PBKDF2_CACHE_TTL_MS });

  return result;
}

export async function generateToken(
  apiKey: string,
  rememberMe: boolean = true
): Promise<{ token: string; expiresIn: string }> {
  const apiKeyId = await computeApiKeyId(apiKey);
  const expiresIn = rememberMe ? JWT_EXPIRY_PERSISTENT : JWT_EXPIRY_SESSION;
  const jti = crypto.randomUUID();
  const token = jwt.sign({ apiKeyId, jti }, getJwtSecret(), { expiresIn });
  return { token, expiresIn };
}

export function verifyToken(token: string): jwt.JwtPayload | string | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret());
    if (typeof decoded === 'object' && decoded.jti && revokedTokens.has(decoded.jti)) {
      log.debug('Rejected revoked token', { jti: decoded.jti });
      return null;
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
    if (!decoded || typeof decoded === 'string' || !decoded.jti || !decoded.exp) return false;
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
    revokedTokens.set(decoded.jti as string, decoded.exp * 1000);
    log.debug('Token revoked', { jti: decoded.jti });
    return true;
  } catch {
    return false;
  }
}
