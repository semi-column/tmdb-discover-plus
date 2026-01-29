import { Router } from 'express';
import { nanoid } from 'nanoid';
import { generateToken, verifyToken, computeApiKeyId } from '../utils/authMiddleware.js';
import { encrypt } from '../utils/encryption.js';
import {
  getUserConfig,
  saveUserConfig,
  getConfigsByApiKey,
  getApiKeyFromConfig,
} from '../services/configService.js';
import * as tmdb from '../services/tmdb.js';
import { createLogger } from '../utils/logger.js';
import { strictRateLimit } from '../utils/rateLimit.js';
import { isValidApiKeyFormat, isValidUserId } from '../utils/validation.js';

const router = Router();
const log = createLogger('auth');

router.post('/login', strictRateLimit, async (req, res) => {
  try {
    const { apiKey, userId: requestedUserId, rememberMe = true } = req.body;

    if (!apiKey) {
      return res.status(400).json({ error: 'API key is required' });
    }

    if (!isValidApiKeyFormat(apiKey)) {
      return res.status(400).json({ error: 'Invalid API key format' });
    }

    const validation = await tmdb.validateApiKey(apiKey);
    if (!validation.valid) {
      return res.status(401).json({ error: 'Invalid TMDB API key' });
    }

    if (requestedUserId) {
      if (!isValidUserId(requestedUserId)) {
        return res.status(400).json({ error: 'Invalid user ID format' });
      }

      const existingConfig = await getUserConfig(requestedUserId);
      if (existingConfig) {
        const storedKey = getApiKeyFromConfig(existingConfig);
        if (storedKey !== apiKey) {
          return res.status(403).json({
            error: 'API key does not match this configuration',
          });
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

        const tokenData = generateToken(apiKey, rememberMe);
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
      const tokenData = generateToken(apiKey, rememberMe);
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

    const tokenData = generateToken(apiKey, rememberMe);
    log.info('New user created', { userId: newUserId });

    return res.json({
      ...tokenData,
      userId: newUserId,
      configName: '',
      isNewUser: true,
    });
  } catch (error) {
    log.error('Login error', { error: error.message });
    return res.status(500).json({ error: 'Authentication failed' });
  }
});

router.post('/logout', (req, res) => {
  return res.json({ success: true });
});

router.get('/verify', strictRateLimit, async (req, res) => {
  const bearerToken = req.headers.authorization?.replace('Bearer ', '');

  if (!bearerToken) {
    return res.status(401).json({ valid: false, error: 'No token provided' });
  }

  const decoded = verifyToken(bearerToken);
  if (!decoded || !decoded.apiKeyId) {
    return res.status(401).json({ valid: false, error: 'Invalid or expired token' });
  }

  try {
    const allConfigs = await getConfigsByApiKey(null, decoded.apiKeyId);

    if (!allConfigs || allConfigs.length === 0) {
      return res.status(401).json({ valid: false, error: 'No configurations found' });
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
    return res.status(401).json({ valid: false, error: 'Verification failed' });
  }
});

export { router as authRouter };
