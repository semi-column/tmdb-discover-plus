import { Router } from 'express';
import { nanoid } from 'nanoid';
import crypto from 'crypto';
import { UserConfig } from '../models/UserConfig.js';
import { isConnected } from './database.js';
import * as tmdb from './tmdb.js';
import { shuffleArray, getBaseUrl, parseIdArray } from '../utils/helpers.js';
import { createLogger } from '../utils/logger.js';
import { 
  isValidUserId, 
  isValidCatalogId,
  isValidApiKeyFormat,
  sanitizeString,
  sanitizePage,
  sanitizeFilters 
} from '../utils/validation.js';

const router = Router();
const log = createLogger('userConfig');

// In-memory fallback when MongoDB is not available
const memoryStore = new Map();

/**
 * Get user config (from DB or memory)
 */
async function getUserConfig(userId, overrideApiKey = null) {
  log.debug('Getting user config', { userId, dbConnected: isConnected() });
  
  if (isConnected()) {
    try {
      const config = await UserConfig.findOne({ userId }).lean();
      log.debug('MongoDB query result', config ? { userId: config.userId, catalogCount: config.catalogs?.length || 0 } : null);
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
async function saveUserConfig(config) {
  log.debug('Saving user config', { userId: config.userId, catalogCount: config.catalogs?.length || 0 });
  
  if (isConnected()) {
    try {
      // Ensure catalogs have proper _id fields
      const processedCatalogs = (config.catalogs || []).map(c => ({
        ...c,
        _id: c._id || crypto.randomUUID(),
      }));
      
      // Use findOneAndUpdate to properly handle nested array updates
      const result = await UserConfig.findOneAndUpdate(
        { userId: config.userId },
        { 
          $set: {
            tmdbApiKey: config.tmdbApiKey,
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
  memoryStore.set(config.userId, { ...config, _id: config.userId });
  log.debug('Config saved to memory store', { userId: config.userId });
  return config;
}

// ============================================
// API Routes for Frontend
// ============================================

/**
 * Validate TMDB API key
 */
router.post('/validate-key', async (req, res) => {
  try {
    const { apiKey } = req.body;
    if (!apiKey) {
      return res.status(400).json({ error: 'API key required' });
    }
    // Quick format check before making external request
    if (!isValidApiKeyFormat(apiKey)) {
      return res.json({ valid: false, error: 'Invalid API key format' });
    }
    const result = await tmdb.validateApiKey(apiKey);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get genres list
 */
router.get('/genres/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const { apiKey } = req.query;
    
    if (!apiKey) {
      return res.status(400).json({ error: 'API key required' });
    }

    const genres = await tmdb.getGenres(apiKey, type);
    res.json(genres);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get available languages
 */
router.get('/languages', async (req, res) => {
  try {
    const { apiKey } = req.query;
    if (!apiKey) {
      return res.status(400).json({ error: 'API key required' });
    }

    const languages = await tmdb.getLanguages(apiKey);
    res.json(languages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get available countries
 */
router.get('/countries', async (req, res) => {
  try {
    const { apiKey } = req.query;
    if (!apiKey) {
      return res.status(400).json({ error: 'API key required' });
    }

    const countries = await tmdb.getCountries(apiKey);
    res.json(countries);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get certifications (age ratings)
 */
router.get('/certifications/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const { apiKey } = req.query;
    if (!apiKey) {
      return res.status(400).json({ error: 'API key required' });
    }

    const certifications = await tmdb.getCertifications(apiKey, type);
    res.json(certifications);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get watch providers for a region
 */
router.get('/watch-providers/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const { apiKey, region } = req.query;
    if (!apiKey) {
      return res.status(400).json({ error: 'API key required' });
    }

    const providers = await tmdb.getWatchProviders(apiKey, type, region || 'US');
    res.json(providers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get available watch regions
 */
router.get('/watch-regions', async (req, res) => {
  try {
    const { apiKey } = req.query;
    if (!apiKey) {
      return res.status(400).json({ error: 'API key required' });
    }

    const regions = await tmdb.getWatchRegions(apiKey);
    res.json(regions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Search for people (actors, directors)
 */
router.get('/search/person', async (req, res) => {
  try {
    const { apiKey, query } = req.query;
    if (!apiKey || !query) {
      return res.status(400).json({ error: 'API key and query required' });
    }

    const results = await tmdb.searchPerson(apiKey, query);
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Search for companies
 */
router.get('/search/company', async (req, res) => {
  try {
    const { apiKey, query } = req.query;
    if (!apiKey || !query) {
      return res.status(400).json({ error: 'API key and query required' });
    }

    const results = await tmdb.searchCompany(apiKey, query);
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Search for keywords
 */
router.get('/search/keyword', async (req, res) => {
  try {
    const { apiKey, query } = req.query;
    if (!apiKey || !query) {
      return res.status(400).json({ error: 'API key and query required' });
    }

    const results = await tmdb.searchKeyword(apiKey, query);
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get person by ID (resolve single person name)
 */
router.get('/person/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { apiKey } = req.query;
    if (!apiKey || !id) return res.status(400).json({ error: 'API key and id required' });
    const person = await tmdb.getPersonById(apiKey, id);
    if (!person) return res.status(404).json({ error: 'Not found' });
    res.json({ id: String(person.id), name: person.name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Get company by ID (resolve single company name)
 */
router.get('/company/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { apiKey } = req.query;
    if (!apiKey || !id) return res.status(400).json({ error: 'API key and id required' });
    const company = await tmdb.getCompanyById(apiKey, id);
    if (!company) return res.status(404).json({ error: 'Not found' });
    res.json({ id: String(company.id), name: company.name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Get keyword by ID (resolve single keyword name)
 */
router.get('/keyword/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { apiKey } = req.query;
    if (!apiKey || !id) return res.status(400).json({ error: 'API key and id required' });
    const keyword = await tmdb.getKeywordById(apiKey, id);
    if (!keyword) return res.status(404).json({ error: 'Not found' });
    res.json({ id: String(keyword.id), name: keyword.name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Get sort options (by content type)
 */
router.get('/sort-options', (req, res) => {
  const { type } = req.query;
  if (type && tmdb.SORT_OPTIONS[type]) {
    res.json(tmdb.SORT_OPTIONS[type]);
  } else {
    res.json(tmdb.SORT_OPTIONS);
  }
});

/**
 * Get list types (trending, now playing, etc.)
 */
router.get('/list-types', (req, res) => {
  const { type } = req.query;
  if (type && tmdb.LIST_TYPES[type]) {
    res.json(tmdb.LIST_TYPES[type]);
  } else {
    res.json(tmdb.LIST_TYPES);
  }
});

/**
 * Get preset catalogs (pre-built list types for quick adding)
 */
router.get('/preset-catalogs', (req, res) => {
  const { type } = req.query;
  if (type && tmdb.PRESET_CATALOGS[type]) {
    res.json(tmdb.PRESET_CATALOGS[type]);
  } else {
    res.json(tmdb.PRESET_CATALOGS);
  }
});

/**
 * Get release types (for movies)
 */
router.get('/release-types', (req, res) => {
  res.json(tmdb.RELEASE_TYPES);
});

/**
 * Get TV statuses
 */
router.get('/tv-statuses', (req, res) => {
  res.json(tmdb.TV_STATUSES);
});

/**
 * Get TV types
 */
router.get('/tv-types', (req, res) => {
  res.json(tmdb.TV_TYPES);
});

/**
 * Get monetization types
 */
router.get('/monetization-types', (req, res) => {
  res.json(tmdb.MONETIZATION_TYPES);
});

/**
 * Get TV networks list
 */
router.get('/tv-networks', (req, res) => {
  const { query } = req.query;
  let networks = tmdb.TV_NETWORKS;
  
  // Filter by search query if provided
  if (query) {
    const searchLower = query.toLowerCase();
    networks = networks.filter(n => 
      n.name.toLowerCase().includes(searchLower)
    );
  }
  
  res.json(networks);
});

/**
 * Preview catalog with filters
 */
router.post('/preview', async (req, res) => {
  try {
    const { apiKey, type, filters, page = 1 } = req.body;
    
    if (!apiKey) {
      return res.status(400).json({ error: 'API key required' });
    }

    let results;
    
    // Check if using a special list type (trending, now playing, etc.)
    const listType = filters?.listType;
    const isRandomSort = filters?.sortBy === 'random';
    
    if (listType && listType !== 'discover') {
      // Use special list endpoint
      results = await tmdb.fetchSpecialList(apiKey, listType, type, {
        page,
        language: filters?.language,
        region: filters?.originCountry,
      });
    } else if (isRandomSort) {
      // Random sort - fetch from random page and shuffle
      const discoverResult = await tmdb.discover(apiKey, {
        type,
        ...filters,
        sortBy: 'popularity.desc', // Use popularity for base query
        page: 1,
      });
      const maxPage = Math.min(discoverResult.total_pages || 1, 500);
      const randomPage = Math.floor(Math.random() * maxPage) + 1;
      results = await tmdb.discover(apiKey, {
        type,
        ...filters,
        sortBy: 'popularity.desc',
        page: randomPage,
      });
      // Shuffle the results
      results.results = shuffleArray(results.results || []);
    } else {
      // Use discover with all filters
      results = await tmdb.discover(apiKey, {
        type,
        ...filters,
        page,
      });
    }

    // If excludeGenres provided, normalize it so we can post-filter results
    const normalizeCsvOrArray = (val) => {
      if (!val) return [];
      if (Array.isArray(val)) return val.map(String).filter(Boolean);
      return String(val).split(',').map(s => s.trim()).filter(Boolean);
    };

    // Post-filter: ensure excluded genres always remove items even if included genres matched
    if (filters?.excludeGenres && results?.results && Array.isArray(results.results)) {
      try {
        const excludeGenres = normalizeCsvOrArray(filters.excludeGenres).map(String);
        if (excludeGenres.length > 0) {
          const excludeSet = new Set(excludeGenres);
          results.results = results.results.filter(item => {
            const ids = (item.genre_ids || (item.genres && item.genres.map(g => g.id)) || []).map(String);
            // keep item only if it does NOT contain any excluded genre
            return !ids.some(id => excludeSet.has(id));
          });
          // Update totals to reflect post-filtering for preview
          results.total_results = results.results.length;
          results.total_pages = Math.max(1, Math.ceil(results.total_results / (results.results.length > 0 ? results.results.length : 20)));
          results.page = 1;
        }
      } catch (err) {
        log.error('Error applying excludeGenres post-filter', { error: err.message });
      }
    }

    // Convert to Stremio format and fetch IMDB IDs
    const metas = await Promise.all(
      results.results.slice(0, 20).map(async (item) => {
        let imdbId = null;
        
        if (filters?.imdbOnly !== false) {
          const externalIds = await tmdb.getExternalIds(apiKey, item.id, type);
          imdbId = externalIds?.imdb_id || null;
          
          // Skip items without IMDB ID if imdbOnly is true
          if (filters?.imdbOnly && !imdbId) {
            return null;
          }
        }

        return tmdb.toStremioMeta(item, type, imdbId);
      })
    );

    // Filter out nulls (items without IMDB IDs when imdbOnly is true)
    const filteredMetas = metas.filter(Boolean);

    log.debug('Preview results', { fetchedCount: results.results?.length || 0, filteredCount: filteredMetas.length });

    // If no metas returned, include a flag so frontend can render helpful UI
    const responsePayload = {
      metas: filteredMetas,
      totalResults: results.total_results,
      totalPages: results.total_pages,
      page: results.page,
      previewEmpty: filteredMetas.length === 0,
    };

    res.json(responsePayload);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Create or update user configuration
 */
router.post('/config', async (req, res) => {
  try {
    const { userId, tmdbApiKey, catalogs, preferences } = req.body;
    
    log.info('Create/update config request', { userId, catalogCount: catalogs?.length || 0 });
    
    if (!tmdbApiKey) {
      return res.status(400).json({ error: 'TMDB API key required' });
    }

    // Validate API key format before making external request
    if (!isValidApiKeyFormat(tmdbApiKey)) {
      return res.status(400).json({ error: 'Invalid TMDB API key format' });
    }

    // Validate userId format if provided
    if (userId && !isValidUserId(userId)) {
      return res.status(400).json({ error: 'Invalid user ID format' });
    }

    // Validate API key with TMDB
    const validation = await tmdb.validateApiKey(tmdbApiKey);
    if (!validation.valid) {
      return res.status(400).json({ error: 'Invalid TMDB API key' });
    }

    // Generate new userId if not provided
    const id = userId || nanoid(10);

    const config = await saveUserConfig({
      userId: id,
      tmdbApiKey,
      catalogs: catalogs || [],
      preferences: preferences || {},
    });

    const baseUrl = getBaseUrl(req);
    const host = baseUrl.replace(/^https?:\/\//, '');
    
    const response = {
      userId: id,
      catalogs: config.catalogs || [],
      preferences: config.preferences || {},
      installUrl: `stremio://${host}/${id}/manifest.json`,
      configureUrl: `${baseUrl}/configure/${id}`,
    };
    
    log.info('Config saved', { userId: id, catalogCount: response.catalogs.length });
    res.json(response);
  } catch (error) {
    log.error('POST /config error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get user configuration
 */
router.get('/config/:userId', async (req, res) => {
  try {
    // Prevent caching so config changes reflect immediately
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    
    const { userId } = req.params;
    
    // Validate userId format
    if (!isValidUserId(userId)) {
      return res.status(400).json({ error: 'Invalid user ID format' });
    }
    
    const overrideApiKey = req.query?.apiKey || null;
    
    // Validate override API key format if provided
    if (overrideApiKey && !isValidApiKeyFormat(overrideApiKey)) {
      return res.status(400).json({ error: 'Invalid API key format' });
    }
    
    log.debug('Get config request', { userId });
    
    const config = await getUserConfig(userId, overrideApiKey);
    
    if (!config) {
      log.debug('Config not found', { userId });
      return res.status(404).json({ error: 'Configuration not found' });
    }

    const response = {
      userId: config.userId,
      catalogs: config.catalogs || [],
      preferences: config.preferences || {},
      hasApiKey: !!config.tmdbApiKey,
    };
    
    log.debug('Returning config', { userId, catalogCount: response.catalogs.length });
    res.json(response);
  } catch (error) {
    log.error('GET /config/:userId error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * Update user configuration
 */
router.put('/config/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { tmdbApiKey, catalogs, preferences } = req.body;
    
    // Validate userId format
    if (!isValidUserId(userId)) {
      return res.status(400).json({ error: 'Invalid user ID format' });
    }
    
    log.debug('Update config request', { userId, catalogCount: catalogs?.length || 0 });
    
    const existing = await getUserConfig(userId);
    if (!existing) {
      log.debug('Config not found for update', { userId });
      return res.status(404).json({ error: 'Configuration not found' });
    }

    // Validate new API key format and with TMDB if provided
    if (tmdbApiKey && tmdbApiKey !== existing.tmdbApiKey) {
      if (!isValidApiKeyFormat(tmdbApiKey)) {
        return res.status(400).json({ error: 'Invalid TMDB API key format' });
      }
      const validation = await tmdb.validateApiKey(tmdbApiKey);
      if (!validation.valid) {
        return res.status(400).json({ error: 'Invalid TMDB API key' });
      }
    }

    const catalogsToSave = catalogs !== undefined ? catalogs : existing.catalogs;

    const config = await saveUserConfig({
      userId,
      tmdbApiKey: tmdbApiKey || existing.tmdbApiKey,
      catalogs: catalogsToSave,
      preferences: preferences !== undefined ? preferences : existing.preferences,
    });

    log.info('Config updated', { userId, catalogCount: config.catalogs?.length || 0 });

    const baseUrl = getBaseUrl(req);
    const host = baseUrl.replace(/^https?:\/\//, '');
    res.json({
      userId: config.userId,
      catalogs: config.catalogs,
      preferences: config.preferences,
      installUrl: `stremio://${host}/${userId}/manifest.json`,
      configureUrl: `${baseUrl}/configure/${userId}`,
    });
  } catch (error) {
    log.error('PUT /config/:userId error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * Delete a catalog
 */
router.delete('/config/:userId/catalog/:catalogId', async (req, res) => {
  try {
    const { userId, catalogId } = req.params;
    
    // Validate input formats
    if (!isValidUserId(userId)) {
      return res.status(400).json({ error: 'Invalid user ID format' });
    }
    if (!isValidCatalogId(catalogId)) {
      return res.status(400).json({ error: 'Invalid catalog ID format' });
    }
    
    const config = await getUserConfig(userId);
    if (!config) {
      return res.status(404).json({ error: 'Configuration not found' });
    }

    config.catalogs = config.catalogs.filter(c => 
      c._id?.toString() !== catalogId && c.id !== catalogId
    );
    
    await saveUserConfig(config);
    res.json({ success: true, catalogs: config.catalogs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get all configurations for a given TMDB API key
 */
router.get('/configs', async (req, res) => {
  try {
    // Prevent caching
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    
    const { apiKey } = req.query;
    
    if (!apiKey) {
      return res.status(400).json({ error: 'API key required' });
    }
    
    // Validate API key format
    if (!isValidApiKeyFormat(apiKey)) {
      return res.status(400).json({ error: 'Invalid API key format' });
    }
    
    log.debug('Get configs by API key request');
    
    let configs = [];
    
    if (isConnected()) {
      try {
        // Find all configs with this API key
        configs = await UserConfig.find({ tmdbApiKey: apiKey }).lean();
        log.info('Found configs in MongoDB', { count: configs.length, dbName: UserConfig.db?.name || 'unknown' });
      } catch (err) {
        log.error('MongoDB error finding configs', { error: err.message });
        throw err;
      }
    } else {
      log.warn('MongoDB not connected, using memory store');
      // Search in memory store
      for (const [userId, config] of memoryStore.entries()) {
        if (config.tmdbApiKey === apiKey) {
          configs.push(config);
        }
      }
    }
    
    // Return simplified config list (don't expose API key)
    const response = configs.map(config => ({
      userId: config.userId,
      catalogCount: config.catalogs?.length || 0,
      catalogs: (config.catalogs || []).map(c => ({
        name: c.name,
        type: c.type,
      })),
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    }));
    
    res.json(response);
  } catch (error) {
    log.error('GET /configs error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * Delete entire user configuration
 */
router.delete('/config/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { apiKey } = req.query;
    
    // Validate userId format
    if (!isValidUserId(userId)) {
      return res.status(400).json({ error: 'Invalid user ID format' });
    }
    
    log.info('Delete config request', { userId, hasApiKey: !!apiKey });
    
    if (isConnected()) {
      // Try to find the config first
      let config = await UserConfig.findOne({ userId }).lean();
      
      // If not found by userId but we have an API key, try to find by both
      if (!config && apiKey) {
        config = await UserConfig.findOne({ userId, tmdbApiKey: apiKey }).lean();
      }
      
      if (!config) {
        // Last resort: if we have an API key, try to delete directly
        // This handles cases where the config exists but findOne fails
        if (apiKey) {
          const deleteResult = await UserConfig.deleteOne({ userId, tmdbApiKey: apiKey });
          if (deleteResult.deletedCount > 0) {
            log.info('Config deleted from MongoDB (direct delete)', { userId });
            return res.json({ success: true, message: 'Configuration deleted' });
          }
        }
        return res.status(404).json({ error: 'Configuration not found' });
      }
      
      // Verify the requester owns this config (API key must match)
      if (apiKey && config.tmdbApiKey !== apiKey) {
        return res.status(403).json({ error: 'Not authorized to delete this configuration' });
      }
      
      await UserConfig.deleteOne({ userId });
      log.info('Config deleted from MongoDB', { userId });
    } else {
      const config = memoryStore.get(userId);
      if (!config) {
        return res.status(404).json({ error: 'Configuration not found' });
      }
      
      // Verify the requester owns this config
      if (apiKey && config.tmdbApiKey !== apiKey) {
        return res.status(403).json({ error: 'Not authorized to delete this configuration' });
      }
      
      memoryStore.delete(userId);
      log.info('Config deleted from memory store', { userId });
    }
    
    res.json({ success: true, message: 'Configuration deleted' });
  } catch (error) {
    log.error('DELETE /config/:userId error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * Debug endpoint - get raw MongoDB document (for debugging)
 * NOTE: This endpoint should be disabled or protected in production
 */
router.get('/debug/config/:userId', async (req, res) => {
  // Only allow in development mode
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }
  
  try {
    const { userId } = req.params;
    log.debug('Debug config request', { userId });
    
    if (!isConnected()) {
      return res.json({ 
        error: 'MongoDB not connected',
        memoryConfig: memoryStore.get(userId) || null 
      });
    }
    
    // Get raw document from MongoDB
    const rawDoc = await UserConfig.findOne({ userId }).lean();
    
    res.json({
      dbConnected: true,
      rawDocument: rawDoc,
      catalogCount: rawDoc?.catalogs?.length || 0,
      catalogs: rawDoc?.catalogs?.map(c => ({
        _id: c._id,
        name: c.name,
        type: c.type,
        enabled: c.enabled,
        listType: c.filters?.listType,
      })),
    });
  } catch (error) {
    log.error('Debug endpoint error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

export { router as apiRouter, getUserConfig, saveUserConfig };
