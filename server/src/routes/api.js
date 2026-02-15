import { Router } from 'express';
import { nanoid } from 'nanoid';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  getUserConfig,
  saveUserConfig,
  getConfigsByApiKey,
  deleteUserConfig,
  getApiKeyFromConfig,
  getPublicStats,
} from '../services/configService.js';
import * as tmdb from '../services/tmdb/index.js';
import * as imdb from '../services/imdb/index.ts';
import { getBaseUrl, shuffleArray } from '../utils/helpers.js';
import { resolveDynamicDatePreset } from '../utils/dateHelpers.js';
import { createLogger } from '../utils/logger.ts';
import { apiRateLimit, strictRateLimit } from '../utils/rateLimit.js';
import {
  isValidUserId,
  isValidApiKeyFormat,
  sanitizeFilters,
  sanitizeImdbFilters,
  sanitizePage,
  isValidContentType,
} from '../utils/validation.ts';
import { sendError, ErrorCodes } from '../utils/AppError.ts';
import {
  requireAuth,
  optionalAuth,
  requireConfigOwnership,
  computeApiKeyId,
} from '../utils/authMiddleware.js';
import { config } from '../config.ts';
import { getConfigCache } from '../infrastructure/configCache.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = Router();
const log = createLogger('api');

router.use(apiRateLimit);

let _buildMetadata = null;

function getBuildMetadata() {
  if (_buildMetadata) return _buildMetadata;

  const defaultMetadata = {
    version: process.env.npm_package_version || '2.6.7',
    tag: 'unknown',
    channel: 'unknown',
    commitHash: 'unknown',
    buildTime: null,
  };

  try {
    const metadataPath = join(__dirname, '../metadata.json');
    if (existsSync(metadataPath)) {
      const data = readFileSync(metadataPath, 'utf8');
      _buildMetadata = { ...defaultMetadata, ...JSON.parse(data) };
      return _buildMetadata;
    }
  } catch (error) {
    log.debug('Could not load build metadata', { error: error.message });
  }

  _buildMetadata = defaultMetadata;
  return _buildMetadata;
}

// Status endpoint - no auth required
router.get('/status', async (req, res) => {
  try {
    const metadata = getBuildMetadata();
    const stats = await getPublicStats().catch(() => ({ users: 0, catalogs: 0 }));

    // Determine database and cache type from environment
    const databaseType = config.database.databaseUrl
      ? 'postgres'
      : config.database.mongodbUri
        ? 'mongodb'
        : 'memory';
    const cacheType = config.cache.redisUrl ? 'redis' : 'memory';

    res.json({
      ...metadata,
      uptime: Math.floor(process.uptime()),
      environment: config.nodeEnv,
      database: databaseType,
      cache: cacheType,
      imdbApi: imdb.isImdbApiEnabled(),
      stats: {
        users: stats.users || 0,
        catalogs: stats.catalogs || 0,
      },
    });
  } catch (error) {
    log.error('GET /status error', { error: error.message });
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, error.message);
  }
});

async function resolveApiKey(req, res, next) {
  if (req.apiKey) return next();

  try {
    const configs = await getConfigsByApiKey(null, req.apiKeyId);
    if (configs.length === 0) {
      return sendError(res, 401, ErrorCodes.UNAUTHORIZED, 'No configuration found');
    }
    req.apiKey = getApiKeyFromConfig(configs[0]);
    if (!req.apiKey) {
      return sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Configuration error');
    }
    next();
  } catch (error) {
    log.error('resolveApiKey error', { error: error.message });
    return sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to resolve API key');
  }
}

router.post('/validate-key', async (req, res) => {
  try {
    const { apiKey } = req.body;
    if (!apiKey) {
      return sendError(res, 400, ErrorCodes.VALIDATION_ERROR, 'API key required');
    }
    if (!isValidApiKeyFormat(apiKey)) {
      return res.json({ valid: false, error: 'Invalid API key format' });
    }
    const result = await tmdb.validateApiKey(apiKey);
    res.json(result);
  } catch (error) {
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, error.message);
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
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, error.message);
  }
});

