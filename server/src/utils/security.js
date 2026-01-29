import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { createLogger } from './logger.js';

const log = createLogger('security');

const JWT_EXPIRY_PERSISTENT = '7d';
const JWT_EXPIRY_SESSION = '24h';

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is required');
  }
  return secret;
}

// Non-reversible hash for indexing configs without storing raw API keys
export function computeApiKeyId(apiKey) {
  return crypto.createHmac('sha256', getJwtSecret()).update(apiKey).digest('hex');
}

export function generateToken(apiKey, rememberMe = true) {
  const apiKeyId = computeApiKeyId(apiKey);
  const expiresIn = rememberMe ? JWT_EXPIRY_PERSISTENT : JWT_EXPIRY_SESSION;
  const token = jwt.sign({ apiKeyId }, getJwtSecret(), { expiresIn });
  return { token, expiresIn };
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, getJwtSecret());
  } catch (error) {
    log.debug('Token verification failed', { error: error.message });
    return null;
  }
}
