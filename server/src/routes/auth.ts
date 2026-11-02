import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { generateToken, verifyToken } from '../utils/security.ts';
import { revokeToken } from '../utils/security.ts';
import { encrypt } from '../utils/encryption.ts';
import {
  getUserConfig,
  saveUserConfig,
  getConfigsByApiKey,
  getApiKeyFromConfig,
} from '../services/configService.ts';
import * as tmdb from '../services/tmdb/index.ts';
import { createLogger } from '../utils/logger.ts';
import { strictRateLimit } from '../utils/rateLimit.ts';
import { isValidApiKeyFormat, isValidUserId } from '../utils/validation.ts';
import { sendError, formatErrorResponse, ErrorCodes } from '../utils/AppError.ts';
import type { UserConfig } from '../types/index.ts';

const router = Router();
const log = createLogger('auth');

function toClientConfig(config: UserConfig) {
  return {
    userId: config.userId,
    configName: config.configName || '',
    catalogs: config.catalogs || [],
    preferences: config.preferences || {},
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  };
}

router.post('/login', strictRateLimit, async (req, res) => {
  try {
    const { apiKey, userId: requestedUserId, rememberMe = false } = req.body;

    if (!apiKey) {
      return sendError(res, 400, ErrorCodes.VALIDATION_ERROR, 'API key is required');
    }

    if (!isValidApiKeyFormat(apiKey)) {
      return sendError(res, 400, ErrorCodes.VALIDATION_ERROR, 'Invalid API key format');
    }

    const validation = await tmdb.validateApiKey(apiKey);
    if (!validation.valid) {
      if (validation.invalidApiKey) {
        const recoveryConfigs = (await getConfigsByApiKey(apiKey)).map(toClientConfig);
        res.set('Cache-Control', 'no-store');
        return res.status(401).json({
          ...formatErrorResponse(ErrorCodes.INVALID_API_KEY, 'Invalid TMDB API key'),
          ...(recoveryConfigs.length > 0 ? { recoveryConfigs } : {}),
        });
      }

      return sendError(res, 503, ErrorCodes.TMDB_UNAVAILABLE, 'Could not verify TMDB API key');
    }

    if (requestedUserId) {
      if (!isValidUserId(requestedUserId)) {
        return sendError(res, 400, ErrorCodes.VALIDATION_ERROR, 'Invalid user ID format');
      }

      const existingConfig = await getUserConfig(requestedUserId);
      if (existingConfig) {
        const storedKey = getApiKeyFromConfig(existingConfig);
        if (storedKey !== apiKey) {
          return sendError(
            res,
            403,
            ErrorCodes.FORBIDDEN,
            'API key does not match this configuration'
          );
        }

        const allConfigsRaw = await getConfigsByApiKey(apiKey);
        const allConfigs = allConfigsRaw.map(toClientConfig);

        const tokenData = await generateToken(apiKey, rememberMe);
        log.info('User authenticated for existing config', { userId: requestedUserId });

        return res.json({
          ...tokenData,
          userId: requestedUserId,
          configName: existingConfig.configName || '',
          isNewUser: false,
          configs: allConfigs,
        });
      }
    }

    const existingConfigs = await getConfigsByApiKey(apiKey);

    if (existingConfigs.length > 0) {
      existingConfigs.sort(
        (a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime()
      );
      const config = existingConfigs[0];
      const tokenData = await generateToken(apiKey, rememberMe);
      log.info('User authenticated', {
        userId: config.userId,
        totalConfigs: existingConfigs.length,
      });

      const allConfigs = existingConfigs.map(toClientConfig);

      return res.json({
        ...tokenData,
        userId: config.userId,
        configName: config.configName || '',
        isNewUser: false,
        configs: allConfigs,
      });
    }

    const newUserId = randomBytes(8).toString('base64url').slice(0, 10);
    const encryptedKey = encrypt(apiKey) ?? undefined;

    await saveUserConfig({
      userId: newUserId,
      tmdbApiKeyEncrypted: encryptedKey,
      catalogs: [],
      preferences: {},
    });

    const tokenData = await generateToken(apiKey, rememberMe);
    log.info('New user created', { userId: newUserId });

    return res.json({
      ...tokenData,
      userId: newUserId,
      configName: '',
      isNewUser: true,
      configs: [],
    });
  } catch (error) {
    log.error('Login error', { error: (error as Error).message });
    return sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Authentication failed');
  }
});

router.post('/logout', (req, res) => {
  const bearerToken = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (bearerToken) {
    revokeToken(bearerToken);
  }
  return res.json({ success: true });
});

router.get('/verify', strictRateLimit, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const bearerToken = req.headers.authorization?.replace(/^Bearer\s+/i, '');

  if (!bearerToken) {
    return sendError(res, 401, ErrorCodes.UNAUTHORIZED, 'No token provided');
  }

  const decoded = (await verifyToken(bearerToken)) as { apiKeyId?: string } | null;
  if (!decoded || !decoded.apiKeyId) {
    return sendError(res, 401, ErrorCodes.UNAUTHORIZED, 'Invalid or expired token');
  }

  try {
    const allConfigs = await getConfigsByApiKey(null, decoded.apiKeyId);

    if (!allConfigs || allConfigs.length === 0) {
      return sendError(res, 401, ErrorCodes.UNAUTHORIZED, 'No configurations found');
    }

    allConfigs.sort(
      (a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime()
    );
    const config = allConfigs[0];
    const apiKey = getApiKeyFromConfig(config);
    if (!apiKey) {
      return sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Configuration error');
    }

    const validation = await tmdb.validateApiKeyCached(apiKey);
    if (!validation.valid) {
      if (validation.invalidApiKey) {
        res.set('Cache-Control', 'no-store');
        return res.status(401).json({
          ...formatErrorResponse(ErrorCodes.INVALID_API_KEY, 'Invalid TMDB API key'),
          recoveryConfigs: allConfigs.map(toClientConfig),
        });
      }
      return sendError(res, 503, ErrorCodes.TMDB_UNAVAILABLE, 'Could not verify TMDB API key');
    }

    return res.json({
      valid: true,
      userId: config.userId,
      configName: config.configName || '',
    });
  } catch (error) {
    log.error('Verify error', { error: (error as Error).message });
    return sendError(res, 401, ErrorCodes.UNAUTHORIZED, 'Verification failed');
  }
});

export { router as authRouter };