router.get('/reference-data', requireAuth, resolveApiKey, async (req, res) => {
  try {
    const { apiKey } = req;

    const [
      movieGenres,
      seriesGenres,
      languages,
      originalLanguages,
      countries,
      movieCertifications,
      seriesCertifications,
      watchRegions,
      tvNetworks,
    ] = await Promise.all([
      tmdb.getGenres(apiKey, 'movie'),
      tmdb.getGenres(apiKey, 'series'),
      tmdb.getLanguages(apiKey),
      tmdb.getOriginalLanguages(apiKey),
      tmdb.getCountries(apiKey),
      tmdb.getCertifications(apiKey, 'movie'),
      tmdb.getCertifications(apiKey, 'series'),
      tmdb.getWatchRegions(apiKey),
      tmdb.getNetworks(apiKey, '').catch(() => []),
    ]);

    const imdbEnabled = imdb.isImdbApiEnabled();
    let imdbData = null;
    if (imdbEnabled) {
      const presets = imdb.getPresetCatalogs();
      imdbData = {
        enabled: true,
        genres: await imdb.getGenres(),
        keywords: imdb.getKeywords(),
        awards: [...imdb.IMDB_AWARDS],
        sortOptions: imdb.getSortOptions(),
        titleTypes: imdb.getTitleTypeOptions(),
        presetCatalogs: [
          ...presets.movie.map((p) => ({ ...p, type: 'movie' })),
          ...presets.series.map((p) => ({ ...p, type: 'series' })),
        ],
      };
    }

    const data = {
      genres: { movie: movieGenres, series: seriesGenres },
      languages,
      originalLanguages,
      countries,
      sortOptions: tmdb.SORT_OPTIONS,
      listTypes: tmdb.LIST_TYPES,
      presetCatalogs: tmdb.PRESET_CATALOGS,
      releaseTypes: tmdb.RELEASE_TYPES,
      tvStatuses: tmdb.TV_STATUSES,
      tvTypes: tmdb.TV_TYPES,
      monetizationTypes: tmdb.MONETIZATION_TYPES,
      certifications: { movie: movieCertifications, series: seriesCertifications },
      watchRegions,
      tvNetworks: (tmdb.TV_NETWORKS || []).map((n) => ({
        id: n.id,
        name: n.name,
        logo: n.logo || n.logoPath || null,
      })),
      imdb: imdbData,
    };

    res.set('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400');
    res.json(data);
  } catch (error) {
    log.error('GET /reference-data error', { error: error.message });
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, error.message);
  }
});

router.get('/genres/:type', requireAuth, resolveApiKey, async (req, res) => {
  try {
    const { type } = req.params;
    const genres = await tmdb.getGenres(req.apiKey, type);
    res.json(genres);
  } catch (error) {
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, error.message);
  }
});

router.get('/languages', requireAuth, resolveApiKey, async (req, res) => {
  try {
    const languages = await tmdb.getLanguages(req.apiKey);
    res.json(languages);
  } catch (error) {
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, error.message);
  }
});

router.get('/original-languages', requireAuth, resolveApiKey, async (req, res) => {
  try {
    const languages = await tmdb.getOriginalLanguages(req.apiKey);
    res.json(languages);
  } catch (error) {
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, error.message);
  }
});

router.get('/countries', requireAuth, resolveApiKey, async (req, res) => {
  try {
    const countries = await tmdb.getCountries(req.apiKey);
    res.json(countries);
  } catch (error) {
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, error.message);
  }
});

router.get('/certifications/:type', requireAuth, resolveApiKey, async (req, res) => {
  try {
    const { type } = req.params;
    const certifications = await tmdb.getCertifications(req.apiKey, type);
    res.json(certifications);
  } catch (error) {
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, error.message);
  }
});

router.get('/watch-providers/:type', requireAuth, resolveApiKey, async (req, res) => {
  try {
    const { type } = req.params;
    const { region } = req.query;
    const providers = await tmdb.getWatchProviders(req.apiKey, type, region || 'US');
    res.json(providers);
  } catch (error) {
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, error.message);
  }
});

router.get('/watch-regions', requireAuth, resolveApiKey, async (req, res) => {
  try {
    const regions = await tmdb.getWatchRegions(req.apiKey);
    res.json(regions);
  } catch (error) {
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, error.message);
  }
});

router.get('/search/person', requireAuth, resolveApiKey, async (req, res) => {
  try {
    const { query } = req.query;
    if (!query) {
      return sendError(res, 400, ErrorCodes.VALIDATION_ERROR, 'Query required');
    }
    const results = await tmdb.searchPerson(req.apiKey, query);
    res.json(results);
  } catch (error) {
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, error.message);
  }
});

