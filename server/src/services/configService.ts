import crypto from 'crypto';
import { getStorage } from './storage/index.ts';
import { createLogger } from '../utils/logger.ts';
import { sanitizeString, isValidUserId, isValidApiKeyFormat } from '../utils/validation.ts';
import {
  artworkProviderRequiresApiKey,
  validateArtworkProviderApiKey,
} from '../utils/artworkValidation.ts';
import { validateTvdbApiKeyAuthorization } from './artworkService.ts';
import { encrypt, decrypt } from '../utils/encryption.ts';
import { computeApiKeyId } from '../utils/security.ts';
import { getConfigCache } from '../infrastructure/configCache.ts';
import type {
  UserConfig,
  PublicStats,
  ArtworkSettings,
  ArtworkSourceConfig,
  ArtContentType,
  ArtKind,
} from '../types/index.ts';

const log = createLogger('configService');

export function getApiKeyFromConfig(config: UserConfig | null): string | null {
  if (!config) return null;

  if (config.tmdbApiKeyEncrypted) {
    try {
      const decrypted = decrypt(config.tmdbApiKeyEncrypted);
      if (decrypted) return decrypted;
    } catch (err) {
      log.error('Failed to decrypt TMDB API key', { error: (err as Error).message });
    }
  }

  return null;
}

export function getPosterKeyFromConfig(config: UserConfig | null): string | null {
  return getArtworkKeyFromConfig(config, 'poster');
}

