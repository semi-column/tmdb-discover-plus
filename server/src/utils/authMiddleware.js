import { createLogger } from './logger.ts';
import { getUserConfig, getApiKeyFromConfig } from '../services/configService.js';
import { verifyToken, computeApiKeyId } from './security.ts';
import { sendError, ErrorCodes } from './AppError.ts';

export { computeApiKeyId, generateToken, verifyToken } from './security.ts';

const log = createLogger('auth');

export async function requireAuth(req, res, next) {
  const bearerToken = req.headers.authorization?.replace('Bearer ', '');

  if (!bearerToken) {
    return sendError(res, 401, ErrorCodes.UNAUTHORIZED, 'Authentication required');
  }

  const decoded = verifyToken(bearerToken);
  if (!decoded || !decoded.apiKeyId) {
    return sendError(res, 401, ErrorCodes.UNAUTHORIZED, 'Invalid or expired token');
  }

  req.apiKeyId = decoded.apiKeyId;
  next();
}

export async function requireConfigOwnership(req, res, next) {
  const { userId } = req.params;

  if (!userId) {
    return sendError(res, 400, ErrorCodes.VALIDATION_ERROR, 'User ID required in path');
  }

  try {
    const config = await getUserConfig(userId);
    if (!config) {
      return sendError(res, 404, ErrorCodes.CONFIG_NOT_FOUND, 'Configuration not found');
    }

    const configApiKey = getApiKeyFromConfig(config);
    if (!configApiKey) {
      log.error('Config has no API key', { userId });
      return sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Configuration error');
    }

    const expectedApiKeyId = await computeApiKeyId(configApiKey);

    if (req.apiKeyId !== expectedApiKeyId) {
      log.warn('Ownership check failed', { userId });
      return sendError(
        res,
        403,
        ErrorCodes.FORBIDDEN,
        'Access denied: This configuration belongs to a different API key'
      );
    }

    req.config = config;
    req.apiKey = configApiKey;
    next();
  } catch (error) {
    log.error('Ownership check error', { userId, error: error.message });
    return sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Authorization failed');
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
