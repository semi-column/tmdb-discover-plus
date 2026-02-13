import { createLogger } from './logger.ts';
import { getUserConfig, getApiKeyFromConfig } from '../services/configService.js';
import { verifyToken, computeApiKeyId } from './security.ts';

export { computeApiKeyId, generateToken, verifyToken } from './security.ts';

const log = createLogger('auth');

export async function requireAuth(req, res, next) {
  const bearerToken = req.headers.authorization?.replace('Bearer ', '');

  if (!bearerToken) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const decoded = verifyToken(bearerToken);
  if (!decoded || !decoded.apiKeyId) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  req.apiKeyId = decoded.apiKeyId;
  next();
}

export async function requireConfigOwnership(req, res, next) {
  const { userId } = req.params;

  if (!userId) {
    return res.status(400).json({ error: 'User ID required in path' });
  }

  try {
    const config = await getUserConfig(userId);
    if (!config) {
      return res.status(404).json({ error: 'Configuration not found' });
    }

    const configApiKey = getApiKeyFromConfig(config);
    if (!configApiKey) {
      log.error('Config has no API key', { userId });
      return res.status(500).json({ error: 'Configuration error' });
    }

    const expectedApiKeyId = computeApiKeyId(configApiKey);

    if (req.apiKeyId !== expectedApiKeyId) {
      log.warn('Ownership check failed', { userId });
      return res.status(403).json({
        error: 'Access denied: This configuration belongs to a different API key',
        code: 'API_KEY_MISMATCH',
      });
    }

    req.config = config;
    req.apiKey = configApiKey;
    next();
  } catch (error) {
    log.error('Ownership check error', { userId, error: error.message });
    return res.status(500).json({ error: 'Authorization failed' });
  }
}

export async function optionalAuth(req, res, next) {
  const bearerToken = req.headers.authorization?.replace('Bearer ', '');

  if (bearerToken) {
    const decoded = verifyToken(bearerToken);
    if (decoded?.apiKeyId) {
      req.apiKeyId = decoded.apiKeyId;
    }
  }

  next();
}
