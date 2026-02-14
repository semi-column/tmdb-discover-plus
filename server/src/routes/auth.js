import { Router } from 'express';
import { nanoid } from 'nanoid';
import { generateToken, verifyToken, computeApiKeyId } from '../utils/authMiddleware.js';
import { revokeToken } from '../utils/security.ts';
import { encrypt } from '../utils/encryption.ts';
import {
  getUserConfig,
  saveUserConfig,
  getConfigsByApiKey,
  getApiKeyFromConfig,
} from '../services/configService.js';
import * as tmdb from '../services/tmdb/index.js';
import { createLogger } from '../utils/logger.ts';
import { strictRateLimit } from '../utils/rateLimit.js';
import { isValidApiKeyFormat, isValidUserId } from '../utils/validation.ts';
import { sendError, ErrorCodes } from '../utils/AppError.ts';

const router = Router();
const log = createLogger('auth');

router.post('/login', strictRateLimit, async (req, res) => {
  try {
    const { apiKey, userId: requestedUserId, rememberMe = true } = req.body;

    if (!apiKey) {
      return sendError(res, 400, ErrorCodes.VALIDATION_ERROR, 'API key is required');
    }

    if (!isValidApiKeyFormat(apiKey)) {
      return sendError(res, 400, ErrorCodes.VALIDATION_ERROR, 'Invalid API key format');
    }

    const validation = await tmdb.validateApiKey(apiKey);
    if (!validation.valid) {
      return sendError(res, 401, ErrorCodes.INVALID_API_KEY, 'Invalid TMDB API key');
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
        const allConfigs = allConfigsRaw.map((c) => ({
          userId: c.userId,
          configName: c.configName || '',
          catalogs: c.catalogs || [],
          preferences: c.preferences || {},
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
        }));

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
      existingConfigs.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
      const config = existingConfigs[0];
      const tokenData = await generateToken(apiKey, rememberMe);
      log.info('User authenticated', {
        userId: config.userId,
        totalConfigs: existingConfigs.length,
      });

      const allConfigs = existingConfigs.map((c) => ({
        userId: c.userId,
        configName: c.configName || '',
        catalogs: c.catalogs || [],
        preferences: c.preferences || {},
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      }));

      return res.json({
        ...tokenData,
        userId: config.userId,
        configName: config.configName || '',
        isNewUser: false,
        configs: allConfigs,
      });
    }

    const newUserId = nanoid(10);
    const encryptedKey = encrypt(apiKey);

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
    });
  } catch (error) {
    log.error('Login error', { error: error.message });
    return sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Authentication failed');
  }
});

router.post('/logout', (req, res) => {
  const bearerToken = req.headers.authorization?.replace('Bearer ', '');
  if (bearerToken) {
    revokeToken(bearerToken);
  }
  return res.json({ success: true });
});

router.get('/verify', strictRateLimit, async (req, res) => {
  const bearerToken = req.headers.authorization?.replace('Bearer ', '');

  if (!bearerToken) {
    return sendError(res, 401, ErrorCodes.UNAUTHORIZED, 'No token provided');
  }

  const decoded = verifyToken(bearerToken);
  if (!decoded || !decoded.apiKeyId) {
    return sendError(res, 401, ErrorCodes.UNAUTHORIZED, 'Invalid or expired token');
  }

  try {
    const allConfigs = await getConfigsByApiKey(null, decoded.apiKeyId);

    if (!allConfigs || allConfigs.length === 0) {
      return sendError(res, 401, ErrorCodes.UNAUTHORIZED, 'No configurations found');
    }

    allConfigs.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    const config = allConfigs[0];

    return res.json({
      valid: true,
      userId: config.userId,
      configName: config.configName || '',
    });
  } catch (error) {
    log.error('Verify error', { error: error.message });
    return sendError(res, 401, ErrorCodes.UNAUTHORIZED, 'Verification failed');
  }
});

export { router as authRouter };
