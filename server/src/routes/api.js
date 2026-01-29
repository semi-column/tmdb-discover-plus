import { Router } from 'express';
import { nanoid } from 'nanoid';
import {
  getUserConfig,
  saveUserConfig,
  getConfigsByApiKey,
  deleteUserConfig,
  getApiKeyFromConfig,
  getPublicStats,
} from '../services/configService.js';
import * as tmdb from '../services/tmdb.js';
import { getBaseUrl, shuffleArray } from '../utils/helpers.js';
import { resolveDynamicDatePreset } from '../utils/dateHelpers.js';
import { createLogger } from '../utils/logger.js';
import { apiRateLimit, strictRateLimit } from '../utils/rateLimit.js';
import { isValidUserId, isValidApiKeyFormat } from '../utils/validation.js';
import {
  requireAuth,
  optionalAuth,
  requireConfigOwnership,
  computeApiKeyId,
} from '../utils/authMiddleware.js';

const router = Router();
const log = createLogger('api');

router.use(apiRateLimit);

async function resolveApiKey(req, res, next) {
  if (req.apiKey) return next();

  try {
    const configs = await getConfigsByApiKey(null, req.apiKeyId);
    if (configs.length === 0) {
      return res.status(401).json({ error: 'No configuration found' });
    }
    req.apiKey = getApiKeyFromConfig(configs[0]);
    if (!req.apiKey) {
      return res.status(500).json({ error: 'Configuration error' });
    }
    next();
  } catch (error) {
    log.error('resolveApiKey error', { error: error.message });
    return res.status(500).json({ error: 'Failed to resolve API key' });
  }
}