export function getArtworkKeyFromConfig(
  config: UserConfig | null,
  artworkType: ArtKind
): string | null {
  const artwork = config?.preferences?.artwork;
  if (!artwork) return null;

  let encryptedValue: string | undefined;

  // New per-content-type format: check movie config as default
  const ART_CONTENT_TYPES: ArtContentType[] = ['movie', 'series', 'anime'];
  if (ART_CONTENT_TYPES.some((ct) => ct in artwork)) {
    const settings = artwork as ArtworkSettings;
    encryptedValue =
      settings.movie?.[artworkType]?.apiKeyEncrypted ||
      settings.series?.[artworkType]?.apiKeyEncrypted ||
      settings.anime?.[artworkType]?.apiKeyEncrypted;
  } else {
    // Legacy flat format
    encryptedValue = (artwork as Record<string, ArtworkSourceConfig>)[artworkType]?.apiKeyEncrypted;
  }

  if (!encryptedValue) return null;

  try {
    return decrypt(encryptedValue);
  } catch (err) {
    log.error('Failed to decrypt artwork API key', {
      artworkType,
      error: (err as Error).message,
    });
    return null;
  }
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

  const storage = getStorage();
  let existingConfig: UserConfig | null = null;
  try {
    existingConfig = await storage.getUserConfig(safeUserId);
  } catch (err) {
    log.warn('Failed to load existing config before save', {
      userId: safeUserId,
      error: (err as Error).message,
    });
  }

  let mergedConfig: UserConfig = {
    ...(existingConfig || {}),
    ...config,
    userId: safeUserId,
    preferences: {
      ...(existingConfig?.preferences || {}),
      ...(config.preferences || {}),
    },
  };

  let encryptedApiKey = mergedConfig.tmdbApiKeyEncrypted || null;
  let rawApiKey = null;

  if (mergedConfig.tmdbApiKey) {
    const safeKey = sanitizeString(mergedConfig.tmdbApiKey, 64);
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

  // Encrypt MAL client ID if provided as raw value
  if (mergedConfig.malClientId) {
    const safeKey = sanitizeString(mergedConfig.malClientId, 128);
    if (safeKey) {
      try {
        mergedConfig.malClientIdEncrypted = encrypt(safeKey) ?? undefined;
      } catch (err) {
        log.error('Failed to encrypt MAL client ID', { error: (err as Error).message });
      }
    }
    const { malClientId: _rawMalClientId, ...configWithoutMalClientId } = mergedConfig;
    mergedConfig = configWithoutMalClientId;
  }

  // Encrypt Simkl API key if provided as raw value
  if (mergedConfig.simklApiKey) {
    const safeKey = sanitizeString(mergedConfig.simklApiKey, 128);
    if (safeKey) {
      try {
        mergedConfig.simklApiKeyEncrypted = encrypt(safeKey) ?? undefined;
      } catch (err) {
        log.error('Failed to encrypt Simkl API key', { error: (err as Error).message });
      }
    }
    const { simklApiKey: _rawSimklApiKey, ...configWithoutSimklApiKey } = mergedConfig;
    mergedConfig = configWithoutSimklApiKey;
  }

  // Encrypt Trakt Client ID if provided as raw value
  if (mergedConfig.traktClientId) {
    const safeKey = sanitizeString(mergedConfig.traktClientId, 128);
    if (safeKey) {
      try {
        mergedConfig.traktClientIdEncrypted = encrypt(safeKey) ?? undefined;
      } catch (err) {
        log.error('Failed to encrypt Trakt Client ID', { error: (err as Error).message });
      }
    }
    const { traktClientId: _rawTraktClientId, ...configWithoutTraktClientId } = mergedConfig;
    mergedConfig = configWithoutTraktClientId;
  }

  // Encrypt global artwork API keys
  if (mergedConfig.preferences?.apiKeys) {
    mergedConfig.preferences.apiKeysEncrypted = mergedConfig.preferences.apiKeysEncrypted || {};
    for (const [provider, key] of Object.entries(mergedConfig.preferences.apiKeys)) {
      if (key && typeof key === 'string') {
        try {
          const encryptedKey = encrypt(sanitizeString(key, 256));
          if (encryptedKey) {
            mergedConfig.preferences.apiKeysEncrypted[provider] = encryptedKey;
          } else {
            delete mergedConfig.preferences.apiKeysEncrypted[provider];
          }
        } catch (err) {
          log.error(`Failed to encrypt API key for ${provider}`, { error: (err as Error).message });
        }
      } else if (key === '') {
        delete mergedConfig.preferences.apiKeysEncrypted[provider];
      }
    }
    delete mergedConfig.preferences.apiKeys;
  }

  const processedCatalogs = (mergedConfig.catalogs || []).map((c) => {
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
    userId: mergedConfig.userId,
    catalogs: processedCatalogs.map((c) => ({ name: c.name, source: c.source })),
  });

  try {
    const processedPreferences = { ...(mergedConfig.preferences || {}) };
    const tvdbAuthorizationCache = new Map<
      string,
      Awaited<ReturnType<typeof validateTvdbApiKeyAuthorization>>
    >();

    const ensureTvdbKeyAuthorization = async (
      apiKey: string,
      contextLabel: string
    ): Promise<void> => {
      const cached = tvdbAuthorizationCache.get(apiKey);
      const result = cached || (await validateTvdbApiKeyAuthorization(apiKey));
      if (!cached) {
        tvdbAuthorizationCache.set(apiKey, result);
      }

      if (result.valid) return;

      if (result.invalidKey) {
        throw new Error(
          `Invalid artwork API key for tvdb (${contextLabel}): ${result.error || 'TVDB rejected this API key'}`
        );
      }

      log.warn(
        'TVDB API key could not be verified due to upstream/network issue; accepting format-valid key',
        {
          context: contextLabel,
          statusCode: result.statusCode,
          error: result.error,
        }
      );
    };

    if (mergedConfig.preferences?.artwork) {
      const artwork = mergedConfig.preferences.artwork;
      const ART_CONTENT_TYPES: ArtContentType[] = ['movie', 'series', 'anime'];
      const isNewFormat = ART_CONTENT_TYPES.some((ct) => ct in artwork);

      if (isNewFormat) {
        // Per-content-type format: iterate content types then art kinds
        const settings = artwork as ArtworkSettings;
        for (const ct of ART_CONTENT_TYPES) {
          const ctConfig = settings[ct];
          if (!ctConfig) continue;
          for (const [kind, sourceConfig] of Object.entries(ctConfig)) {
            if (!sourceConfig) continue;
            const provider = (sourceConfig.provider || 'none') as string;
            const requiresApiKey = artworkProviderRequiresApiKey(provider as any);

            if (sourceConfig.customUrlPattern) {
              const safePattern = sanitizeString(sourceConfig.customUrlPattern, 2000).trim();
              (settings[ct] as Record<string, ArtworkSourceConfig>)[kind].customUrlPattern =
                safePattern || undefined;
            }

            const rawKey = sourceConfig.apiKey;
            if (rawKey !== undefined) {
              const validation = validateArtworkProviderApiKey(provider as any, String(rawKey), {
                required: requiresApiKey,
              });
              if (!validation.valid) {
                throw new Error(
                  `Invalid artwork API key for ${provider} (${ct}/${kind}): ${validation.error}`
                );
              }

              if (provider === 'tvdb' && validation.normalizedKey) {
                await ensureTvdbKeyAuthorization(validation.normalizedKey, `${ct}/${kind}`);
              }

              if (validation.normalizedKey) {
                try {
                  (settings[ct] as Record<string, ArtworkSourceConfig>)[kind].apiKeyEncrypted =
                    encrypt(validation.normalizedKey) ?? undefined;
                } catch (encryptError) {
                  log.error('Failed to encrypt artwork API key', {
                    contentType: ct,
                    kind,
                    error: (encryptError as Error).message,
                  });
                }
              } else {
                (settings[ct] as Record<string, ArtworkSourceConfig>)[kind].apiKeyEncrypted =
                  undefined;
              }
            }

            if (
              requiresApiKey &&
              !sourceConfig.apiKey &&
              !(settings[ct] as Record<string, ArtworkSourceConfig>)[kind].apiKeyEncrypted &&
              !(mergedConfig.preferences?.apiKeysEncrypted instanceof Map
                ? mergedConfig.preferences.apiKeysEncrypted.get(provider)
                : mergedConfig.preferences?.apiKeysEncrypted?.[provider])
            ) {
              throw new Error(
                `Invalid artwork API key for ${provider} (${ct}/${kind}): API key is required for this provider`
              );
            }

            delete (settings[ct] as Record<string, ArtworkSourceConfig>)[kind].apiKey;
          }
        }
        processedPreferences.artwork = settings;
      } else {
        // Legacy flat format
        const legacyArtwork = artwork as Record<string, ArtworkSourceConfig>;
        for (const [type, sourceConfig] of Object.entries(legacyArtwork)) {
          const provider = (sourceConfig.provider || 'none') as string;
          const requiresApiKey = artworkProviderRequiresApiKey(provider as any);

          if (sourceConfig.customUrlPattern) {
            const safePattern = sanitizeString(sourceConfig.customUrlPattern, 2000).trim();
            legacyArtwork[type].customUrlPattern = safePattern || undefined;
          }

          const rawKey = sourceConfig.apiKey;
          if (rawKey !== undefined) {
            const validation = validateArtworkProviderApiKey(provider as any, String(rawKey), {
              required: requiresApiKey,
            });
            if (!validation.valid) {
              throw new Error(
                `Invalid artwork API key for ${provider} (${type}): ${validation.error}`
              );
            }

            if (provider === 'tvdb' && validation.normalizedKey) {
              await ensureTvdbKeyAuthorization(validation.normalizedKey, type);
            }

            if (validation.normalizedKey) {
              try {
                legacyArtwork[type].apiKeyEncrypted =
                  encrypt(validation.normalizedKey) ?? undefined;
              } catch (encryptError) {
                log.error('Failed to encrypt artwork API key', {
                  type,
                  error: (encryptError as Error).message,
                });
              }
            } else {
              legacyArtwork[type].apiKeyEncrypted = undefined;
            }
          }

          if (
            requiresApiKey &&
            !sourceConfig.apiKey &&
            !legacyArtwork[type].apiKeyEncrypted &&
            !(mergedConfig.preferences?.apiKeysEncrypted instanceof Map
              ? mergedConfig.preferences.apiKeysEncrypted.get(provider)
              : mergedConfig.preferences?.apiKeysEncrypted?.[provider])
          ) {
            throw new Error(
              `Invalid artwork API key for ${provider} (${type}): API key is required for this provider`
            );
          }

          delete legacyArtwork[type].apiKey;
        }
        processedPreferences.artwork = legacyArtwork;
      }
    }

    const updateData = {
      ...mergedConfig,
      configName: mergedConfig.configName || '',
      catalogs: processedCatalogs,
      preferences: processedPreferences,
      updatedAt: new Date(),
    };

    let apiKeyForHash: string | null = null;
    try {
      apiKeyForHash = rawApiKey || (encryptedApiKey ? decrypt(encryptedApiKey) : null);
    } catch (err) {
      log.error('Failed to decrypt API key during save', { error: (err as Error).message });
    }
    if (apiKeyForHash) {
      updateData.apiKeyId = await computeApiKeyId(apiKeyForHash);
    }

    if (encryptedApiKey) {
      updateData.tmdbApiKeyEncrypted = encryptedApiKey;
    }
    delete updateData.tmdbApiKey;

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

export function getMalKeyFromConfig(config: UserConfig | null): string | null {
  if (!config?.malClientIdEncrypted) return null;
  try {
    return decrypt(config.malClientIdEncrypted);
  } catch (err) {
    log.error('Failed to decrypt MAL client ID', { error: (err as Error).message });
    return null;
  }
}

export function getSimklKeyFromConfig(config: UserConfig | null): string | null {
  if (!config?.simklApiKeyEncrypted) return null;
  try {
    return decrypt(config.simklApiKeyEncrypted);
  } catch (err) {
    log.error('Failed to decrypt Simkl API key', { error: (err as Error).message });
    return null;
  }
}

export function getTraktKeyFromConfig(config: UserConfig | null): string | null {
  if (!config?.traktClientIdEncrypted) return null;
  try {
    return decrypt(config.traktClientIdEncrypted);
  } catch (err) {
    log.error('Failed to decrypt Trakt Client ID', { error: (err as Error).message });
    return null;
  }
}
