import crypto from 'crypto';
import { getStorage } from './storage/index.js';
import { createLogger } from '../utils/logger.js';
import { sanitizeString, isValidUserId, isValidApiKeyFormat } from '../utils/validation.js';
import { encrypt, decrypt } from '../utils/encryption.js';
import { computeApiKeyId } from '../utils/security.js';

const log = createLogger('configService');

export function getApiKeyFromConfig(config) {
  if (!config) return null;

  if (config.tmdbApiKeyEncrypted) {
    const decrypted = decrypt(config.tmdbApiKeyEncrypted);
    if (decrypted) return decrypted;
  }

  return null;
}

export function getPosterKeyFromConfig(config) {
  if (!config?.preferences?.posterApiKeyEncrypted) return null;
  return decrypt(config.preferences.posterApiKeyEncrypted);
}

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

export async function saveUserConfig(config) {
  log.debug('Saving user config', {
    userId: config.userId,
    catalogCount: config.catalogs?.length || 0,
  });

  const safeUserId = sanitizeString(config?.userId, 64);
  if (!isValidUserId(safeUserId)) {
    throw new Error('Invalid user ID format');
  }

  let encryptedApiKey = config.tmdbApiKeyEncrypted || null;
  let rawApiKey = null;

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

  const processedCatalogs = (config.catalogs || []).map((c) => {
    const { displayLanguage, ...cleanFilters } = c.filters || {};
    return {
      ...c,
      _id: c._id || c.id || crypto.randomUUID(),
      filters: cleanFilters,
    };
  });

  try {
    const processedPreferences = { ...(config.preferences || {}) };

    if (config.preferences?.posterApiKey) {
      const rawPosterKey = sanitizeString(config.preferences.posterApiKey, 128);
      if (rawPosterKey) {
        try {
          processedPreferences.posterApiKeyEncrypted = encrypt(rawPosterKey);
        } catch (encryptError) {
          log.error('Failed to encrypt poster API key', { error: encryptError.message });
        }
      }
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

    const apiKeyForHash = rawApiKey || (encryptedApiKey ? decrypt(encryptedApiKey) : null);
    if (apiKeyForHash) {
      updateData.apiKeyId = computeApiKeyId(apiKeyForHash);
    }

    if (encryptedApiKey) {
      updateData.tmdbApiKeyEncrypted = encryptedApiKey;
    }
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

export async function updateCatalogGenres(userId, fixes) {
  if (!fixes || Object.keys(fixes).length === 0) return;

  log.info('Updating catalog genres (self-healing)', {
    userId,
    fixedCount: Object.keys(fixes).length,
  });

  try {
    const storage = getStorage();
    const config = await storage.getUserConfig(userId);
    if (!config) return;

    let changed = false;
    const newCatalogs = config.catalogs.map((cat) => {
      if (fixes[cat.id]) {
        const newCat = {
          ...cat,
          filters: {
            ...cat.filters,
            genres: fixes[cat.id].genres,
            genreNames: fixes[cat.id].genreNames,
          },
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

// Uses indexed apiKeyId for O(1) lookup instead of scanning all configs
export async function getConfigsByApiKey(apiKey, apiKeyId = null) {
  log.debug('Getting configs by apiKey/apiKeyId');

  if (!apiKey && !apiKeyId) return [];

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

export async function deleteUserConfig(userId, apiKey) {
  log.info('Deleting user config', { userId });

  const safeUserId = sanitizeString(userId, 64);
  if (!isValidUserId(safeUserId)) {
    throw new Error('Invalid user ID format');
  }

  if (!apiKey || !isValidApiKeyFormat(apiKey)) {
    throw new Error('Invalid API key format');
  }

  try {
    const storage = getStorage();
    const config = await storage.getUserConfig(safeUserId);
    if (!config) {
      log.warn('Config not found', { userId: safeUserId });
      throw new Error('Configuration not found');
    }

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

export async function getPublicStats() {
  try {
    const storage = getStorage();
    return await storage.getPublicStats();
  } catch (error) {
    log.error('Failed to get public stats', { error: error.message });
    return { totalUsers: 0, totalCatalogs: 0 };
  }
}
