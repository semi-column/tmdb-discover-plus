import crypto from 'crypto';
import { UserConfig } from '../models/UserConfig.js';
import { isConnected } from './database.js';
import * as tmdb from './tmdb.js';
import { createLogger } from '../utils/logger.js';
import { sanitizeString, isValidUserId, isValidApiKeyFormat } from '../utils/validation.js';
import { encrypt, decrypt, isEncrypted } from '../utils/encryption.js';

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

  // Legacy format: check if it looks encrypted first
  if (config.tmdbApiKey) {
    if (isEncrypted(config.tmdbApiKey)) {
      return decrypt(config.tmdbApiKey);
    }
    return config.tmdbApiKey;
  }

  return null;
}

/**
 * Get user config (from DB or memory)
 */
export async function getUserConfig(userId, overrideApiKey = null) {
  log.info('Getting user config', { userId, dbConnected: isConnected() });

  if (isConnected()) {
    try {
      log.info('Querying MongoDB for userId', { userId, userIdType: typeof userId });
      const config = await UserConfig.findOne({ userId }).lean();
      log.info('MongoDB query result', {
        found: !!config,
        userId: config?.userId,
        catalogCount: config?.catalogs?.length || 0,
      });
      // Resolve stored IDs into display placeholders for UI
      try {
        // Allow caller to provide an apiKey (e.g. the user entered it on the Configure page)
        const apiKey = overrideApiKey || getApiKeyFromConfig(config);
        if (apiKey && config.catalogs && config.catalogs.length > 0) {
          // Resolve in parallel with limited concurrency
          const resolveCatalogPromises = config.catalogs.map(async (catalog) => {
            const filters = catalog.filters || {};

            // Helper to parse CSV or array into string array
            const parseIds = (val) => {
              if (!val) return [];
              if (Array.isArray(val)) return val.map(String).filter(Boolean);
              return String(val)
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
            };

            const withPeopleIds = parseIds(filters.withPeople);
            const withCompaniesIds = parseIds(filters.withCompanies);
            const withKeywordsIds = parseIds(filters.withKeywords);

            // Resolve people
            const peopleResolved = await Promise.all(
              withPeopleIds.map((id) => tmdb.getPersonById(apiKey, id))
            );
            const peoplePlaceholders = peopleResolved
              .filter(Boolean)
              .map((p) => ({ value: String(p.id), label: p.name }));

            // Resolve companies
            const companiesResolved = await Promise.all(
              withCompaniesIds.map((id) => tmdb.getCompanyById(apiKey, id))
            );
            const companyPlaceholders = companiesResolved
              .filter(Boolean)
              .map((cmp) => ({ value: String(cmp.id), label: cmp.name }));

            // Resolve keywords
            const keywordsResolved = await Promise.all(
              withKeywordsIds.map((id) => tmdb.getKeywordById(apiKey, id))
            );
            const keywordPlaceholders = keywordsResolved
              .filter(Boolean)
              .map((k) => ({ value: String(k.id), label: k.name }));

            return {
              ...catalog,
              filters: {
                ...filters,
                // Attach resolved arrays (client will use these for placeholders)
                withPeopleResolved: peoplePlaceholders,
                withCompaniesResolved: companyPlaceholders,
                withKeywordsResolved: keywordPlaceholders,
              },
            };
          });

          const resolvedCatalogs = await Promise.all(resolveCatalogPromises);
          return { ...config, catalogs: resolvedCatalogs };
        }
      } catch (resolveErr) {
        log.error('Resolution error', { error: resolveErr.message });
      }

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
  let rawApiKey = config.tmdbApiKey || null;

  // Validate raw key format if provided
  if (rawApiKey) {
    rawApiKey = sanitizeString(rawApiKey, 64);
    if (!isValidApiKeyFormat(rawApiKey)) {
      throw new Error('Invalid TMDB API key format');
    }
    // Encrypt the raw key if encryption is available
    try {
      encryptedApiKey = encrypt(rawApiKey);
    } catch (encryptError) {
      log.warn('Encryption not available, storing raw key', { error: encryptError.message });
    }
  }

  // Ensure catalogs have proper _id fields (applies to both DB and memory paths)
  const processedCatalogs = (config.catalogs || []).map((c) => ({
    ...c,
    _id: c._id || c.id || crypto.randomUUID(),
  }));

  if (isConnected()) {
    try {
      // Build update object - use encrypted key if available, remove legacy field
      const updateData = {
        configName: config.configName || '',
        catalogs: processedCatalogs,
        preferences: config.preferences || {},
        updatedAt: new Date(),
      };

      // Set encrypted key and optionally keep legacy for backward compat
      if (encryptedApiKey) {
        updateData.tmdbApiKeyEncrypted = encryptedApiKey;
      }
      // Keep legacy key during transition (will be removed in future)
      if (rawApiKey && !encryptedApiKey) {
        updateData.tmdbApiKey = rawApiKey;
      }

      // Use findOneAndUpdate to properly handle nested array updates
      const result = await UserConfig.findOneAndUpdate(
        { userId: safeUserId },
        {
          $set: updateData,
          ...(encryptedApiKey ? { $unset: { tmdbApiKey: 1 } } : {}),
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

  const memConfig = {
    ...config,
    userId: safeUserId,
    tmdbApiKey: rawApiKey,
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
 * Get all user configs by TMDB API key
 * Returns an array of configs that share the same API key
 */
export async function getConfigsByApiKey(apiKey) {
  if (!apiKey) return [];

  log.info('Getting configs by apiKey', { dbConnected: isConnected() });

  if (isConnected()) {
    try {
      // Search both legacy and potentially match decrypted keys
      // First try legacy field for backward compat
      let configs = await UserConfig.find({ tmdbApiKey: apiKey }).lean();

      // If not found with legacy, search all and check encrypted
      if (configs.length === 0) {
        const allConfigs = await UserConfig.find({
          $or: [{ tmdbApiKey: { $exists: true } }, { tmdbApiKeyEncrypted: { $exists: true } }],
        }).lean();

        configs = allConfigs.filter((config) => {
          const storedKey = getApiKeyFromConfig(config);
          return storedKey === apiKey;
        });
      }

      log.debug('Found configs in MongoDB', { count: configs.length });
      return configs;
    } catch (err) {
      log.error('MongoDB error in getConfigsByApiKey', { error: err.message });
      throw err;
    }
  }

  // Memory store fallback: filter by apiKey (check both fields)
  const results = [];
  for (const [, config] of memoryStore.entries()) {
    const storedKey = getApiKeyFromConfig(config);
    if (storedKey === apiKey) {
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

      // Verify API key matches (support both encrypted and legacy)
      const storedKey = getApiKeyFromConfig(config);
      if (storedKey !== apiKey) {
        log.warn('API key mismatch on delete', { userId: safeUserId });
        throw new Error('Access denied');
      }

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
