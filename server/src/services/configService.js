import crypto from 'crypto';
import { UserConfig } from '../models/UserConfig.js';
import { isConnected } from './database.js';
import * as tmdb from './tmdb.js';
import { createLogger } from '../utils/logger.js';
import { sanitizeString, isValidUserId, isValidApiKeyFormat } from '../utils/validation.js';

const log = createLogger('configService');

// In-memory fallback when MongoDB is not available
const memoryStore = new Map();

/**
 * Get user config (from DB or memory)
 */
export async function getUserConfig(userId, overrideApiKey = null) {
    log.info('Getting user config', { userId, dbConnected: isConnected() });

    if (isConnected()) {
        try {
            log.info('Querying MongoDB for userId', { userId, userIdType: typeof userId });
            const config = await UserConfig.findOne({ userId }).lean();
            log.info('MongoDB query result', { found: !!config, userId: config?.userId, catalogCount: config?.catalogs?.length || 0 });
            // Resolve stored IDs into display placeholders for UI
            try {
                // Allow caller to provide an apiKey (e.g. the user entered it on the Configure page)
                const apiKey = overrideApiKey || config.tmdbApiKey;
                if (apiKey && config.catalogs && config.catalogs.length > 0) {
                    // Resolve in parallel with limited concurrency
                    const resolveCatalogPromises = config.catalogs.map(async (catalog) => {
                        const filters = catalog.filters || {};

                        // Helper to parse CSV or array into string array
                        const parseIds = (val) => {
                            if (!val) return [];
                            if (Array.isArray(val)) return val.map(String).filter(Boolean);
                            return String(val).split(',').map(s => s.trim()).filter(Boolean);
                        };

                        const withPeopleIds = parseIds(filters.withPeople);
                        const withCompaniesIds = parseIds(filters.withCompanies);
                        const withKeywordsIds = parseIds(filters.withKeywords);

                        // Resolve people
                        const peopleResolved = await Promise.all(withPeopleIds.map(id => tmdb.getPersonById(apiKey, id)));
                        const peoplePlaceholders = peopleResolved.filter(Boolean).map(p => ({ value: String(p.id), label: p.name }));

                        // Resolve companies
                        const companiesResolved = await Promise.all(withCompaniesIds.map(id => tmdb.getCompanyById(apiKey, id)));
                        const companyPlaceholders = companiesResolved.filter(Boolean).map(cmp => ({ value: String(cmp.id), label: cmp.name }));

                        // Resolve keywords
                        const keywordsResolved = await Promise.all(withKeywordsIds.map(id => tmdb.getKeywordById(apiKey, id)));
                        const keywordPlaceholders = keywordsResolved.filter(Boolean).map(k => ({ value: String(k.id), label: k.name }));

                        return {
                            ...catalog,
                            filters: {
                                ...filters,
                                // Attach resolved arrays (client will use these for placeholders)
                                withPeopleResolved: peoplePlaceholders,
                                withCompaniesResolved: companyPlaceholders,
                                withKeywordsResolved: keywordPlaceholders,
                            }
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
    log.debug('Saving user config', { userId: config.userId, catalogCount: config.catalogs?.length || 0 });

    // Defensive: ensure values used in Mongo queries are simple, validated strings.
    const safeUserId = sanitizeString(config?.userId, 64);
    if (!isValidUserId(safeUserId)) {
        throw new Error('Invalid user ID format');
    }

    const safeTmdbApiKey = config?.tmdbApiKey ? sanitizeString(config.tmdbApiKey, 64) : null;
    if (safeTmdbApiKey && !isValidApiKeyFormat(safeTmdbApiKey)) {
        throw new Error('Invalid TMDB API key format');
    }

    // Ensure catalogs have proper _id fields (applies to both DB and memory paths)
    const processedCatalogs = (config.catalogs || []).map(c => ({
        ...c,
        _id: c._id || c.id || crypto.randomUUID(),
    }));

    if (isConnected()) {
        try {
            // Use findOneAndUpdate to properly handle nested array updates
            const result = await UserConfig.findOneAndUpdate(
                { userId: safeUserId },
                {
                    $set: {
                        tmdbApiKey: safeTmdbApiKey,
                        configName: config.configName || '',
                        catalogs: processedCatalogs,
                        preferences: config.preferences || {},
                        updatedAt: new Date(),
                    }
                },
                {
                    new: true, // Return the updated document
                    upsert: true, // Create if doesn't exist
                    runValidators: true,
                    setDefaultsOnInsert: true,
                }
            ).lean(); // Use lean() for plain JS object

            log.debug('Config saved to MongoDB', { userId: result?.userId, catalogCount: result?.catalogs?.length || 0 });
            return result;
        } catch (dbError) {
            log.error('MongoDB save error', { error: dbError.message });
            throw dbError;
        }
    }

    const memConfig = {
        ...config,
        userId: safeUserId,
        tmdbApiKey: safeTmdbApiKey,
        configName: config.configName || '',
        catalogs: processedCatalogs,
        _id: safeUserId
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
            const configs = await UserConfig.find({ tmdbApiKey: apiKey }).lean();
            log.debug('Found configs in MongoDB', { count: configs.length });
            return configs;
        } catch (err) {
            log.error('MongoDB error in getConfigsByApiKey', { error: err.message });
            throw err;
        }
    }

    // Memory store fallback: filter by apiKey
    const results = [];
    for (const [, config] of memoryStore.entries()) {
        if (config.tmdbApiKey === apiKey) {
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
            // Find and delete only if apiKey matches (security check)
            const result = await UserConfig.findOneAndDelete({
                userId: safeUserId,
                tmdbApiKey: apiKey,
            });

            if (!result) {
                log.warn('Config not found or apiKey mismatch', { userId: safeUserId });
                throw new Error('Configuration not found or access denied');
            }

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
    if (existing.tmdbApiKey !== apiKey) {
        throw new Error('Access denied');
    }

    memoryStore.delete(safeUserId);
    log.info('Config deleted from memory store', { userId: safeUserId });
    return { deleted: true, userId: safeUserId };
}