router.get('/search/company', requireAuth, resolveApiKey, async (req, res) => {
  try {
    const { query } = req.query;
    if (!query) {
      return sendError(res, 400, ErrorCodes.VALIDATION_ERROR, 'Query required');
    }
    const results = await tmdb.searchCompany(req.apiKey, query);
    res.json(results);
  } catch (error) {
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, error.message);
  }
});

router.get('/search/keyword', requireAuth, resolveApiKey, async (req, res) => {
  try {
    const { query } = req.query;
    if (!query) {
      return sendError(res, 400, ErrorCodes.VALIDATION_ERROR, 'Query required');
    }
    const results = await tmdb.searchKeyword(req.apiKey, query);
    res.json(results);
  } catch (error) {
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, error.message);
  }
});

router.get('/person/:id', requireAuth, resolveApiKey, async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return sendError(res, 400, ErrorCodes.VALIDATION_ERROR, 'ID required');
    const person = await tmdb.getPersonById(req.apiKey, id);
    if (!person) return sendError(res, 404, ErrorCodes.NOT_FOUND, 'Not found');
    res.json({ id: String(person.id), name: person.name });
  } catch (err) {
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, err.message);
  }
});

router.get('/company/:id', requireAuth, resolveApiKey, async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return sendError(res, 400, ErrorCodes.VALIDATION_ERROR, 'ID required');
    const company = await tmdb.getCompanyById(req.apiKey, id);
    if (!company) return sendError(res, 404, ErrorCodes.NOT_FOUND, 'Not found');
    res.json({ id: String(company.id), name: company.name });
  } catch (err) {
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, err.message);
  }
});

router.get('/keyword/:id', requireAuth, resolveApiKey, async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return sendError(res, 400, ErrorCodes.VALIDATION_ERROR, 'ID required');
    const keyword = await tmdb.getKeywordById(req.apiKey, id);
    if (!keyword) return sendError(res, 404, ErrorCodes.NOT_FOUND, 'Not found');
    res.json({ id: String(keyword.id), name: keyword.name });
  } catch (err) {
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, err.message);
  }
});

router.get('/network/:id', requireAuth, resolveApiKey, async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return sendError(res, 400, ErrorCodes.VALIDATION_ERROR, 'ID required');
    const network = await tmdb.getNetworkById(req.apiKey, id);
    if (!network) return sendError(res, 404, ErrorCodes.NOT_FOUND, 'Not found');
    res.json({ id: String(network.id), name: network.name, logo: network.logoPath });
  } catch (err) {
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, err.message);
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

router.post('/imdb/preview', requireAuth, async (req, res) => {
  try {
    if (!imdb.isImdbApiEnabled()) {
      return sendError(res, 503, ErrorCodes.INTERNAL_ERROR, 'IMDb API not enabled');
    }

    const { type, filters: rawFilters } = req.body;
    if (!type || !isValidContentType(type)) {
      return sendError(res, 400, ErrorCodes.VALIDATION_ERROR, 'Invalid content type');
    }

    const filters = sanitizeImdbFilters(rawFilters);
    const listType = filters.listType || 'discover';
    let titles = [];

    if (listType === 'top250') {
      const result = await imdb.getTopRanking(type);
      titles = (result.titles || []).slice(0, 20);
    } else if (listType === 'popular') {
      const result = await imdb.getPopular(type);
      titles = (result.titles || []).slice(0, 20);
    } else if (listType === 'imdb_list' && filters.imdbListId) {
      const result = await imdb.getList(filters.imdbListId, 0);
      titles = (result.titles || []).slice(0, 20);
    } else {
      const searchParams = {
        types: filters.types,
        genres: filters.genres,
        sortBy: filters.sortBy || 'POPULARITY',
        sortOrder: filters.sortOrder || 'ASC',
        imdbRatingMin: filters.imdbRatingMin,
        totalVotesMin: filters.totalVotesMin,
        releaseDateStart: filters.releaseDateStart,
        releaseDateEnd: filters.releaseDateEnd,
        runtimeMin: filters.runtimeMin,
        runtimeMax: filters.runtimeMax,
        languages: filters.languages,
        countries: filters.countries,
        keywords: filters.keywords,
      };
      const result = await imdb.advancedSearch(searchParams, type, 0);
      titles = (result.titles || []).slice(0, 20);
    }

    const metas = titles.map((item) => imdb.imdbToStremioMeta(item, type)).filter(Boolean);

    res.json({
      metas,
      totalResults: titles.length,
      previewEmpty: metas.length === 0,
    });
  } catch (error) {
    log.error('POST /imdb/preview error', { error: error.message });
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, error.message);
  }
});

