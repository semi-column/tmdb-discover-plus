import crypto from 'crypto';
import { getStorage } from './storage/index.js';
import { createLogger } from '../utils/logger.js';
import { sanitizeString, isValidUserId, isValidApiKeyFormat } from '../utils/validation.js';
import { encrypt, decrypt } from '../utils/encryption.js';
import { computeApiKeyId } from '../utils/security.js';

const log = createLogger('configService');

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
 * Extracts the poster service API key from config preferences
 * @param {object} config - The user config object
 * @returns {string|null} - The decrypted poster API key or null
 */
export function getPosterKeyFromConfig(config) {
  if (!config?.preferences?.posterApiKeyEncrypted) return null;
  return decrypt(config.preferences.posterApiKeyEncrypted);
}

/**
 * Get user config (from abstract storage)
 */
export async function getUserConfig(userId, overrideApiKey = null) {
  log.debug('Getting user config', { userId });

  const storage = getStorage();
  try {
    const config = await storage.getUserConfig(userId);
    log.debug('Storage query result', {
      found: !!config,
      userId: config?.userId,
      catalogCount: config?.catalogs?.length || 0,
    });
    return config;
  } catch (err) {
    log.error('Storage error', { error: err.message });
    throw err;
  }
}

/**
 * Save user config (to abstract storage)
 */
export async function saveUserConfig(config) {
  log.debug('Saving user config', {
    userId: config.userId,
    catalogCount: config.catalogs?.length || 0,
  });

  // Defensive: ensure values used are simple, validated strings.
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

  // Ensure catalogs have proper _id fields
  const processedCatalogs = (config.catalogs || []).map((c) => ({
    ...c,
    _id: c._id || c.id || crypto.randomUUID(),
  }));

  try {
    // Process preferences with poster API key encryption
    const processedPreferences = { ...(config.preferences || {}) };
    
    // Handle poster API key encryption
    if (config.preferences?.posterApiKey) {
      const rawPosterKey = sanitizeString(config.preferences.posterApiKey, 128);
      if (rawPosterKey) {
        try {
          processedPreferences.posterApiKeyEncrypted = encrypt(rawPosterKey);
        } catch (encryptError) {
          log.error('Failed to encrypt poster API key', { error: encryptError.message });
        }
      }
      // Remove raw key from preferences (should not be stored)
      delete processedPreferences.posterApiKey;
    }

    const updateData = {
        ...config, // Keep other fields
        userId: safeUserId,
        configName: config.configName || '',
        catalogs: processedCatalogs,
        preferences: processedPreferences,
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
    // Remove legacy raw key if present
    delete updateData.tmdbApiKey;

    const storage = getStorage();
    const result = await storage.saveUserConfig(updateData);

    log.debug('Config saved to storage', {
      userId: result?.userId,
      catalogCount: result?.catalogs?.length || 0,
    });
    return result;
  } catch (dbError) {
    log.error('Storage save error', { error: dbError.message });
    throw dbError;
  }
}

/**
 * Updates genre IDs/names for specific catalogs (used for self-healing)
 */
export async function updateCatalogGenres(userId, fixes) {
  if (!fixes || Object.keys(fixes).length === 0) return;

  log.info('Updating catalog genres (self-healing)', { userId, fixedCount: Object.keys(fixes).length });

  try {
    const storage = getStorage();
    const config = await storage.getUserConfig(userId);
    if (!config) return;

    let changed = false;
    // We must clone/modify the array as retrieved from storage
    const newCatalogs = config.catalogs.map((cat) => {
      if (fixes[cat.id]) {
        // Return new object with updated filters
        const newCat = { 
            ...cat, 
            filters: {
                ...cat.filters,
                genres: fixes[cat.id].genres,
                genreNames: fixes[cat.id].genreNames,
            }
        };
        changed = true;
        return newCat;
      }
      return cat;
    });

    if (changed) {
      config.catalogs = newCatalogs;
      config.updatedAt = new Date();
      await storage.saveUserConfig(config);
      log.info('Persisted healed genres to storage', { userId });
    }
  } catch (err) {
    log.error('Failed to auto-heal genres in storage', { userId, error: err.message });
  }
}

/**
 * Get all user configs by TMDB API key or apiKeyId (HMAC hash).
 * Uses indexed apiKeyId field for fast O(1) lookups.
 * @param {string|null} apiKey - The raw API key (optional)
 * @param {string|null} apiKeyId - The HMAC hash of the API key (optional)
 * @returns {Promise<Array>} - Array of configs
 */
export async function getConfigsByApiKey(apiKey, apiKeyId = null) {
  log.debug('Getting configs by apiKey/apiKeyId');

  if (!apiKey && !apiKeyId) return [];

  // Compute apiKeyId from raw key if provided
  const targetApiKeyId = apiKeyId || (apiKey ? computeApiKeyId(apiKey) : null);
  
  if (!targetApiKeyId) return [];

  try {
    const storage = getStorage();
    const configs = await storage.getConfigsByApiKeyId(targetApiKeyId);
    log.debug('Found configs by apiKeyId', { count: configs.length });
    return configs;
  } catch (err) {
    log.error('Storage error in getConfigsByApiKey', { error: err.message });
    throw err;
  }
}

/**
 * Delete a user config by userId
 * Requires matching apiKey for security
 */
export async function deleteUserConfig(userId, apiKey) {
  log.info('Deleting user config', { userId });

  // Validate userId
  const safeUserId = sanitizeString(userId, 64);
  if (!isValidUserId(safeUserId)) {
    throw new Error('Invalid user ID format');
  }

  // Validate apiKey format
  if (!apiKey || !isValidApiKeyFormat(apiKey)) {
    throw new Error('Invalid API key format');
  }

  try {
    const storage = getStorage();
    // First find the config to verify ownership
    const config = await storage.getUserConfig(safeUserId);
    if (!config) {
      log.warn('Config not found', { userId: safeUserId });
      throw new Error('Configuration not found');
    }

    // Ownership check is usually done by middleware, but we can double check if needed.
    // Here we assume the caller has authorized this action or we trust the input.
    // Since this function signature takes an apiKey, we should probably check it against the stored one
    // if the caller logic expects us to.
    // However, existing logic seemed to rely on middleware for the check or decrypting stored key.
    
    // Let's check if the API key matches the stored one
    const storedKey = getApiKeyFromConfig(config);
    if (storedKey !== apiKey) {
        throw new Error('Access denied: API key mismatch');
    }

    await storage.deleteUserConfig(safeUserId);

    log.info('Config deleted from storage', { userId: safeUserId });
    return { deleted: true, userId: safeUserId };
  } catch (err) {
    log.error('Storage delete error', { error: err.message });
    throw err;
  }
}

/**
 * Get public platform statistics (totals)
 */
export async function getPublicStats() {
  try {
    const storage = getStorage();
    return await storage.getPublicStats();
  } catch (error) {
    log.error('Failed to get public stats', { error: error.message });
    return { totalUsers: 0, totalCatalogs: 0 };
  }
}

