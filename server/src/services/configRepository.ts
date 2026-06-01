/**
 * ConfigRepository — Pure persistence layer for user configurations.
 *
 * Single responsibility: CRUD against the storage adapter,
 * cache invalidation, and public stats. No encryption logic,
 * no validation beyond userId format checks at the boundary.
 */
import { getStorage } from './storage/index.ts';
import { getConfigCache } from '../infrastructure/configCache.ts';
import { createLogger } from '../utils/logger.ts';
import { sanitizeString, isValidUserId } from '../utils/validation.ts';
import type { UserConfig, PublicStats } from '../types/index.ts';

const log = createLogger('configRepository');

/**
 * Load a single user config (cache-first, with stampede protection).
 */
export async function getUserConfig(userId: string): Promise<UserConfig | null> {
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

/**
 * Persist a fully-prepared config object to storage.
 * Caller is responsible for encryption and validation.
 */
export async function saveUserConfig(config: UserConfig): Promise<UserConfig> {
  const safeUserId = sanitizeString(config?.userId, 64);
  if (!isValidUserId(safeUserId)) {
    throw new Error('Invalid user ID format');
  }

  const storage = getStorage();
  const result = await storage.saveUserConfig({ ...config, userId: safeUserId });

  const configCache = getConfigCache();
  configCache.invalidate(safeUserId);
  if (result) configCache.set(safeUserId, result);

  log.debug('Config saved to storage', {
    userId: result?.userId,
    catalogCount: result?.catalogs?.length || 0,
  });
  return result;
}

/**
 * Load all configs sharing the same apiKeyId.
 */
export async function getConfigsByApiKeyId(apiKeyId: string): Promise<UserConfig[]> {
  if (!apiKeyId) return [];
  try {
    const storage = getStorage();
    const configs = await storage.getConfigsByApiKeyId(apiKeyId);
    log.debug('Found configs by apiKeyId', { count: configs.length });
    return configs;
  } catch (err) {
    log.error('Storage error in getConfigsByApiKeyId', { error: (err as Error).message });
    throw err;
  }
}

/**
 * Delete a user config and invalidate cache.
 */
export async function deleteUserConfig(userId: string): Promise<void> {
  const safeUserId = sanitizeString(userId, 64);
  if (!isValidUserId(safeUserId)) {
    throw new Error('Invalid user ID format');
  }
  const storage = getStorage();
  await storage.deleteUserConfig(safeUserId);

  const configCache = getConfigCache();
  configCache.invalidate(safeUserId);
  log.info('Config deleted from storage', { userId: safeUserId });
}

/**
 * Public stats (total users, catalogs).
 */
export async function getPublicStats(): Promise<PublicStats> {
  try {
    const storage = getStorage();
    return await storage.getPublicStats();
  } catch (error) {
    log.error('Failed to get public stats', { error: (error as Error).message });
    return { totalUsers: 0, totalCatalogs: 0 };
  }
}

/**
 * Load an existing config from storage (raw, no cache).
 */
export async function loadRawConfig(userId: string): Promise<UserConfig | null> {
  const storage = getStorage();
  return storage.getUserConfig(userId);
}