router.get('/imdb/search', requireAuth, async (req, res) => {
  try {
    if (!imdb.isImdbApiEnabled()) {
      return sendError(res, 503, ErrorCodes.INTERNAL_ERROR, 'IMDb API not enabled');
    }

    const { query, type } = req.query;
    if (!query) {
      return sendError(res, 400, ErrorCodes.VALIDATION_ERROR, 'Query required');
    }

    const imdbTypes =
      type === 'series'
        ? ['tvSeries', 'tvMiniSeries']
        : type === 'movie'
          ? ['movie', 'tvMovie']
          : undefined;
    const result = await imdb.search(String(query), imdbTypes, 20);
    const metas = (result.titles || [])
      .map((item) => imdb.imdbToStremioMeta(item, type || 'movie'))
      .filter(Boolean);

    res.json({ metas });
  } catch (error) {
    log.error('GET /imdb/search error', { error: error.message });
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, error.message);
  }
});

router.get('/imdb/list/:id/validate', requireAuth, async (req, res) => {
  try {
    if (!imdb.isImdbApiEnabled()) {
      return sendError(res, 503, ErrorCodes.INTERNAL_ERROR, 'IMDb API not enabled');
    }

    const { id } = req.params;
    if (!id || !/^ls\d{1,15}$/.test(id)) {
      return sendError(res, 400, ErrorCodes.VALIDATION_ERROR, 'Invalid IMDb list ID format');
    }

    const result = await imdb.getList(id, 0);
    const titles = result.titles || [];

    res.json({
      valid: titles.length > 0,
      itemCount: titles.length,
      listId: id,
    });
  } catch (error) {
    log.error('GET /imdb/list/:id/validate error', { error: error.message });
    res.json({ valid: false, listId: req.params.id, error: error.message });
  }
});

router.post('/preview', requireAuth, resolveApiKey, async (req, res) => {
  try {
    const { type, filters: rawFilters, page: rawPage = 1 } = req.body;
    const { apiKey } = req;

    if (!type || !isValidContentType(type)) {
      return sendError(res, 400, ErrorCodes.VALIDATION_ERROR, 'Invalid content type');
    }

    const filters = sanitizeFilters(rawFilters);
    const page = sanitizePage(rawPage);

    const resolvedFilters = resolveDynamicDatePreset(filters, type);

    let results;

    const listType = resolvedFilters?.listType;
    const randomize = resolvedFilters?.randomize || resolvedFilters?.sortBy === 'random';

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

    let genreMap = null;
    const displayLanguage = resolvedFilters?.displayLanguage;

    if (results?.results?.length > 0 && displayLanguage && displayLanguage !== 'en') {
      try {
        const localizedGenres = await tmdb.getGenres(apiKey, type, displayLanguage);
        if (Array.isArray(localizedGenres)) {
          genreMap = {};
          localizedGenres.forEach((g) => {
            genreMap[String(g.id)] = g.name;
          });
        }
      } catch (err) {
        log.warn('Failed to fetch localized genres for preview', {
          displayLanguage,
          error: err.message,
        });
      }
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
      return tmdb.toStremioMeta(item, type, null, null, genreMap);
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
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, error.message);
  }
});

router.get('/stats', async (req, res) => {
  try {
    const stats = await getPublicStats();
    res.json({
      ...stats,
      addonVariant: config.addon.variant,
    });
  } catch (error) {
    log.error('GET /stats error', { error: error.message });
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, error.message);
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
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, error.message);
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

    log.debug('Returning config', {
      userId: config.userId,
      catalogCount: response.catalogs.length,
    });
    res.json(response);
  } catch (error) {
    log.error('GET /config/:userId error', { error: error.message });
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, error.message);
  }
});

router.put(
  '/config/:userId',
  requireAuth,
  requireConfigOwnership,
  strictRateLimit,
  async (req, res) => {
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

      try {
        getConfigCache().invalidate(userId);
      } catch {
        /* non-critical */
      }

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
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, error.message);
    }
  }
);

router.delete(
  '/config/:userId',
  requireAuth,
  requireConfigOwnership,
  strictRateLimit,
  async (req, res) => {
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
        return sendError(res, 404, ErrorCodes.NOT_FOUND, error.message);
      }
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, error.message);
    }
  }
);

export { router as apiRouter };
