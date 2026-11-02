import { createLogger } from './logger.ts';
import {
  getUserConfig,
  getApiKeyFromConfig,
  getConfigsByApiKey,
} from '../services/configService.ts';
import { verifyToken, computeApiKeyId } from './security.ts';
import { sendError, formatErrorResponse, ErrorCodes } from './AppError.ts';
import { validateApiKeyCached } from '../services/tmdb/index.ts';
import type { Request, Response, NextFunction } from 'express';

const log = createLogger('auth');

async function resolveValidApiKey(apiKeyId: string, res: Response): Promise<string | null> {
  try {
    const configs = await getConfigsByApiKey(null, apiKeyId);
    const apiKey = getApiKeyFromConfig(configs[0] || null);
    if (!apiKey) {
      res.set('Cache-Control', 'no-store');
      sendError(res, 401, ErrorCodes.UNAUTHORIZED, 'No configuration found');
      return null;
    }

    const validation = await validateApiKeyCached(apiKey);
    if (!validation.valid) {
      res.set('Cache-Control', 'no-store');
      if (validation.invalidApiKey) {
        res.status(401).json({
          ...formatErrorResponse(ErrorCodes.INVALID_API_KEY, 'Invalid TMDB API key'),
          recoveryConfigs: configs.map((config) => ({
            userId: config.userId,
            configName: config.configName || '',
            catalogs: config.catalogs || [],
            preferences: config.preferences || {},
            createdAt: config.createdAt,
            updatedAt: config.updatedAt,
          })),
        });
        return null;
      }
      sendError(res, 503, ErrorCodes.TMDB_UNAVAILABLE, 'Could not verify TMDB API key');
      return null;
    }

    return apiKey;
  } catch (error) {
    log.error('API key validation failed', { error: (error as Error).message });
    res.set('Cache-Control', 'no-store');
    sendError(res, 503, ErrorCodes.TMDB_UNAVAILABLE, 'Could not verify TMDB API key');
    return null;
  }
}

function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) return null;
  const token = authHeader.slice(7).trim();
  return token.length > 0 ? token : null;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const bearerToken = extractBearerToken(req.headers.authorization);

  if (!bearerToken) {
    return sendError(res, 401, ErrorCodes.UNAUTHORIZED, 'Authentication required');
  }

  const decoded = (await verifyToken(bearerToken)) as { apiKeyId?: string } | null;
  if (!decoded || !decoded.apiKeyId) {
    return sendError(res, 401, ErrorCodes.UNAUTHORIZED, 'Invalid or expired token');
  }

  const apiKey = await resolveValidApiKey(decoded.apiKeyId, res);
  if (!apiKey) return;
  req.apiKeyId = decoded.apiKeyId;
  req.apiKey = apiKey;
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
  const bearerToken = extractBearerToken(req.headers.authorization);

  if (bearerToken) {
    const decoded = (await verifyToken(bearerToken)) as { apiKeyId?: string } | null;
    if (decoded?.apiKeyId) {
      const apiKey = await resolveValidApiKey(decoded.apiKeyId, res);
      if (!apiKey) return;
      req.apiKeyId = decoded.apiKeyId;
      req.apiKey = apiKey;
    }
  }

  next();
}