router.post('/validate-key', async (req, res) => {
  try {
    const { apiKey } = req.body;
    if (!apiKey) {
      return res.status(400).json({ error: 'API key required' });
    }
    if (!isValidApiKeyFormat(apiKey)) {
      return res.json({ valid: false, error: 'Invalid API key format' });
    }
    const result = await tmdb.validateApiKey(apiKey);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/configs', requireAuth, resolveApiKey, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    const configs = await getConfigsByApiKey(req.apiKey);
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

router.get('/genres/:type', requireAuth, resolveApiKey, async (req, res) => {
  try {
    const { type } = req.params;
    const genres = await tmdb.getGenres(req.apiKey, type);
    res.json(genres);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/languages', requireAuth, resolveApiKey, async (req, res) => {
  try {
    const languages = await tmdb.getLanguages(req.apiKey);
    res.json(languages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/countries', requireAuth, resolveApiKey, async (req, res) => {
  try {
    const countries = await tmdb.getCountries(req.apiKey);
    res.json(countries);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/certifications/:type', requireAuth, resolveApiKey, async (req, res) => {
  try {
    const { type } = req.params;
    const certifications = await tmdb.getCertifications(req.apiKey, type);
    res.json(certifications);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/watch-providers/:type', requireAuth, resolveApiKey, async (req, res) => {
  try {
    const { type } = req.params;
    const { region } = req.query;
    const providers = await tmdb.getWatchProviders(req.apiKey, type, region || 'US');
    res.json(providers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/watch-regions', requireAuth, resolveApiKey, async (req, res) => {
  try {
    const regions = await tmdb.getWatchRegions(req.apiKey);
    res.json(regions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/search/person', requireAuth, resolveApiKey, async (req, res) => {
  try {
    const { query } = req.query;
    if (!query) {
      return res.status(400).json({ error: 'Query required' });
    }
    const results = await tmdb.searchPerson(req.apiKey, query);
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/search/company', requireAuth, resolveApiKey, async (req, res) => {
  try {
    const { query } = req.query;
    if (!query) {
      return res.status(400).json({ error: 'Query required' });
    }
    const results = await tmdb.searchCompany(req.apiKey, query);
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/search/keyword', requireAuth, resolveApiKey, async (req, res) => {
  try {
    const { query } = req.query;
    if (!query) {
      return res.status(400).json({ error: 'Query required' });
    }
    const results = await tmdb.searchKeyword(req.apiKey, query);
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/person/:id', requireAuth, resolveApiKey, async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'ID required' });
    const person = await tmdb.getPersonById(req.apiKey, id);
    if (!person) return res.status(404).json({ error: 'Not found' });
    res.json({ id: String(person.id), name: person.name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/company/:id', requireAuth, resolveApiKey, async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'ID required' });
    const company = await tmdb.getCompanyById(req.apiKey, id);
    if (!company) return res.status(404).json({ error: 'Not found' });
    res.json({ id: String(company.id), name: company.name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/keyword/:id', requireAuth, resolveApiKey, async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'ID required' });
    const keyword = await tmdb.getKeywordById(req.apiKey, id);
    if (!keyword) return res.status(404).json({ error: 'Not found' });
    res.json({ id: String(keyword.id), name: keyword.name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/network/:id', requireAuth, resolveApiKey, async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'ID required' });
    const network = await tmdb.getNetworkById(req.apiKey, id);
    if (!network) return res.status(404).json({ error: 'Not found' });
    res.json({ id: String(network.id), name: network.name, logo: network.logoPath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/sort-options', (req, res) => {
  const { type } = req.query;
  if (type && tmdb.SORT_OPTIONS[type]) {
    res.json(tmdb.SORT_OPTIONS[type]);
  } else {
    res.json(tmdb.SORT_OPTIONS);
  }
});

router.get('/list-types', (req, res) => {
  const { type } = req.query;
  if (type && tmdb.LIST_TYPES[type]) {
    res.json(tmdb.LIST_TYPES[type]);
  } else {
    res.json(tmdb.LIST_TYPES);
  }
});

router.get('/preset-catalogs', (req, res) => {
  const { type } = req.query;
  if (type && tmdb.PRESET_CATALOGS[type]) {
    res.json(tmdb.PRESET_CATALOGS[type]);
  } else {
    res.json(tmdb.PRESET_CATALOGS);
  }
});

router.get('/release-types', (req, res) => {
  res.json(tmdb.RELEASE_TYPES);
});

router.get('/tv-statuses', (req, res) => {
  res.json(tmdb.TV_STATUSES);
});

router.get('/tv-types', (req, res) => {
  res.json(tmdb.TV_TYPES);
});

router.get('/monetization-types', (req, res) => {
  res.json(tmdb.MONETIZATION_TYPES);
});

router.get('/tv-networks', optionalAuth, async (req, res) => {
  const { query } = req.query;

  const normalizeNetwork = (n) => ({
    id: n.id,
    name: n.name,
    logo: n.logo || n.logoPath || null,
  });

  const curated = (tmdb.TV_NETWORKS || []).map(normalizeNetwork);
  if (!query) {
    return res.json(curated);
  }

  const searchLower = String(query).toLowerCase();
  const curatedMatches = curated.filter((n) => n.name.toLowerCase().includes(searchLower));

  let apiKey = null;
  if (req.apiKeyId) {
    try {
      const configs = await getConfigsByApiKey(null, req.apiKeyId);
      if (configs.length > 0) {
        apiKey = getApiKeyFromConfig(configs[0]);
      }
    } catch (e) {
      void e;
    }
  }

  if (apiKey) {
    try {
      const remote = await tmdb.getNetworks(apiKey, String(query));
      const remoteNormalized = (remote || []).map(normalizeNetwork);
      const byId = new Map();
      [...curatedMatches, ...remoteNormalized].forEach((n) => {
        if (!n || !n.id) return;
        if (!byId.has(n.id)) byId.set(n.id, n);
      });
      return res.json(Array.from(byId.values()));
    } catch {
      return res.json(curatedMatches);
    }
  }

  return res.json(curatedMatches);
});

router.post('/preview', requireAuth, resolveApiKey, async (req, res) => {
  try {
    const { type, filters, page = 1 } = req.body;
    const { apiKey } = req;

    const resolvedFilters = resolveDynamicDatePreset(filters, type);

    let results;

    const listType = resolvedFilters?.listType;
    const randomize = resolvedFilters?.randomize || (resolvedFilters?.sortBy === 'random');

    if (listType && listType !== 'discover') {
      results = await tmdb.fetchSpecialList(apiKey, listType, type, {
        page,
        displayLanguage: resolvedFilters?.displayLanguage,
        language: resolvedFilters?.language,
        region: resolvedFilters?.originCountry,
        randomize,
      });
    } else {
      results = await tmdb.discover(apiKey, {
        type,
        ...resolvedFilters,
        page,
        randomize,
      });
    }

    const normalizeCsvOrArray = (val) => {
      if (!val) return [];
      if (Array.isArray(val)) return val.map(String).filter(Boolean);
      return String(val)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    };



    const metas = results.results.slice(0, 20).map((item) => {
      return tmdb.toStremioMeta(item, type, null);
    });

    const filteredMetas = metas.filter(Boolean);

    log.debug('Preview results', {
      fetchedCount: results.results?.length || 0,
      filteredCount: filteredMetas.length,
    });

    res.json({
      metas: filteredMetas,
      totalResults: results.total_results,
      totalPages: results.total_pages,
      page: results.page,
      previewEmpty: filteredMetas.length === 0,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/stats', async (req, res) => {
  try {
    const stats = await getPublicStats();
    res.json(stats);
  } catch (error) {
    log.error('GET /stats error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

router.post('/config', requireAuth, resolveApiKey, strictRateLimit, async (req, res) => {
  try {
    const { catalogs, preferences, configName } = req.body;
    const { apiKey } = req;

    log.info('Create config request', { catalogCount: catalogs?.length || 0 });

    const newUserId = nanoid(10);

    const config = await saveUserConfig({
      userId: newUserId,
      tmdbApiKey: apiKey,
      configName: configName || '',
      catalogs: catalogs || [],
      preferences: preferences || {},
    });

    const baseUrl = getBaseUrl(req);
    const host = baseUrl.replace(/^https?:\/\//, '');
    const manifestUrl = `${baseUrl}/${newUserId}/manifest.json`;

    const response = {
      userId: newUserId,
      configName: config.configName || '',
      catalogs: config.catalogs || [],
      preferences: config.preferences || {},
      installUrl: manifestUrl,
      stremioUrl: `stremio://${host}/${newUserId}/manifest.json`,
      configureUrl: `${baseUrl}/configure/${newUserId}`,
    };

    log.info('Config created', { userId: newUserId, catalogCount: response.catalogs.length });
    res.json(response);
  } catch (error) {
    log.error('POST /config error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

router.get('/config/:userId', requireAuth, requireConfigOwnership, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    const { config } = req;

    const response = {
      userId: config.userId,
      configName: config.configName || '',
      catalogs: config.catalogs || [],
      preferences: config.preferences || {},
      hasApiKey: !!config.tmdbApiKeyEncrypted,
    };

    log.debug('Returning config', { userId: config.userId, catalogCount: response.catalogs.length });
    res.json(response);
  } catch (error) {
    log.error('GET /config/:userId error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

router.put('/config/:userId', requireAuth, requireConfigOwnership, strictRateLimit, async (req, res) => {
  try {
    const { userId } = req.params;
    const { catalogs, preferences, configName } = req.body;
    const { apiKey } = req;

    log.info('Update config request', { userId, catalogCount: catalogs?.length || 0 });

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

router.delete('/config/:userId', requireAuth, requireConfigOwnership, strictRateLimit, async (req, res) => {
  try {
    const { userId } = req.params;
    const { apiKey } = req;

    log.info('Delete config request', { userId });

    const result = await deleteUserConfig(userId, apiKey);

    log.info('Config deleted', { userId });
    res.json(result);
  } catch (error) {
    log.error('DELETE /config/:userId error', { error: error.message });

    if (error.message.includes('not found') || error.message.includes('Access denied')) {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: error.message });
  }
});

export { router as apiRouter };
