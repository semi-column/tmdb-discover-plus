import { Router } from 'express';
import { nanoid } from 'nanoid';
import { generateToken, clearApiKeyCache } from '../utils/authMiddleware.js';
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

/**
 * POST /api/auth/login
 * Authenticates a user with their TMDB API key and returns a session token
 */
router.post('/login', strictRateLimit, async (req, res) => {
  try {
    const { apiKey, userId: requestedUserId, rememberMe } = req.body;

    if (!apiKey) {
      return res.status(400).json({ error: 'API key is required' });
    }

    if (!isValidApiKeyFormat(apiKey)) {
      return res.status(400).json({ error: 'Invalid API key format' });
    }

    // Validate API key with TMDB
    const validation = await tmdb.validateApiKey(apiKey);
    if (!validation.valid) {
      return res.status(401).json({ error: 'Invalid TMDB API key' });
    }

    // If a specific userId was requested (e.g., from configure URL), verify ownership
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

        // Generate token for existing config
        const tokenData = generateToken(requestedUserId, rememberMe);
        log.info('User authenticated for existing config', { userId: requestedUserId });

        return res.json({
          ...tokenData,
          userId: requestedUserId,
          configName: existingConfig.configName || '',
          isNewUser: false,
        });
      }
    }

    // Find all configs for this API key
    const existingConfigs = await getConfigsByApiKey(apiKey);

    if (existingConfigs.length > 0) {
      // User has existing configs - auto-select the most recently updated one
      existingConfigs.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
      const config = existingConfigs[0];
      const tokenData = generateToken(config.userId, rememberMe);
      log.info('User authenticated with config', { userId: config.userId, totalConfigs: existingConfigs.length });

      // Return all configs for immediate loading in the dashboard
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

    // New user - create config with encrypted API key
    const newUserId = nanoid(10);
    const encryptedKey = encrypt(apiKey);

    await saveUserConfig({
      userId: newUserId,
      tmdbApiKey: apiKey, // Will be encrypted by configService
      tmdbApiKeyEncrypted: encryptedKey,
      catalogs: [],
      preferences: {},
    });

    const tokenData = generateToken(newUserId, rememberMe);
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

/**
 * POST /api/auth/select-config
 * Selects a specific config when user has multiple configs
 */
router.post('/select-config', strictRateLimit, async (req, res) => {
  try {
    const { apiKey, userId } = req.body;

    if (!apiKey || !userId) {
      return res.status(400).json({ error: 'API key and userId are required' });
    }

    if (!isValidApiKeyFormat(apiKey) || !isValidUserId(userId)) {
      return res.status(400).json({ error: 'Invalid format' });
    }

    const config = await getUserConfig(userId);
    if (!config) {
      return res.status(404).json({ error: 'Configuration not found' });
    }

    const storedKey = getApiKeyFromConfig(config);
    if (storedKey !== apiKey) {
      return res.status(403).json({ error: 'API key does not match' });
    }

    const tokenData = generateToken(userId);
    log.info('Config selected', { userId });

    return res.json({
      ...tokenData,
      userId,
      configName: config.configName || '',
    });
  } catch (error) {
    log.error('Select config error', { error: error.message });
    return res.status(500).json({ error: 'Failed to select configuration' });
  }
});

/**
 * POST /api/auth/logout
 * Clears the server-side cache for the user (token invalidation is client-side)
 */
router.post('/logout', async (req, res) => {
  try {
    const bearerToken = req.headers.authorization?.replace('Bearer ', '');

    if (bearerToken) {
      const jwt = await import('jsonwebtoken');
      try {
        const decoded = jwt.default.decode(bearerToken);
        if (decoded?.userId) {
          clearApiKeyCache(decoded.userId);
          log.info('User logged out', { userId: decoded.userId });
        }
      } catch {
        // Token decode failed, ignore
      }
    }

    return res.json({ success: true });
  } catch (error) {
    log.error('Logout error', { error: error.message });
    return res.status(500).json({ error: 'Logout failed' });
  }
});

/**
 * GET /api/auth/verify
 * Verifies if the current token is valid
 */
router.get('/verify', async (req, res) => {
  const bearerToken = req.headers.authorization?.replace('Bearer ', '');

  if (!bearerToken) {
    return res.status(401).json({ valid: false, error: 'No token provided' });
  }

  try {
    const jwt = await import('jsonwebtoken');
    const decoded = jwt.default.verify(bearerToken, process.env.JWT_SECRET);

    const config = await getUserConfig(decoded.userId);
    if (!config) {
      return res.status(401).json({ valid: false, error: 'Configuration not found' });
    }

    return res.json({
      valid: true,
      userId: decoded.userId,
      configName: config.configName || '',
    });
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ valid: false, error: 'Token expired' });
    }
    return res.status(401).json({ valid: false, error: 'Invalid token' });
  }
});

export { router as authRouter };
