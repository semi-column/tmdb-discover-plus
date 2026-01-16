import { Router } from 'express';
import { nanoid } from 'nanoid';
import {
  getUserConfig,
  saveUserConfig,
  getConfigsByApiKey,
  deleteUserConfig,
  getApiKeyFromConfig,
} from '../services/configService.js';
import * as tmdb from '../services/tmdb.js';
import { getBaseUrl, normalizeGenreName, parseIdArray } from '../utils/helpers.js';
import { resolveDynamicDatePreset } from '../utils/dateHelpers.js';
import { createLogger } from '../utils/logger.js';
import { apiRateLimit, strictRateLimit } from '../utils/rateLimit.js';
import { isValidUserId, isValidApiKeyFormat } from '../utils/validation.js';

import { shuffleArray } from '../utils/helpers.js';
import { requireAuth, optionalAuth } from '../utils/authMiddleware.js';

const router = Router();
const log = createLogger('api');

// Apply rate limiting to all frontend API endpoints.
router.use(apiRateLimit);

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
 * Get all configurations for a given API key
 */
router.get('/configs', requireAuth, async (req, res) => {
  try {
    const { apiKey } = req;
    const configs = await getConfigsByApiKey(apiKey);
    // Return array of configs with safe fields (no raw API key)
    const safeConfigs = configs.map((c) => ({
      userId: c.userId,
      configName: c.configName || '',
      catalogs: c.catalogs || [],
      preferences: c.preferences || {},
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }));
    res.json(safeConfigs);
  } catch (error) {
    log.error('GET /configs error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get genres list
 */
router.get('/genres/:type', requireAuth, async (req, res) => {
  try {
    const { type } = req.params;
    const { apiKey } = req;

    const genres = await tmdb.getGenres(apiKey, type);
    res.json(genres);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get available languages
 */
router.get('/languages', requireAuth, async (req, res) => {
  try {
    const { apiKey } = req;

    const languages = await tmdb.getLanguages(apiKey);
    res.json(languages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get available countries
 */
router.get('/countries', requireAuth, async (req, res) => {
  try {
    const { apiKey } = req;

    const countries = await tmdb.getCountries(apiKey);
    res.json(countries);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get certifications (age ratings)
 */
router.get('/certifications/:type', requireAuth, async (req, res) => {
  try {
    const { type } = req.params;
    const { apiKey } = req;

    const certifications = await tmdb.getCertifications(apiKey, type);
    res.json(certifications);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get watch providers for a region
 */
router.get('/watch-providers/:type', requireAuth, async (req, res) => {
  try {
    const { type } = req.params;
    const { region } = req.query;
    const { apiKey } = req;

    const providers = await tmdb.getWatchProviders(apiKey, type, region || 'US');
    res.json(providers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get available watch regions
 */
router.get('/watch-regions', requireAuth, async (req, res) => {
  try {
    const { apiKey } = req;

    const regions = await tmdb.getWatchRegions(apiKey);
    res.json(regions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Search for people (actors, directors)
 */
router.get('/search/person', requireAuth, async (req, res) => {
  try {
    const { query } = req.query;
    const { apiKey } = req;
    if (!query) {
      return res.status(400).json({ error: 'Query required' });
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
router.get('/search/company', requireAuth, async (req, res) => {
  try {
    const { query } = req.query;
    const { apiKey } = req;
    if (!query) {
      return res.status(400).json({ error: 'Query required' });
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
router.get('/search/keyword', requireAuth, async (req, res) => {
  try {
    const { query } = req.query;
    const { apiKey } = req;
    if (!query) {
      return res.status(400).json({ error: 'Query required' });
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
router.get('/person/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { apiKey } = req;
    if (!id) return res.status(400).json({ error: 'ID required' });
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
router.get('/company/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { apiKey } = req;
    if (!id) return res.status(400).json({ error: 'ID required' });
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
router.get('/keyword/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { apiKey } = req;
    if (!id) return res.status(400).json({ error: 'ID required' });
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
router.get('/tv-networks', optionalAuth, (req, res) => {
  const { query } = req.query;
  const apiKey = req.apiKey;

  const normalizeNetwork = (n) => ({
    id: n.id,
    name: n.name,
    // Keep logo field for curated list; remote search may return absolute logoPath
    logo: n.logo || n.logoPath || null,
  });

  const curated = (tmdb.TV_NETWORKS || []).map(normalizeNetwork);
  if (!query) {
    return res.json(curated);
  }

  const searchLower = String(query).toLowerCase();
  const curatedMatches = curated.filter((n) => n.name.toLowerCase().includes(searchLower));

  if (apiKey) {
    tmdb
      .getNetworks(apiKey, String(query))
      .then((remote) => {
        const remoteNormalized = (remote || []).map(normalizeNetwork);
        const byId = new Map();
        [...curatedMatches, ...remoteNormalized].forEach((n) => {
          if (!n || !n.id) return;
          if (!byId.has(n.id)) byId.set(n.id, n);
        });
        res.json(Array.from(byId.values()));
      })
      .catch(() => {
        res.json(curatedMatches);
      });
    return;
  }

  return res.json(curatedMatches);
});

/**
 * Preview catalog with filters
 */
router.post('/preview', requireAuth, async (req, res) => {
  try {
    const { type, filters, page = 1 } = req.body;
    const { apiKey } = req;

    const resolvedFilters = resolveDynamicDatePreset(filters, type);

    let results;

    const listType = resolvedFilters?.listType;
    const isRandomSort = resolvedFilters?.sortBy === 'random';

    if (listType && listType !== 'discover') {
      results = await tmdb.fetchSpecialList(apiKey, listType, type, {
        page,
        displayLanguage: resolvedFilters?.displayLanguage,
        language: resolvedFilters?.language,
        region: resolvedFilters?.originCountry,
      });
    } else if (isRandomSort) {
      const discoverResult = await tmdb.discover(apiKey, {
        type,
        ...resolvedFilters,
        sortBy: 'popularity.desc',
        page: 1,
      });
      const maxPage = Math.min(discoverResult.total_pages || 1, 500);
      const randomPage = Math.floor(Math.random() * maxPage) + 1;
      results = await tmdb.discover(apiKey, {
        type,
        ...resolvedFilters,
        sortBy: 'popularity.desc',
        page: randomPage,
      });
      // Shuffle the results
      results.results = shuffleArray(results.results || []);
    } else {
      // Use discover with all filters
      results = await tmdb.discover(apiKey, {
        type,
        ...resolvedFilters,
        page,
      });
    }

    // If excludeGenres provided, normalize it so we can post-filter results
    const normalizeCsvOrArray = (val) => {
      if (!val) return [];
      if (Array.isArray(val)) return val.map(String).filter(Boolean);
      return String(val)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    };

    // Post-filter: ensure excluded genres always remove items even if included genres matched
    if (filters?.excludeGenres && results?.results && Array.isArray(results.results)) {
      try {
        const excludeGenres = normalizeCsvOrArray(filters.excludeGenres).map(String);
        if (excludeGenres.length > 0) {
          const excludeSet = new Set(excludeGenres);
          results.results = results.results.filter((item) => {
            const ids = (item.genre_ids || (item.genres && item.genres.map((g) => g.id)) || []).map(
              String
            );
            // keep item only if it does NOT contain any excluded genre
            return !ids.some((id) => excludeSet.has(id));
          });
          // Note: We don't update total_results here because we want to show
          // the actual TMDB total, not the filtered page count
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

    log.debug('Preview results', {
      fetchedCount: results.results?.length || 0,
      filteredCount: filteredMetas.length,
    });

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
 * Supports session-based auth (apiKey from session) or legacy (apiKey in body)
 */
router.post('/config', optionalAuth, strictRateLimit, async (req, res) => {
  try {
    const { userId, tmdbApiKey, catalogs, preferences, configName } = req.body;

    // Use API key from session (if authenticated) or from body (legacy)
    const apiKey = req.apiKey || tmdbApiKey;

    log.info('Create/update config request', {
      userId,
      catalogCount: catalogs?.length || 0,
      hasSessionKey: !!req.apiKey,
    });

    if (!apiKey) {
      return res.status(400).json({ error: 'TMDB API key required' });
    }

    // Validate API key format before making external request
    if (!isValidApiKeyFormat(apiKey)) {
      return res.status(400).json({ error: 'Invalid TMDB API key format' });
    }

    // Validate userId format if provided
    if (userId && !isValidUserId(userId)) {
      return res.status(400).json({ error: 'Invalid user ID format' });
    }

    // Skip TMDB validation if using session key (already validated during login)
    if (!req.apiKey) {
      // Validate API key with TMDB
      const validation = await tmdb.validateApiKey(apiKey);
      if (!validation.valid) {
        return res.status(400).json({ error: 'Invalid TMDB API key' });
      }
    }

    // Generate new userId if not provided
    const id = userId || nanoid(10);

    const config = await saveUserConfig({
      userId: id,
      tmdbApiKey: apiKey,
      configName: configName || '',
      catalogs: catalogs || [],
      preferences: preferences || {},
    });

    const baseUrl = getBaseUrl(req);
    const host = baseUrl.replace(/^https?:\/\//, '');
    const manifestUrl = `${baseUrl}/${id}/manifest.json`;

    const response = {
      userId: id,
      configName: config.configName || '',
      catalogs: config.catalogs || [],
      preferences: config.preferences || {},
      // Browser-friendly URL to the addon manifest
      installUrl: manifestUrl,
      // Optional deep-link for Stremio desktop app
      stremioUrl: `stremio://${host}/${id}/manifest.json`,
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
 * Update existing user configuration
 * Supports session-based auth (apiKey from session) or legacy (apiKey in body)
 */
router.put('/config/:userId', optionalAuth, strictRateLimit, async (req, res) => {
  try {
    const { userId } = req.params;
    const { tmdbApiKey, catalogs, preferences, configName } = req.body;

    // Use API key from session (if authenticated) or from body (legacy)
    const apiKey = req.apiKey || tmdbApiKey;

    log.info('Update config request', {
      userId,
      catalogCount: catalogs?.length || 0,
      hasSessionKey: !!req.apiKey,
    });

    // Validate userId format
    if (!isValidUserId(userId)) {
      return res.status(400).json({ error: 'Invalid user ID format' });
    }

    if (!apiKey) {
      return res.status(400).json({ error: 'TMDB API key required' });
    }

    // Validate API key format
    if (!isValidApiKeyFormat(apiKey)) {
      return res.status(400).json({ error: 'Invalid TMDB API key format' });
    }

    const config = await saveUserConfig({
      userId,
      tmdbApiKey: apiKey,
      configName: configName || '',
      catalogs: catalogs || [],
      preferences: preferences || {},
    });

    const baseUrl = getBaseUrl(req);
    const host = baseUrl.replace(/^https?:\/\//, '');
    const manifestUrl = `${baseUrl}/${userId}/manifest.json`;

    const response = {
      userId,
      configName: config.configName || '',
      catalogs: config.catalogs || [],
      preferences: config.preferences || {},
      installUrl: manifestUrl,
      stremioUrl: `stremio://${host}/${userId}/manifest.json`,
      configureUrl: `${baseUrl}/configure/${userId}`,
    };

    log.info('Config updated', { userId, catalogCount: response.catalogs.length });
    res.json(response);
  } catch (error) {
    log.error('PUT /config/:userId error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * Delete user configuration
 */
router.delete('/config/:userId', strictRateLimit, async (req, res) => {
  try {
    const { userId } = req.params;
    const { apiKey } = req.query;

    log.info('Delete config request', { userId });

    // Validate userId format
    if (!isValidUserId(userId)) {
      return res.status(400).json({ error: 'Invalid user ID format' });
    }

    // Require apiKey for authorization
    if (!apiKey) {
      return res.status(400).json({ error: 'API key required for deletion' });
    }

    if (!isValidApiKeyFormat(apiKey)) {
      return res.status(400).json({ error: 'Invalid API key format' });
    }

    const result = await deleteUserConfig(userId, apiKey);

    log.info('Config deleted', { userId });
    res.json(result);
  } catch (error) {
    log.error('DELETE /config/:userId error', { error: error.message });

    // Return appropriate status code based on error
    if (error.message.includes('not found') || error.message.includes('Access denied')) {
      return res.status(404).json({ error: error.message });
    }
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

    log.info('GET /config/:userId called', { userId, rawParams: req.params });

    // Validate userId format
    if (!isValidUserId(userId)) {
      log.warn('Invalid userId format', { userId });
      return res.status(400).json({ error: 'Invalid user ID format' });
    }

    const overrideApiKey = req.query?.apiKey || null;

    // Validate override API key format if provided
    if (overrideApiKey && !isValidApiKeyFormat(overrideApiKey)) {
      return res.status(400).json({ error: 'Invalid API key format' });
    }

    log.info('Calling getUserConfig', { userId });

    const config = await getUserConfig(userId, overrideApiKey);

    if (!config) {
      log.warn('Config not found after getUserConfig', { userId });
      return res.status(404).json({ error: 'Configuration not found' });
    }

    const response = {
      userId: config.userId,
      configName: config.configName || '',
      catalogs: config.catalogs || [],
      preferences: config.preferences || {},
      hasApiKey: !!(config.tmdbApiKey || config.tmdbApiKeyEncrypted),
    };

    log.debug('Returning config', { userId, catalogCount: response.catalogs.length });
    res.json(response);
  } catch (error) {
    log.error('GET /config/:userId error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

export { router as apiRouter };
