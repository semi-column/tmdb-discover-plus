import crypto from 'crypto';
import { UserConfig } from '../models/UserConfig.js';
import { isConnected } from './database.js';
import * as tmdb from './tmdb.js';
import { createLogger } from '../utils/logger.js';
import { sanitizeString, isValidUserId, isValidApiKeyFormat } from '../utils/validation.js';
import { encrypt, decrypt, isEncrypted } from '../utils/encryption.js';
import { computeApiKeyId } from '../utils/security.js';

const log = createLogger('configService');

// In-memory fallback when MongoDB is not available
const memoryStore = new Map();

/**
 * Extracts the API key from a config, handling both encrypted and legacy formats
 * @param {object} config - The user config object
 * @returns {string|null} - The decrypted API key or null
 */
export function getApiKeyFromConfig(config) {
  if (!config) return null;

  // New format: encrypted key
  if (config.tmdbApiKeyEncrypted) {
    const decrypted = decrypt(config.tmdbApiKeyEncrypted);
    if (decrypted) return decrypted;
  }

  return null;
}

/**
 * Get user config (from DB or memory)
 */
export async function getUserConfig(userId, overrideApiKey = null) {
  log.debug('Getting user config', { userId, dbConnected: isConnected() });

  if (isConnected()) {
    try {
      log.debug('Querying MongoDB for userId', { userId, userIdType: typeof userId });
      const config = await UserConfig.findOne({ userId }).lean();
      log.debug('MongoDB query result', {
        found: !!config,
        userId: config?.userId,
        catalogCount: config?.catalogs?.length || 0,
      });


      return config;
    } catch (err) {
      log.error('MongoDB error', { error: err.message });
      throw err;
    }
  }

  const memConfig = memoryStore.get(userId) || null;
  log.debug('Memory store result', { found: !!memConfig });
  return memConfig;
}

/**
 * Save user config (to DB or memory)
 * Use findOneAndUpdate with $set to properly update nested arrays like catalogs
 */
export async function saveUserConfig(config) {
  log.debug('Saving user config', {
    userId: config.userId,
    catalogCount: config.catalogs?.length || 0,
  });

  // Defensive: ensure values used in Mongo queries are simple, validated strings.
  const safeUserId = sanitizeString(config?.userId, 64);
  if (!isValidUserId(safeUserId)) {
    throw new Error('Invalid user ID format');
  }

  // Handle API key - prefer encrypted if provided, otherwise encrypt raw key
  let encryptedApiKey = config.tmdbApiKeyEncrypted || null;
  let rawApiKey = null;
  
  // If raw key provided, validate and encrypt
  if (config.tmdbApiKey) {
     const safeKey = sanitizeString(config.tmdbApiKey, 64);
     if (!isValidApiKeyFormat(safeKey)) {
        throw new Error('Invalid TMDB API key format');
     }
     rawApiKey = safeKey;
     try {
        encryptedApiKey = encrypt(safeKey);
     } catch (encryptError) {
        throw new Error('Encryption failed');
     }
  }

  // Ensure catalogs have proper _id fields (applies to both DB and memory paths)
  const processedCatalogs = (config.catalogs || []).map((c) => ({
    ...c,
    _id: c._id || c.id || crypto.randomUUID(),
  }));

  if (isConnected()) {
    try {
      // Build update object
      const updateData = {
        configName: config.configName || '',
        catalogs: processedCatalogs,
        preferences: config.preferences || {},
        updatedAt: new Date(),
      };

      // Compute and store apiKeyId for fast lookups
      const apiKeyForHash = rawApiKey || (encryptedApiKey ? decrypt(encryptedApiKey) : null);
      if (apiKeyForHash) {
        updateData.apiKeyId = computeApiKeyId(apiKeyForHash);
      }

      // Set encrypted key
      if (encryptedApiKey) {
        updateData.tmdbApiKeyEncrypted = encryptedApiKey;
      }

      // Use findOneAndUpdate to properly handle nested array updates
      const result = await UserConfig.findOneAndUpdate(
        { userId: safeUserId },
        {
          $set: updateData,
        },

        {
          new: true,
          upsert: true,
          runValidators: true,
          setDefaultsOnInsert: true,
        }
      ).lean();

      log.debug('Config saved to MongoDB', {
        userId: result?.userId,
        catalogCount: result?.catalogs?.length || 0,
      });
      return result;
    } catch (dbError) {
      log.error('MongoDB save error', { error: dbError.message });
      throw dbError;
    }
  }

  // Compute apiKeyId for memory store too
  const apiKeyForHash = rawApiKey || (encryptedApiKey ? decrypt(encryptedApiKey) : null);
  let computedApiKeyId = config.apiKeyId;
  if (!computedApiKeyId && apiKeyForHash) {
    computedApiKeyId = computeApiKeyId(apiKeyForHash);
  }

  const memConfig = {
    ...config,
    userId: safeUserId,
    apiKeyId: computedApiKeyId,
    apiKeyId: computedApiKeyId,
    // tmdbApiKey removed (legacy)
    tmdbApiKeyEncrypted: encryptedApiKey,
    configName: config.configName || '',
    catalogs: processedCatalogs,
    _id: safeUserId,
  };
  memoryStore.set(safeUserId, memConfig);
  log.debug('Config saved to memory store', { userId: safeUserId });
  return memConfig;
}

