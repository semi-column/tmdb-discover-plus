import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { createLogger } from './logger.ts';
import { config } from '../config.ts';

import type { Logger } from '../types/index.ts';

const log = createLogger('security') as Logger;

const JWT_EXPIRY_PERSISTENT = '7d';
const JWT_EXPIRY_SESSION = '24h';

const revokedTokens = new Map<string, number>();

const REVOKE_CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [jti, expiresAt] of revokedTokens) {
    if (expiresAt <= now) revokedTokens.delete(jti);
  }
}, REVOKE_CLEANUP_INTERVAL_MS);

function getJwtSecret(): string {
  return config.jwt.secret;
}

export function computeApiKeyId(apiKey: string): string {
  if (!apiKey) return '';
  const salt = getJwtSecret();
  const hash = crypto.pbkdf2Sync(apiKey, salt, 100000, 32, 'sha256');
  return hash.toString('hex');
}

export function generateToken(
  apiKey: string,
  rememberMe: boolean = true,
): { token: string; expiresIn: string } {
  const apiKeyId = computeApiKeyId(apiKey);
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
    revokedTokens.set(decoded.jti as string, decoded.exp * 1000);
    log.debug('Token revoked', { jti: decoded.jti });
    return true;
  } catch {
    return false;
  }
}
