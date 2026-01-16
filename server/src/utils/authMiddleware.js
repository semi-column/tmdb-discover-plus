import jwt from 'jsonwebtoken';
import { createLogger } from './logger.js';
import { getUserConfig, getApiKeyFromConfig } from '../services/configService.js';
import { decrypt, isEncrypted } from './encryption.js';

const log = createLogger('auth');

const JWT_EXPIRY = '7d';

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is required');
  }
  return secret;
}

/**
 * Generates a JWT token for a user session
 * @param {string} userId - The user's unique identifier
 * @param {string} [configId] - Optional specific config ID if user has multiple
 * @returns {object} - Token and expiry information
 */
export function generateToken(userId, configId = null) {
  const payload = { userId };
  if (configId) payload.configId = configId;

  const token = jwt.sign(payload, getJwtSecret(), { expiresIn: JWT_EXPIRY });

  return {
    token,
    expiresIn: JWT_EXPIRY,
  };
}

/**
 * Verifies a JWT token and returns the decoded payload
 * @param {string} token - The JWT token to verify
 * @returns {object|null} - Decoded payload or null if invalid
 */
export function verifyToken(token) {
  try {
    return jwt.verify(token, getJwtSecret());
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      log.debug('Token expired');
    } else {
      log.debug('Token verification failed', { error: error.message });
    }
    return null;
  }
}

// In-memory cache for API keys (5 minute TTL)
const apiKeyCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

/**
 * Gets API key with caching to reduce DB lookups
 * @param {string} userId - The user ID
 * @returns {Promise<string|null>} - The API key or null
 */
export async function getCachedApiKey(userId) {
  const cached = apiKeyCache.get(userId);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.apiKey;
  }

  const config = await getUserConfig(userId);
  const apiKey = getApiKeyFromConfig(config);

  if (apiKey) {
    apiKeyCache.set(userId, {
      apiKey,
      expiresAt: Date.now() + CACHE_TTL,
    });
  }

  return apiKey;
}

/**
 * Clears cached API key for a user (call after key update)
 * @param {string} userId - The user ID
 */
export function clearApiKeyCache(userId) {
  apiKeyCache.delete(userId);
}

/**
 * Express middleware that requires authentication
 * Supports both JWT tokens and legacy API key authentication
 */
export async function requireAuth(req, res, next) {
  const bearerToken = req.headers.authorization?.replace('Bearer ', '');
  const legacyApiKey = req.query.apiKey || req.body?.apiKey;

  // New path: JWT authentication
  if (bearerToken) {
    const decoded = verifyToken(bearerToken);
    if (!decoded) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    try {
      const apiKey = await getCachedApiKey(decoded.userId);
      if (!apiKey) {
        return res.status(401).json({ error: 'Configuration not found' });
      }

      req.userId = decoded.userId;
      req.apiKey = apiKey;
      return next();
    } catch (error) {
      log.error('Auth middleware error', { error: error.message });
      return res.status(500).json({ error: 'Authentication failed' });
    }
  }

  // Legacy path: API key in query/body (backward compatibility)
  if (legacyApiKey) {
    log.debug('Legacy API key auth used', { path: req.path });
    req.apiKey = legacyApiKey;
    return next();
  }

  return res.status(401).json({ error: 'Authentication required' });
}

/**
 * Optional authentication middleware - sets user info if token present, continues if not
 */
export async function optionalAuth(req, res, next) {
  const bearerToken = req.headers.authorization?.replace('Bearer ', '');
  const legacyApiKey = req.query.apiKey || req.body?.apiKey;

  if (bearerToken) {
    const decoded = verifyToken(bearerToken);
    if (decoded) {
      try {
        req.userId = decoded.userId;
        req.apiKey = await getCachedApiKey(decoded.userId);
      } catch (error) {
        log.debug('Optional auth failed', { error: error.message });
      }
    }
  } else if (legacyApiKey) {
    req.apiKey = legacyApiKey;
  }

  next();
}
