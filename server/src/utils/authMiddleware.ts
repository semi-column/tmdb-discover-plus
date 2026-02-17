import { createLogger } from './logger.ts';
import { getUserConfig, getApiKeyFromConfig } from '../services/configService.ts';
import { verifyToken, computeApiKeyId } from './security.ts';
import { sendError, ErrorCodes } from './AppError.ts';
import type { Request, Response, NextFunction } from 'express';

const log = createLogger('auth');

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  let bearerToken = null;

  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token.length > 0) {
      bearerToken = token;
    }
  }

  if (!bearerToken) {
    return sendError(res, 401, ErrorCodes.UNAUTHORIZED, 'Authentication required');
  }

  const decoded = (await verifyToken(bearerToken)) as { apiKeyId?: string } | null;
  if (!decoded || !decoded.apiKeyId) {
    return sendError(res, 401, ErrorCodes.UNAUTHORIZED, 'Invalid or expired token');
  }

  req.apiKeyId = decoded.apiKeyId;
  next();
}

export async function requireConfigOwnership(req: Request, res: Response, next: NextFunction) {
  const userId = req.params.userId as string | undefined;

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
    log.error('Ownership check error', { userId, error: (error as Error).message });
    return sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Authorization failed');
  }
}

export async function optionalAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  let bearerToken = null;

  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token.length > 0) {
      bearerToken = token;
    }
  }

  if (bearerToken) {
    const decoded = (await verifyToken(bearerToken)) as { apiKeyId?: string } | null;
    if (decoded?.apiKeyId) {
      req.apiKeyId = decoded.apiKeyId;
    }
  }

  next();
}
