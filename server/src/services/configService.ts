import crypto from 'crypto';
import { getStorage } from './storage/index.ts';
import { createLogger } from '../utils/logger.ts';
import { sanitizeString, isValidUserId, isValidApiKeyFormat } from '../utils/validation.ts';
import { encrypt, decrypt } from '../utils/encryption.ts';
import { computeApiKeyId } from '../utils/security.ts';
import { getConfigCache } from '../infrastructure/configCache.ts';
import type { UserConfig, PublicStats } from '../types/index.ts';

const log = createLogger('configService');

export function getApiKeyFromConfig(config: UserConfig | null): string | null {
  if (!config) return null;

  if (config.tmdbApiKeyEncrypted) {
    const decrypted = decrypt(config.tmdbApiKeyEncrypted);
    if (decrypted) return decrypted;
  }

  return null;
}

export function getPosterKeyFromConfig(config: UserConfig | null): string | null {
  if (!config?.preferences?.posterApiKeyEncrypted) return null;
  return decrypt(config.preferences.posterApiKeyEncrypted);
}

export async function getUserConfig(
  userId: string,
  overrideApiKey: string | null = null
): Promise<UserConfig | null> {
  log.debug('Getting user config', { userId });

  const configCache = getConfigCache();
  try {
    const config = await configCache.getOrLoad(userId, async () => {
      const storage = getStorage();
      const result = await storage.getUserConfig(userId);
      log.debug('Storage query result', {
        found: !!result,
        userId: result?.userId,
        catalogCount: result?.catalogs?.length || 0,
      });
      return result;
    });
    return config as UserConfig | null;
  } catch (err) {
    log.error('Storage error', { error: (err as Error).message });
    throw err;
  }
}

export async function saveUserConfig(config: UserConfig): Promise<UserConfig> {
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

    // Sanitize fields that must be strings (not arrays) per Mongoose schema
    if (Array.isArray(cleanFilters.countries)) {
      cleanFilters.countries =
        cleanFilters.countries.length > 0 ? cleanFilters.countries.join(',') : undefined;
    }
    if (Array.isArray(cleanFilters.watchMonetizationType)) {
      cleanFilters.watchMonetizationType = cleanFilters.watchMonetizationType[0] || undefined;
    }

    return {
      ...c,
      _id: c._id || c.id || crypto.randomUUID(),
      filters: cleanFilters,
    };
  });

  log.debug('Processed catalogs for saving', {
    userId: config.userId,
    catalogs: processedCatalogs.map((c) => ({ name: c.name, source: c.source })),
  });

  try {
    const processedPreferences = { ...(config.preferences || {}) };

    if (config.preferences?.posterApiKey) {
      const rawPosterKey = sanitizeString(config.preferences.posterApiKey, 128);
      if (rawPosterKey) {
        try {
          processedPreferences.posterApiKeyEncrypted = encrypt(rawPosterKey) ?? undefined;
        } catch (encryptError) {
          log.error('Failed to encrypt poster API key', { error: (encryptError as Error).message });
        }
      }
      delete processedPreferences.posterApiKey;
    }

    const updateData = {
      ...config,
      configName: config.configName || '',
      catalogs: processedCatalogs,
      preferences: processedPreferences,
      updatedAt: new Date(),
    };

    const apiKeyForHash = rawApiKey || (encryptedApiKey ? decrypt(encryptedApiKey) : null);
    if (apiKeyForHash) {
      updateData.apiKeyId = await computeApiKeyId(apiKeyForHash);
    }

    if (encryptedApiKey) {
      updateData.tmdbApiKeyEncrypted = encryptedApiKey;
    }
    delete updateData.tmdbApiKey;

    const storage = getStorage();
    const result = await storage.saveUserConfig(updateData);

    const configCache = getConfigCache();
    configCache.invalidate(safeUserId);
    if (result) configCache.set(safeUserId, result);

    log.debug('Config saved to storage', {
      userId: result?.userId,
      catalogCount: result?.catalogs?.length || 0,
    });
    return result;
  } catch (dbError) {
    log.error('Storage save error', { error: (dbError as Error).message });
    throw dbError;
  }
}

export async function updateCatalogGenres(
  userId: string,
  fixes: Record<string, { genres: number[]; genreNames: string[] }>
): Promise<void> {
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
      const catId = cat.id;
      if (catId && fixes[catId]) {
        const newCat = {
          ...cat,
          filters: {
            ...cat.filters,
            genres: fixes[catId].genres,
            genreNames: fixes[catId].genreNames,
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

      const configCache = getConfigCache();
      configCache.invalidate(userId);

      log.info('Persisted healed genres to storage', { userId });
    }
  } catch (err) {
    log.error('Failed to auto-heal genres in storage', { userId, error: (err as Error).message });
  }
}

export async function getConfigsByApiKey(
  apiKey: string | null,
  apiKeyId: string | null = null
): Promise<UserConfig[]> {
  log.debug('Getting configs by apiKey/apiKeyId');

  if (!apiKey && !apiKeyId) return [];

  const targetApiKeyId = apiKeyId || (apiKey ? await computeApiKeyId(apiKey) : null);

  if (!targetApiKeyId) return [];

  try {
    const storage = getStorage();
    const configs = await storage.getConfigsByApiKeyId(targetApiKeyId);
    log.debug('Found configs by apiKeyId', { count: configs.length });
    return configs;
  } catch (err) {
    log.error('Storage error in getConfigsByApiKey', { error: (err as Error).message });
    throw err;
  }
}

export async function deleteUserConfig(
  userId: string,
  apiKey: string
): Promise<{ deleted: boolean; userId: string }> {
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

    const configCache = getConfigCache();
    configCache.invalidate(safeUserId);

    log.info('Config deleted from storage', { userId: safeUserId });
    return { deleted: true, userId: safeUserId };
  } catch (err) {
    log.error('Storage delete error', { error: (err as Error).message });
    throw err;
  }
}

export async function getPublicStats(): Promise<PublicStats> {
  try {
    const storage = getStorage();
    return await storage.getPublicStats();
  } catch (error) {
    log.error('Failed to get public stats', { error: (error as Error).message });
    return { totalUsers: 0, totalCatalogs: 0 };
  }
}