/**
 * Get all user configs by TMDB API key or apiKeyId (HMAC hash).
 * Uses indexed apiKeyId field for fast O(1) lookups.
 * @param {string|null} apiKey - The raw API key (optional)
 * @param {string|null} apiKeyId - The HMAC hash of the API key (optional)
 * @returns {Promise<Array>} - Array of configs
 */
export async function getConfigsByApiKey(apiKey, apiKeyId = null) {
  log.debug('Getting configs by apiKey/apiKeyId', { hasApiKey: !!apiKey, hasApiKeyId: !!apiKeyId, dbConnected: isConnected() });

  if (!apiKey && !apiKeyId) return [];

  // Compute apiKeyId from raw key if provided
  const targetApiKeyId = apiKeyId || (apiKey ? computeApiKeyId(apiKey) : null);
  
  if (!targetApiKeyId) return [];

  if (isConnected()) {
    try {
      // Fast indexed query on apiKeyId
      const configs = await UserConfig.find({ apiKeyId: targetApiKeyId }).sort({ updatedAt: -1 }).lean();
      log.debug('Found configs by apiKeyId index', { count: configs.length });
      return configs;
    } catch (err) {
      log.error('MongoDB error in getConfigsByApiKey', { error: err.message });
      throw err;
    }
  }

  // Memory store fallback (for development without MongoDB)
  const results = [];
  for (const [, config] of memoryStore.entries()) {
    if (config.apiKeyId === targetApiKeyId) {
      results.push(config);
    }
  }
  log.debug('Found configs in memory store', { count: results.length });
  return results;
}

/**
 * Delete a user config by userId
 * Requires matching apiKey for security
 */
export async function deleteUserConfig(userId, apiKey) {
  log.info('Deleting user config', { userId, dbConnected: isConnected() });

  // Validate userId
  const safeUserId = sanitizeString(userId, 64);
  if (!isValidUserId(safeUserId)) {
    throw new Error('Invalid user ID format');
  }

  // Validate apiKey format
  if (!apiKey || !isValidApiKeyFormat(apiKey)) {
    throw new Error('Invalid API key format');
  }

  if (isConnected()) {
    try {
      // First find the config to verify ownership
      const config = await UserConfig.findOne({ userId: safeUserId }).lean();
      if (!config) {
        log.warn('Config not found', { userId: safeUserId });
        throw new Error('Configuration not found');
      }

      // API key check is handled by middleware (requireConfigOwnership)
      // proceeded by findOneAndDelete

      // Delete the config
      await UserConfig.findOneAndDelete({ userId: safeUserId });

      log.info('Config deleted from MongoDB', { userId: safeUserId });
      return { deleted: true, userId: safeUserId };
    } catch (err) {
      log.error('MongoDB delete error', { error: err.message });
      throw err;
    }
  }

  // Memory store fallback
  const existing = memoryStore.get(safeUserId);
  if (!existing) {
    throw new Error('Configuration not found');
  }
  const storedKey = getApiKeyFromConfig(existing);
  if (storedKey !== apiKey) {
    throw new Error('Access denied');
  }

  memoryStore.delete(safeUserId);
  log.info('Config deleted from memory store', { userId: safeUserId });
  return { deleted: true, userId: safeUserId };
}
