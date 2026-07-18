import { Router, type Request, type Response, type NextFunction } from 'express';
import type {
  ContentType,
  CatalogFilters,
  ArtworkOptions,
  PosterOptions,
  PosterServiceType,
} from '../types/index.ts';
import type { StremioMetaPreview } from '../types/stremio.ts';
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
  getTraktKeyFromConfig,
} from '../services/configService.ts';
import * as tmdb from '../services/tmdb/index.ts';
import * as imdb from '../services/imdb/index.ts';
import * as anilist from '../services/anilist/index.ts';
import * as mal from '../services/mal/index.ts';
import * as kitsu from '../services/kitsu/index.ts';
import * as simkl from '../services/simkl/index.ts';
import * as trakt from '../services/trakt/index.ts';
import { searchCities } from '../services/geo.ts';
import {
  getBaseUrl,
  shuffleArray,
  setNoCacheHeaders,
  logSwallowedError,
} from '../utils/helpers.ts';
import { TIMEOUTS } from '../constants.ts';
import { CACHE_TTLS } from '../cacheTtls.ts';
import { resolveDynamicDatePreset } from '../utils/dateHelpers.ts';
import { createLogger } from '../utils/logger.ts';
import { strictRateLimit } from '../utils/rateLimit.ts';
import {
  isValidUserId,
  isValidApiKeyFormat,
  sanitizeFilters,
  sanitizeImdbFilters,
  sanitizePage,
  isValidContentType,
  sanitizeString,
} from '../utils/validation.ts';
import { sendError, ErrorCodes, safeErrorMessage, AppError } from '../utils/AppError.ts';
import { decrypt, encrypt } from '../utils/encryption.ts';
import { requireAuth, optionalAuth, requireConfigOwnership } from '../utils/authMiddleware.ts';
import { computeApiKeyId, getSecurityMetrics } from '../utils/security.ts';
import { config } from '../config.ts';
import { getConfigCache } from '../infrastructure/configCache.ts';
import { getCache } from '../services/cache/index.ts';
import { buildCommonCertificateRatingsByCountry } from '../services/common/certificateRatings.ts';
import {
  validateTvdbApiKeyAuthorization,
  applyArtworkOverridesToMetaPreviews,
} from '../services/artworkService.ts';
import { validateArtworkProviderApiKey } from '../utils/artworkValidation.ts';
import { ADDON_VERSION } from '../version.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = Router();
const log = createLogger('api');

function getApiKey(req: Request): string {
  if (!req.apiKey) {
    throw new AppError(401, ErrorCodes.UNAUTHORIZED, 'Authentication required');
  }
  return req.apiKey;
}

function validateLimit(value: string | undefined, max: number, defaultValue: number): number {
  return Math.max(1, Math.min(max, parseInt(value as string) || defaultValue));
}

router.use((req, res, next) => {
  res.set('CDN-Cache-Control', 'no-store');
  res.set('Cloudflare-CDN-Cache-Control', 'no-store');
  next();
});

let _buildMetadata: Record<string, unknown> | null = null;

function getBuildMetadata(): Record<string, unknown> {
  if (_buildMetadata) return _buildMetadata;

  const defaultMetadata = {
    version: ADDON_VERSION,
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
      return _buildMetadata!;
    }
  } catch (error) {
    log.debug('Could not load build metadata', { error: (error as Error).message });
  }

  _buildMetadata = defaultMetadata;
  return _buildMetadata;
}

// Status endpoint - no auth required
router.get('/status', async (req, res) => {
  try {
    const metadata = getBuildMetadata();
    const stats = await getPublicStats().catch(() => ({ totalUsers: 0, totalCatalogs: 0 }));

    // Determine database and cache type from environment
    const databaseType = config.database.postgresUri
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
        users: stats.totalUsers || 0,
        catalogs: stats.totalCatalogs || 0,
      },
      security: getSecurityMetrics(),
    });
  } catch (error) {
    log.error('GET /status error', { error: (error as Error).message });
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, safeErrorMessage(error as Error));
  }
});

async function resolveApiKey(req: Request, res: Response, next: NextFunction) {
  if (req.apiKey) return next();

  try {
    const configs = await getConfigsByApiKey(null, req.apiKeyId);
    if (configs.length === 0) {
      return sendError(res, 401, ErrorCodes.UNAUTHORIZED, 'No configuration found');
    }
    req.apiKey = getApiKeyFromConfig(configs[0]) ?? undefined;
    if (!req.apiKey) {
      return sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Configuration error');
    }
    setPreviewLookupConfig(req, configs[0] || null);
    next();
  } catch (error) {
    log.error('resolveApiKey error', { error: (error as Error).message });
    return sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to resolve API key');
  }
}

router.post('/validate-key', strictRateLimit, async (req, res) => {
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
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, safeErrorMessage(error as Error));
  }
});

router.post('/validate-mal-key', requireAuth, strictRateLimit, async (req, res) => {
  try {
    const { clientId } = req.body;
    if (!clientId || typeof clientId !== 'string') {
      return res.json({ valid: false, error: 'MAL Client ID is required' });
    }
    if (!/^[a-f0-9]{32}$/i.test(clientId)) {
      return res.json({
        valid: false,
        error: 'Invalid MAL Client ID format (expected 32 hex characters)',
      });
    }
    // Test the key by making a simple API call
    const testUrl = 'https://api.myanimelist.net/v2/anime/ranking?ranking_type=all&limit=1';
    const response = await fetch(testUrl, {
      headers: { 'X-MAL-CLIENT-ID': clientId },
      signal: AbortSignal.timeout(10000),
    });
    if (response.ok) {
      res.json({ valid: true });
    } else if (response.status === 401 || response.status === 403) {
      res.json({ valid: false, error: 'Invalid MAL Client ID' });
    } else {
      res.json({ valid: false, error: `MAL API returned status ${response.status}` });
    }
  } catch (error) {
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, safeErrorMessage(error as Error));
  }
});

router.post('/validate-simkl-key', requireAuth, strictRateLimit, async (req, res) => {
  try {
    const { apiKey } = req.body;
    if (!apiKey || typeof apiKey !== 'string') {
      return res.json({ valid: false, error: 'Simkl API key is required' });
    }
    if (!/^[a-f0-9]{32,64}$/i.test(apiKey)) {
      return res.json({ valid: false, error: 'Invalid Simkl API key format' });
    }
    // Test the key by making a simple API call
    const testUrl = 'https://api.simkl.com/anime/genres';
    const response = await fetch(testUrl, {
      headers: { 'simkl-api-key': apiKey, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (response.ok) {
      res.json({ valid: true });
    } else if (response.status === 401 || response.status === 403) {
      res.json({ valid: false, error: 'Invalid Simkl API key' });
    } else {
      res.json({ valid: false, error: `Simkl API returned status ${response.status}` });
    }
  } catch (error) {
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, safeErrorMessage(error as Error));
  }
});

router.post('/validate-tvdb-key', requireAuth, strictRateLimit, async (req, res) => {
  try {
    const { apiKey } = req.body;

    const formatValidation = validateArtworkProviderApiKey('tvdb', apiKey, { required: true });
    if (!formatValidation.valid) {
      return res.json({
        valid: false,
        error: formatValidation.error || 'Invalid TVDB API key format',
      });
    }

    const result = await validateTvdbApiKeyAuthorization(formatValidation.normalizedKey);
    if (result.valid) {
      return res.json({ valid: true });
    }

    return res.json({
      valid: false,
      error: result.error || 'TVDB key validation failed',
      statusCode: result.statusCode,
      invalidKey: result.invalidKey,
    });
  } catch (error) {
    log.error('TVDB key validation error', { error: (error as Error).message });
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, safeErrorMessage(error as Error));
  }
});

router.post('/validate-trakt-key', requireAuth, strictRateLimit, async (req, res) => {
  try {
    const { clientId } = req.body;
    if (!clientId || typeof clientId !== 'string') {
      return res.json({ valid: false, error: 'Trakt Client ID is required' });
    }
    if (clientId.length < 10 || clientId.length > 128) {
      return res.json({ valid: false, error: 'Invalid Trakt Client ID format' });
    }
    // Validate by making a lightweight API call to Trakt
    const testUrl = 'https://api.trakt.tv/movies/trending?page=1&limit=1';
    try {
      const response = await fetch(testUrl, {
        headers: {
          'Content-Type': 'application/json',
          'trakt-api-version': '2',
          'trakt-api-key': clientId,
          'User-Agent': 'TMDB-Discover-Plus/2.9.2',
        },
        signal: AbortSignal.timeout(10000),
      });
      if (response.ok) {
        return res.json({ valid: true });
      } else if (response.status === 401 || response.status === 403) {
        return res.json({
          valid: false,
          error: 'Trakt rejected this Client ID. Please verify it is correct.',
        });
      }
      // For non-auth errors (429, 500, etc.), accept the key — it's likely valid
      // but Trakt is temporarily unavailable
      log.warn('Trakt validation returned non-auth error, accepting key', {
        status: response.status,
      });
      return res.json({ valid: true });
    } catch (fetchErr) {
      // Network error (DNS, proxy, timeout) — accept the key since we can't verify
      log.warn('Trakt validation network error, accepting key', {
        error: (fetchErr as Error).message,
      });
      return res.json({ valid: true });
    }
  } catch (error) {
    log.error('Trakt key validation error', { error: (error as Error).message });
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, safeErrorMessage(error as Error));
  }
});

router.post('/source-key', requireAuth, resolveApiKey, strictRateLimit, async (req, res) => {
  try {
    const { source, key } = req.body;
    if (!source || !key || typeof key !== 'string') {
      return sendError(res, 400, ErrorCodes.VALIDATION_ERROR, 'source and key are required');
    }
    if (source !== 'mal' && source !== 'simkl' && source !== 'trakt') {
      return sendError(res, 400, ErrorCodes.VALIDATION_ERROR, 'Invalid source');
    }

    const apiKey = getApiKey(req);
    const configs = await getConfigsByApiKey(apiKey);
    if (configs.length === 0) {
      return sendError(res, 404, ErrorCodes.NOT_FOUND, 'No configuration found');
    }

    const userConfig = configs[0];
    const encryptedKey = encrypt(sanitizeString(key, 128));
    if (!encryptedKey) {
      return sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Encryption failed');
    }

    const fieldMap: Record<string, string> = {
      mal: 'malClientIdEncrypted',
      simkl: 'simklApiKeyEncrypted',
      trakt: 'traktClientIdEncrypted',
    };
    const fieldName = fieldMap[source];
    const savedConfig = await saveUserConfig({
      ...userConfig,
      [fieldName]: encryptedKey,
      tmdbApiKey: apiKey,
    });

    log.info('Source key saved', { userId: userConfig.userId, source });
    res.json({ success: true });
  } catch (error) {
    log.error('POST /source-key error', { error: (error as Error).message });
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, safeErrorMessage(error as Error));
  }
});

router.get('/source-keys', requireAuth, resolveApiKey, async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    const configs = await getConfigsByApiKey(apiKey);
    if (configs.length === 0) {
      return res.json({ mal: false, simkl: false, trakt: false });
    }

    const userConfig = configs[0];
    res.json({
      mal: true, // Jikan API - no key needed
      simkl: !!userConfig.simklApiKeyEncrypted || !!config.simklApi.clientId,
      trakt: !!userConfig.traktClientIdEncrypted || !!config.traktApi.clientId,
    });
  } catch (error) {
    log.error('GET /source-keys error', { error: (error as Error).message });
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, safeErrorMessage(error as Error));
  }
});

router.get('/configs', requireAuth, resolveApiKey, async (req, res) => {
  try {
    setNoCacheHeaders(res);

    const configs = await getConfigsByApiKey(getApiKey(req));
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
    log.error('GET /configs error', { error: (error as Error).message });
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, safeErrorMessage(error as Error));
  }
});

router.get('/reference-data', requireAuth, resolveApiKey, async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    const configs = await getConfigsByApiKey(apiKey).catch(() => []);
    const userConfig = configs[0] || null;
    const traktClientId =
      config.traktApi.clientId ||
      (userConfig ? getTraktKeyFromConfig(userConfig) : null) ||
      undefined;
    const traktHasKey = !!config.traktApi.clientId || !!userConfig?.traktClientIdEncrypted;

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
      tmdb.getNetworks('').catch((err) => {
        logSwallowedError('api:reference-data-networks', err);
        return [];
      }),
    ]);

    const imdbEnabled = imdb.isImdbApiEnabled();
    const commonCertificateRatingsByCountry = buildCommonCertificateRatingsByCountry(
      movieCertifications,
      seriesCertifications
    );

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
        certificateRatings: commonCertificateRatingsByCountry,
        rankedLists: imdb.getRankedLists(),
        withDataOptions: imdb.getWithDataOptions(),
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
      certificateRatingsByCountry: commonCertificateRatingsByCountry,
      certifications: { movie: movieCertifications, series: seriesCertifications },
      watchRegions,
      tvNetworks: (tmdb.TV_NETWORKS || []).map(
        (n: { id: number; name: string; logo?: string; logoPath?: string | null }) => ({
          id: n.id,
          name: n.name,
          logo: n.logo || n.logoPath || null,
        })
      ),
      imdb: imdbData,
      anilist: {
        enabled: true,
        genres: anilist.getGenres(),
        tags: await anilist.getTagsFromApi(),
        sortOptions: anilist.getSortOptions(),
        formatOptions: anilist.getFormatOptions(),
        statusOptions: anilist.getStatusOptions(),
        seasonOptions: anilist.getSeasonOptions(),
        sourceOptions: anilist.getSourceOptions(),
        countryOptions: anilist.getCountryOptions(),
      },
      mal: {
        enabled: true, // Jikan API - no key needed
        genres: mal.getGenres(),
        rankingTypes: mal.getRankingTypes(),
        sortOptions: mal.getSortOptions(),
        orderByOptions: mal.getOrderByOptions(),
        mediaTypes: mal.getMediaTypes(),
        statuses: mal.getStatuses(),
        ratings: mal.getRatings(),
      },
      simkl: {
        enabled: simkl.isSimklEnabled(),
        genres: simkl.getGenres(),
        sortOptions: simkl.getSortOptions(),
        listTypes: simkl.getListTypes(),
        trendingPeriods: simkl.getTrendingPeriods(),
        bestFilters: simkl.getBestFilters(),
        animeTypes: simkl.getAnimeTypes(),
      },
      trakt: {
        enabled: trakt.isTraktEnabled(),
        genres: await trakt.getGenresByType(traktClientId).catch(() => trakt.getGenresByType()),
        listTypes: trakt.getListTypes(),
        periods: trakt.getPeriods(),
        calendarTypes: trakt.getCalendarTypes(),
        showStatuses: trakt.getShowStatuses(),
        certificationsMovie: trakt.getCertifications('movie'),
        certificationsSeries: trakt.getCertifications('series'),
        communityMetrics: trakt.getCommunityMetrics(),
        networks: await trakt.getNetworks(traktClientId).catch(() => []),
        hasKey: traktHasKey,
      },
    };

    res.set('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    res.json(data);
  } catch (error) {
    log.error('GET /reference-data error', { error: (error as Error).message });
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, safeErrorMessage(error as Error));
  }
});

router.get('/genres/:type', requireAuth, resolveApiKey, async (req, res) => {
  try {
    const type = req.params.type as string;
    const genres = await tmdb.getGenres(getApiKey(req), type);
    res.json(genres);
  } catch (error) {
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, safeErrorMessage(error as Error));
  }
});

router.get('/languages', requireAuth, resolveApiKey, async (req, res) => {
  try {
    const languages = await tmdb.getLanguages(getApiKey(req));
    res.json(languages);
  } catch (error) {
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, safeErrorMessage(error as Error));
  }
});

router.get('/original-languages', requireAuth, resolveApiKey, async (req, res) => {
  try {
    const languages = await tmdb.getOriginalLanguages(getApiKey(req));
    res.json(languages);
  } catch (error) {
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, safeErrorMessage(error as Error));
  }
});

router.get('/countries', requireAuth, resolveApiKey, async (req, res) => {
  try {
    const countries = await tmdb.getCountries(getApiKey(req));
    res.json(countries);
  } catch (error) {
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, safeErrorMessage(error as Error));
  }
});

router.get('/certifications/:type', requireAuth, resolveApiKey, async (req, res) => {
  try {
    const type = req.params.type as string;
    const certifications = await tmdb.getCertifications(getApiKey(req), type);
    res.json(certifications);
  } catch (error) {
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, safeErrorMessage(error as Error));
  }
});

router.get('/watch-providers/:type', requireAuth, resolveApiKey, async (req, res) => {
  try {
    const type = req.params.type as string;
    const { region } = req.query;
    const providers = await tmdb.getWatchProviders(
      getApiKey(req),
      type as string,
      String(region || 'US')
    );
    res.json(providers);
  } catch (error) {
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, safeErrorMessage(error as Error));
  }
});

router.get('/watch-regions', requireAuth, resolveApiKey, async (req, res) => {
  try {
    const regions = await tmdb.getWatchRegions(getApiKey(req));
    res.json(regions);
  } catch (error) {
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, safeErrorMessage(error as Error));
  }
});

router.get('/search/person', requireAuth, resolveApiKey, async (req, res) => {
  try {
    const query = req.query.query as string | undefined;
    if (!query) {
      return sendError(res, 400, ErrorCodes.VALIDATION_ERROR, 'Query required');
    }
    const results = await tmdb.searchPerson(getApiKey(req), query);
    res.json(results);
  } catch (error) {
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, safeErrorMessage(error as Error));
  }
});

router.get('/search/company', requireAuth, resolveApiKey, async (req, res) => {
  try {
    const query = req.query.query as string | undefined;
    if (!query) {
      return sendError(res, 400, ErrorCodes.VALIDATION_ERROR, 'Query required');
    }
    const results = await tmdb.searchCompany(getApiKey(req), query);
    res.json(results);
  } catch (error) {
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, safeErrorMessage(error as Error));
  }
});

router.get('/search/keyword', requireAuth, resolveApiKey, async (req, res) => {
  try {
    const query = req.query.query as string | undefined;
    if (!query) {
      return sendError(res, 400, ErrorCodes.VALIDATION_ERROR, 'Query required');
    }
    const results = await tmdb.searchKeyword(getApiKey(req), query);
    res.json(results);
  } catch (error) {
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, safeErrorMessage(error as Error));
  }
});

router.get('/search/collection', requireAuth, resolveApiKey, async (req, res) => {
  try {
    const query = req.query.query as string | undefined;
    if (!query) {
      return sendError(res, 400, ErrorCodes.VALIDATION_ERROR, 'Query required');
    }
    const page = sanitizePage(req.query.page as string | number | undefined);
    const language = sanitizeString(req.query.language as string | undefined, 20);
    const results = await tmdb.searchCollection(getApiKey(req), query, page, language);
    res.json(results);
  } catch (error) {
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, safeErrorMessage(error as Error));
  }
});

router.get('/person/:id', requireAuth, resolveApiKey, async (req, res) => {
  try {
    const id = req.params.id as string;
    if (!id) return sendError(res, 400, ErrorCodes.VALIDATION_ERROR, 'ID required');
    const person = await tmdb.getPersonById(getApiKey(req), id);
    if (!person) return sendError(res, 404, ErrorCodes.NOT_FOUND, 'Not found');
    res.json({ id: String(person.id), name: person.name });
  } catch (err) {
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, (err as Error).message);
  }
});

router.get('/company/:id', requireAuth, resolveApiKey, async (req, res) => {
  try {
    const id = req.params.id as string;
    if (!id) return sendError(res, 400, ErrorCodes.VALIDATION_ERROR, 'ID required');
    const company = await tmdb.getCompanyById(getApiKey(req), id);
    if (!company) return sendError(res, 404, ErrorCodes.NOT_FOUND, 'Not found');
    res.json({ id: String(company.id), name: company.name });
  } catch (err) {
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, (err as Error).message);
  }
});

router.get('/keyword/:id', requireAuth, resolveApiKey, async (req, res) => {
  try {
    const id = req.params.id as string;
    if (!id) return sendError(res, 400, ErrorCodes.VALIDATION_ERROR, 'ID required');
    const keyword = await tmdb.getKeywordById(getApiKey(req), id);
    if (!keyword) return sendError(res, 404, ErrorCodes.NOT_FOUND, 'Not found');
    res.json({ id: String(keyword.id), name: keyword.name });
  } catch (err) {
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, (err as Error).message);
  }
});

router.get('/network/:id', requireAuth, resolveApiKey, async (req, res) => {
  try {
    const id = req.params.id as string;
    if (!id) return sendError(res, 400, ErrorCodes.VALIDATION_ERROR, 'ID required');
    const network = await tmdb.getNetworkById(getApiKey(req), id);
    if (!network) return sendError(res, 404, ErrorCodes.NOT_FOUND, 'Not found');
    res.json({ id: String(network.id), name: network.name, logo: network.logoPath });
  } catch (err) {
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, (err as Error).message);
  }
});

router.get('/collection/:id', requireAuth, resolveApiKey, async (req, res) => {
  try {
    const id = req.params.id as string;
    if (!id) return sendError(res, 400, ErrorCodes.VALIDATION_ERROR, 'ID required');
    const language = sanitizeString(req.query.language as string | undefined, 20);
    const collection = await tmdb.getCollectionById(getApiKey(req), id, language);
    if (!collection) return sendError(res, 404, ErrorCodes.NOT_FOUND, 'Not found');
    res.json({
      id: String(collection.id),
      name: collection.name,
      poster_path: collection.poster_path,
      backdrop_path: collection.backdrop_path,
      parts: collection.parts || [],
    });
  } catch (err) {
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, (err as Error).message);
  }
});

router.get('/sort-options', (req, res) => {
  const type = req.query.type as string | undefined;
  if (type && tmdb.SORT_OPTIONS[type as ContentType]) {
    res.json(tmdb.SORT_OPTIONS[type as ContentType]);
  } else {
    res.json(tmdb.SORT_OPTIONS);
  }
});

router.get('/list-types', (req, res) => {
  const type = req.query.type as string | undefined;
  if (type && tmdb.LIST_TYPES[type as ContentType]) {
    res.json(tmdb.LIST_TYPES[type as ContentType]);
  } else {
    res.json(tmdb.LIST_TYPES);
  }
});

router.get('/preset-catalogs', (req, res) => {
  const type = req.query.type as string | undefined;
  if (type && tmdb.PRESET_CATALOGS[type as ContentType]) {
    res.json(tmdb.PRESET_CATALOGS[type as ContentType]);
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
  const query = req.query.query as string | undefined;

  const normalizeNetwork = (n: {
    id: number;
    name: string;
    logo?: string;
    logoPath?: string | null;
  }) => ({
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
      logSwallowedError('api:resolve-apikey', e);
    }
  }

  if (apiKey) {
    try {
      const remote = await tmdb.getNetworks(String(query));
      const remoteNormalized = (remote || []).map(normalizeNetwork);
      const byId = new Map();
      [...curatedMatches, ...remoteNormalized].forEach((n) => {
        if (!n || !n.id) return;
        if (!byId.has(n.id)) byId.set(n.id, n);
      });
      return res.json(Array.from(byId.values()));
    } catch (err) {
      logSwallowedError('api:network-merge', err);
      return res.json(curatedMatches);
    }
  }

  return res.json(curatedMatches);
});

type PreviewPosterProvider = Extract<
  PosterServiceType,
  'tmdb' | 'imdb' | 'tvdb' | 'fanart' | 'rpdb' | 'topPosters' | 'customUrl'
>;

const PREVIEW_POSTER_PROVIDERS = new Set<PreviewPosterProvider>([
  'tmdb',
  'imdb',
  'tvdb',
  'fanart',
  'rpdb',
  'topPosters',
  'customUrl',
]);

const CINEMETA_PREVIEW_NEGATIVE_CACHE = '__none__';

type PreviewLookupConfig = Awaited<ReturnType<typeof getUserConfig>>;
type PreviewLookupRequest = Request & {
  __previewLookupConfigPromise?: Promise<PreviewLookupConfig | null>;
};

function setPreviewLookupConfig(req: Request, cfg: PreviewLookupConfig | null): void {
  (req as PreviewLookupRequest).__previewLookupConfigPromise = Promise.resolve(cfg);
}

async function getPreviewLookupConfig(req: Request): Promise<PreviewLookupConfig | null> {
  const requestWithCache = req as PreviewLookupRequest;

  if (!requestWithCache.__previewLookupConfigPromise) {
    requestWithCache.__previewLookupConfigPromise = (async () => {
      const authUserId = (req as Request & { user?: { userId?: string } }).user?.userId;

      if (authUserId) {
        try {
          const configByUser = await getUserConfig(authUserId);
          if (configByUser) return configByUser;
        } catch (error) {
          logSwallowedError('api:preview-lookup-user-config', error);
        }
      }

      if (req.apiKey) {
        try {
          const configs = await getConfigsByApiKey(req.apiKey);
          if (configs[0]) return configs[0];
        } catch (error) {
          logSwallowedError('api:preview-lookup-apikey-config', error);
        }
      }

      if (req.apiKeyId) {
        try {
          const configs = await getConfigsByApiKey(null, req.apiKeyId);
          if (configs[0]) return configs[0];
        } catch (error) {
          logSwallowedError('api:preview-lookup-apikeyid-config', error);
        }
      }

      return null;
    })();
  }

  return requestWithCache.__previewLookupConfigPromise;
}

function resolvePreviewPosterProvider(req: Request): PreviewPosterProvider | null {
  const rawProvider = sanitizeString(String(req.body?.previewPosterProvider || ''), 32);
  if (!rawProvider || rawProvider === 'default' || rawProvider === 'none') {
    return null;
  }

  if (PREVIEW_POSTER_PROVIDERS.has(rawProvider as PreviewPosterProvider)) {
    return rawProvider as PreviewPosterProvider;
  }

  return null;
}

async function resolvePreviewProviderApiKey(
  req: Request,
  provider: 'tvdb' | 'fanart' | 'rpdb' | 'topPosters' | 'customUrl'
): Promise<string | null> {
  const bodyKeyValidation = validateArtworkProviderApiKey(provider, req.body?.previewPosterApiKey, {
    required: false,
  });
  if (bodyKeyValidation.valid && bodyKeyValidation.normalizedKey) {
    return bodyKeyValidation.normalizedKey;
  }

  const findEncryptedProviderApiKey = (preferences: unknown): string | null => {
    if (!preferences || typeof preferences !== 'object') return null;

    const prefs = preferences as Record<string, unknown>;

    const encryptedMap = prefs.apiKeysEncrypted as Map<string, unknown> | Record<string, unknown>;
    if (encryptedMap && typeof encryptedMap === 'object') {
      const encryptedCandidate =
        encryptedMap instanceof Map
          ? encryptedMap.get(provider)
          : (encryptedMap as Record<string, unknown>)[provider];

      if (typeof encryptedCandidate === 'string' && encryptedCandidate.trim()) {
        return encryptedCandidate;
      }
    }

    const artwork = prefs.artwork;
    if (!artwork || typeof artwork !== 'object') return null;

    const stack: unknown[] = [artwork];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current || typeof current !== 'object') continue;

      const node = current as Record<string, unknown>;
      const nodeProvider = node.provider;
      const nodeEncryptedKey = node.apiKeyEncrypted;

      if (
        nodeProvider === provider &&
        typeof nodeEncryptedKey === 'string' &&
        nodeEncryptedKey.trim()
      ) {
        return nodeEncryptedKey;
      }

      Object.values(node).forEach((value) => {
        if (value && typeof value === 'object') stack.push(value);
      });
    }

    return null;
  };

  const tryExtractFromConfig = (
    cfg: Awaited<ReturnType<typeof getUserConfig>> | null
  ): string | null => {
    const encrypted = findEncryptedProviderApiKey(cfg?.preferences);
    if (!encrypted) return null;
    try {
      return decrypt(encrypted);
    } catch (error) {
      logSwallowedError(`api:preview-${provider}-decrypt`, error);
      return null;
    }
  };

  const lookupConfig = await getPreviewLookupConfig(req);
  const byResolvedConfig = tryExtractFromConfig(lookupConfig);
  if (byResolvedConfig) return byResolvedConfig;

  // Server-wide fallback keys (if explicitly configured)
  if (provider === 'rpdb') {
    return config.rpdb.apiKey || 't0-free-rpdb';
  }
  if (provider === 'topPosters') {
    return config.topPosters.apiKey || null;
  }

  if (provider === 'fanart') {
    return config.fanart.apiKey || null;
  }

  if (provider === 'customUrl') {
    return null;
  }

  return null;
}

function resolvePreviewContentType(req: Request): 'movie' | 'series' | 'anime' {
  const rawType = sanitizeString(String(req.body?.type || ''), 16);
  if (rawType === 'series' || rawType === 'anime') return rawType;
  return 'movie';
}

interface PreviewArtworkLanguagePreferences {
  englishArtOnly: boolean;
  originalLangFallback: boolean;
}

function extractPreviewArtworkLanguagePreferences(
  preferences: unknown
): PreviewArtworkLanguagePreferences {
  const defaults: PreviewArtworkLanguagePreferences = {
    englishArtOnly: false,
    originalLangFallback: true,
  };

  if (!preferences || typeof preferences !== 'object') {
    return defaults;
  }

  const prefs = preferences as Record<string, unknown>;
  const artwork = prefs.artwork;
  if (!artwork || typeof artwork !== 'object') {
    return defaults;
  }

  const artworkObj = artwork as Record<string, unknown>;

  return {
    englishArtOnly: Boolean(artworkObj.englishArtOnly),
    originalLangFallback:
      artworkObj.originalLangFallback === undefined
        ? true
        : Boolean(artworkObj.originalLangFallback),
  };
}

async function resolvePreviewArtworkLanguagePreferences(
  req: Request
): Promise<PreviewArtworkLanguagePreferences> {
  const defaults: PreviewArtworkLanguagePreferences = {
    englishArtOnly: false,
    originalLangFallback: true,
  };

  const bodyEnglishArtOnly = req.body?.previewEnglishArtOnly;
  const bodyOriginalLangFallback = req.body?.previewOriginalLangFallback;
  if (typeof bodyEnglishArtOnly === 'boolean' || typeof bodyOriginalLangFallback === 'boolean') {
    return {
      englishArtOnly:
        typeof bodyEnglishArtOnly === 'boolean' ? bodyEnglishArtOnly : defaults.englishArtOnly,
      originalLangFallback:
        typeof bodyOriginalLangFallback === 'boolean'
          ? bodyOriginalLangFallback
          : defaults.originalLangFallback,
    };
  }

  const tryExtractFromConfig = (
    cfg: Awaited<ReturnType<typeof getUserConfig>> | null
  ): PreviewArtworkLanguagePreferences => {
    return extractPreviewArtworkLanguagePreferences(cfg?.preferences);
  };

  const lookupConfig = await getPreviewLookupConfig(req);
  if (lookupConfig) {
    return tryExtractFromConfig(lookupConfig);
  }

  return defaults;
}

async function resolvePreviewCustomUrlPattern(req: Request): Promise<string | null> {
  const bodyPattern = sanitizeString(String(req.body?.previewPosterCustomUrlPattern || ''), 2048);
  if (bodyPattern && bodyPattern.trim()) {
    return bodyPattern.trim();
  }

  const findPatternFromPreferences = (preferences: unknown): string | null => {
    if (!preferences || typeof preferences !== 'object') return null;

    const prefs = preferences as Record<string, unknown>;

    if (
      prefs.posterService === 'customUrl' &&
      typeof prefs.posterCustomUrlPattern === 'string' &&
      prefs.posterCustomUrlPattern.trim()
    ) {
      return prefs.posterCustomUrlPattern.trim();
    }

    const artwork = prefs.artwork;
    if (!artwork || typeof artwork !== 'object') return null;

    const artworkObj = artwork as Record<string, unknown>;
    const contentType = resolvePreviewContentType(req);

    const fromContentTypePoster =
      artworkObj[contentType] &&
      typeof artworkObj[contentType] === 'object' &&
      (artworkObj[contentType] as Record<string, unknown>).poster &&
      typeof (artworkObj[contentType] as Record<string, unknown>).poster === 'object'
        ? ((artworkObj[contentType] as Record<string, unknown>).poster as Record<string, unknown>)
        : null;

    if (
      fromContentTypePoster?.provider === 'customUrl' &&
      typeof fromContentTypePoster.customUrlPattern === 'string' &&
      fromContentTypePoster.customUrlPattern.trim()
    ) {
      return fromContentTypePoster.customUrlPattern.trim();
    }

    const legacyPoster =
      artworkObj.poster && typeof artworkObj.poster === 'object'
        ? (artworkObj.poster as Record<string, unknown>)
        : null;
    if (
      legacyPoster?.provider === 'customUrl' &&
      typeof legacyPoster.customUrlPattern === 'string' &&
      legacyPoster.customUrlPattern.trim()
    ) {
      return legacyPoster.customUrlPattern.trim();
    }

    return null;
  };

  const tryExtractFromConfig = (
    cfg: Awaited<ReturnType<typeof getUserConfig>> | null
  ): string | null => {
    return findPatternFromPreferences(cfg?.preferences);
  };

  const lookupConfig = await getPreviewLookupConfig(req);
  const byResolvedConfig = tryExtractFromConfig(lookupConfig);
  if (byResolvedConfig) return byResolvedConfig;

  return null;
}

async function buildPreviewPosterOption(
  provider: PreviewPosterProvider | null,
  req: Request
): Promise<PosterOptions | null> {
  if (!provider) return null;

  if (provider === 'tmdb' || provider === 'imdb') {
    return { service: provider };
  }

  if (provider === 'tvdb') {
    const tvdbApiKey = await resolvePreviewProviderApiKey(req, 'tvdb');
    if (!tvdbApiKey) {
      log.warn('TVDB preview provider selected without configured TVDB API key');
      return null;
    }

    return {
      service: 'tvdb',
      apiKey: tvdbApiKey,
    };
  }

  if (provider === 'fanart') {
    const fanartApiKey = await resolvePreviewProviderApiKey(req, 'fanart');
    if (!fanartApiKey) {
      log.warn('Fanart preview provider selected without configured Fanart API key');
      return null;
    }

    return {
      service: 'fanart',
      apiKey: fanartApiKey,
    };
  }

  if (provider === 'rpdb') {
    const rpdbApiKey = await resolvePreviewProviderApiKey(req, 'rpdb');
    if (!rpdbApiKey) return null;

    return {
      service: 'rpdb',
      apiKey: rpdbApiKey,
    };
  }

  if (provider === 'topPosters') {
    const topPostersApiKey = await resolvePreviewProviderApiKey(req, 'topPosters');
    if (!topPostersApiKey) {
      log.warn('Top Posters preview provider selected without configured Top Posters API key');
      return null;
    }

    return {
      service: 'topPosters',
      apiKey: topPostersApiKey,
    };
  }

  if (provider === 'customUrl') {
    const customUrlPattern = await resolvePreviewCustomUrlPattern(req);
    if (!customUrlPattern) {
      log.warn('Custom URL preview provider selected without configured URL pattern');
      return null;
    }

    const customUrlApiKey = await resolvePreviewProviderApiKey(req, 'customUrl');
    return {
      service: 'customUrl',
      customUrlPattern,
      ...(customUrlApiKey ? { apiKey: customUrlApiKey } : {}),
    };
  }

  return null;
}

async function buildPreviewArtworkOptions(
  provider: PreviewPosterProvider | null,
  req: Request
): Promise<ArtworkOptions | null> {
  const poster = await buildPreviewPosterOption(provider, req);
  if (!poster) return null;

  const languagePreferences = await resolvePreviewArtworkLanguagePreferences(req);

  return {
    poster,
    backdrop: null,
    logo: null,
    landscape: null,
    episode: null,
    englishArtOnly: languagePreferences.englishArtOnly,
    originalLangFallback: languagePreferences.originalLangFallback,
  };
}

function inferPreviewImdbId(meta: StremioMetaPreview): string | null {
  const candidate = meta.imdbId || meta.imdb_id || (meta.id?.startsWith('tt') ? meta.id : null);
  if (!candidate || !/^tt\d+$/.test(candidate)) return null;
  return candidate;
}

function normalizePreviewTypeForCinemeta(type: ContentType): 'movie' | 'series' {
  return type === 'series' || type === 'anime' ? 'series' : 'movie';
}

function sanitizePosterUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed = new URL(raw.trim());
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function customUrlPatternRequiresImdbId(pattern: string | null | undefined): boolean {
  if (!pattern) return false;
  return /\{imdb_id\}/.test(pattern);
}

async function fetchCinemetaPreviewPoster(
  imdbId: string,
  type: ContentType
): Promise<string | null> {
  const normalizedType = normalizePreviewTypeForCinemeta(type);
  const cache = getCache();
  const cacheKey = `preview:cinemeta:poster:${normalizedType}:${imdbId}`;

  try {
    const cached = (await cache.get(cacheKey)) as string | null;
    if (cached === CINEMETA_PREVIEW_NEGATIVE_CACHE) return null;
    if (cached) return cached;
  } catch (error) {
    logSwallowedError('api:preview-cinemeta-cache-get', error);
  }

  try {
    const response = await fetch(
      `https://v3-cinemeta.strem.io/meta/${normalizedType}/${encodeURIComponent(imdbId)}.json`,
      {
        signal: AbortSignal.timeout(TIMEOUTS.REQUEST_MS),
      }
    );

    if (!response.ok) {
      try {
        await cache.set(cacheKey, CINEMETA_PREVIEW_NEGATIVE_CACHE, CACHE_TTLS.NEGATIVE_LOOKUP);
      } catch (error) {
        logSwallowedError('api:preview-cinemeta-cache-set-neg', error);
      }
      return null;
    }

    const payload = (await response.json()) as { meta?: { poster?: string | null } };
    const poster = sanitizePosterUrl(payload?.meta?.poster || null);

    try {
      await cache.set(
        cacheKey,
        poster || CINEMETA_PREVIEW_NEGATIVE_CACHE,
        poster ? CACHE_TTLS.DETAIL : CACHE_TTLS.NEGATIVE_LOOKUP
      );
    } catch (error) {
      logSwallowedError('api:preview-cinemeta-cache-set', error);
    }

    return poster;
  } catch (error) {
    logSwallowedError('api:preview-cinemeta-fetch', error);
    return null;
  }
}

async function resolveImdbPreviewPoster(meta: StremioMetaPreview): Promise<string | null> {
  const imdbId = inferPreviewImdbId(meta);
  if (!imdbId) return null;

  if (imdb.isImdbApiEnabled()) {
    try {
      const poster = await imdb.getPoster(imdbId);
      const imdbPoster =
        sanitizePosterUrl(poster?.primaryImage?.url || null) ||
        sanitizePosterUrl(poster?.posterImages?.[0]?.url || null);
      if (imdbPoster) return imdbPoster;
    } catch (error) {
      logSwallowedError('api:preview-imdb-poster-posterapi', error);
      // Backward compatibility for older imdb-api deployments without /poster endpoint.
      try {
        const title = await imdb.getTitle(imdbId);
        const fallbackPoster =
          sanitizePosterUrl(title?.primaryImage?.url || null) ||
          sanitizePosterUrl(title?.posterImages?.[0]?.url || null);
        if (fallbackPoster) return fallbackPoster;
      } catch (fallbackError) {
        logSwallowedError('api:preview-imdb-poster-imdbapi-fallback', fallbackError);
      }
    }
  }

  return fetchCinemetaPreviewPoster(imdbId, meta.type);
}

async function applyImdbPreviewPosterProvider(
  metas: StremioMetaPreview[]
): Promise<StremioMetaPreview[]> {
  const resolvedPosters = await Promise.all(metas.map((meta) => resolveImdbPreviewPoster(meta)));

  return metas.map((meta, index) => ({
    ...meta,
    poster: resolvedPosters[index] || meta.poster || null,
  }));
}

async function applyPreviewPosterProvider(
  metas: StremioMetaPreview[],
  provider: PreviewPosterProvider | null,
  req: Request
): Promise<StremioMetaPreview[]> {
  if (!provider || !Array.isArray(metas) || metas.length === 0) {
    return metas;
  }

  if (provider === 'imdb') {
    return applyImdbPreviewPosterProvider(metas);
  }

  const artworkOptions = await buildPreviewArtworkOptions(provider, req);
  if (!artworkOptions) return metas;

  return applyArtworkOverridesToMetaPreviews(metas, artworkOptions, {
    strictPoster: true,
  });
}

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
    const previewPosterProvider = resolvePreviewPosterProvider(req);
    const listType = filters.listType || 'discover';
    let titles = [];
    let totalResults = 0;

    if (listType === 'top250') {
      const result = await imdb.getTopRanking(type);
      titles = (result.titles || []).slice(0, 20);
      totalResults = 250;
    } else if (listType === 'popular') {
      const result = await imdb.getPopular(type);
      titles = (result.titles || []).slice(0, 20);
      totalResults = result.titles?.length || 100;
    } else if (listType === 'imdb_list' && filters.imdbListId) {
      const result = await imdb.getList(filters.imdbListId as string, 0);
      titles = (result.titles || []).slice(0, 20);
      totalResults = result.titles?.length || 0;
    } else {
      const searchParams = {
        query: filters.query,
        types: filters.types,
        genres: filters.genres,
        excludeGenres: filters.excludeGenres,
        sortBy: filters.sortBy || 'POPULARITY',
        sortOrder: filters.sortOrder || 'DESC',
        imdbRatingMin: filters.imdbRatingMin,
        imdbRatingMax: filters.imdbRatingMax,
        totalVotesMin: filters.totalVotesMin,
        totalVotesMax: filters.totalVotesMax,
        releaseDateStart: filters.releaseDateStart,
        releaseDateEnd: filters.releaseDateEnd,
        runtimeMin: filters.runtimeMin,
        runtimeMax: filters.runtimeMax,
        languages: filters.languages,
        countries: filters.countries,
        imdbCountries: filters.imdbCountries,
        keywords: filters.keywords,
        excludeKeywords: filters.excludeKeywords,
        awardsWon: filters.awardsWon,
        awardsNominated: filters.awardsNominated,
        companies: filters.companies,
        excludeCompanies: filters.excludeCompanies,
        creditedNames: filters.creditedNames,
        inTheatersLat: filters.inTheatersLat,
        inTheatersLong: filters.inTheatersLong,
        inTheatersRadius: filters.inTheatersRadius,
        certificateRating: filters.certificateRating,
        certificateCountry: filters.certificateCountry,
        certificates: filters.certificates,
        explicitContent: filters.explicitContent,
        rankedList: filters.rankedList,
        rankedLists: filters.rankedLists,
        excludeRankedLists: filters.excludeRankedLists,
        rankedListMaxRank: filters.rankedListMaxRank,
        plot: filters.plot,
        filmingLocations: filters.filmingLocations,
        withData: filters.withData,
      };
      const result = await imdb.advancedSearch(
        searchParams as Parameters<typeof imdb.advancedSearch>[0],
        type,
        0
      );
      titles = (result.titles || []).slice(0, 20);
      totalResults = result.totalResults || result.titles?.length || 0;
    }

    const mappedMetas = titles.map(
      (item) => imdb.imdbToStremioMeta(item, type) as StremioMetaPreview | null
    );
    const metas = mappedMetas.filter((meta): meta is StremioMetaPreview => Boolean(meta));
    const previewMetas = await applyPreviewPosterProvider(metas, previewPosterProvider, req);

    res.json({
      metas: previewMetas,
      totalResults,
      previewEmpty: previewMetas.length === 0,
    });
  } catch (error) {
    log.error('POST /imdb/preview error', { error: (error as Error).message });
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, safeErrorMessage(error as Error));
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

    const limit = validateLimit(req.query.limit as string, 100, 20);
    const imdbTypes =
      type === 'series'
        ? ['tvSeries', 'tvMiniSeries']
        : type === 'movie'
          ? ['movie', 'tvMovie']
          : undefined;
    const result = await imdb.search(String(query), imdbTypes, limit);
    const metas = (result.titles || [])
      .map((item) => imdb.imdbToStremioMeta(item, String(type || 'movie') as ContentType))
      .filter(Boolean);

    res.json({ metas });
  } catch (error) {
    log.error('GET /imdb/search error', { error: (error as Error).message });
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, safeErrorMessage(error as Error));
  }
});

router.get('/imdb/list/:id/validate', requireAuth, async (req, res) => {
  try {
    if (!imdb.isImdbApiEnabled()) {
      return sendError(res, 503, ErrorCodes.INTERNAL_ERROR, 'IMDb API not enabled');
    }

    const id = req.params.id as string;
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
    log.error('GET /imdb/list/:id/validate error', { error: (error as Error).message });
    res.json({ valid: false, listId: req.params.id as string, error: (error as Error).message });
  }
});

router.get('/imdb/search/people', requireAuth, async (req, res) => {
  try {
    if (!imdb.isImdbApiEnabled()) {
      return sendError(res, 503, ErrorCodes.INTERNAL_ERROR, 'IMDb API not enabled');
    }

    const query = String(req.query.query || '');
    if (!query) {
      return sendError(res, 400, ErrorCodes.VALIDATION_ERROR, 'Query required');
    }

    const limit = validateLimit(req.query.limit as string, 50, 10);
    const result = await imdb.basicSearch(query, 'NAME', limit);
    const people = (result.results || [])
      .filter(
        (item): item is import('../services/imdb/types.ts').ImdbBasicSearchNameResult =>
          item.type === 'Name'
      )
      .map((item) => ({
        id: item.id,
        name: item.fullName,
        profilePath: item.primaryImage?.url || null,
        knownFor: item.knownFor?.titles?.map((t) => t.primaryTitle).join(', ') || '',
      }));

    res.json({ results: people });
  } catch (error) {
    log.error('GET /imdb/search/people error', { error: (error as Error).message });
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, safeErrorMessage(error as Error));
  }
});

router.get('/imdb/search/companies', requireAuth, async (req, res) => {
  try {
    if (!imdb.isImdbApiEnabled()) {
      return sendError(res, 503, ErrorCodes.INTERNAL_ERROR, 'IMDb API not enabled');
    }

    const query = String(req.query.query || '');
    if (!query) {
      return sendError(res, 400, ErrorCodes.VALIDATION_ERROR, 'Query required');
    }

    const limit = validateLimit(req.query.limit as string, 50, 10);
    const result = await imdb.basicSearch(query, 'COMPANY', limit);
    const companies = (result.results || [])
      .filter(
        (item): item is import('../services/imdb/types.ts').ImdbBasicSearchCompanyResult =>
          item.type === 'Company'
      )
      .map((item) => ({
        id: item.id,
        name: item.name,
        logoPath: null,
        knownFor: item.country || '',
      }));

    res.json({ results: companies });
  } catch (error) {
    log.error('GET /imdb/search/companies error', { error: (error as Error).message });
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, safeErrorMessage(error as Error));
  }
});

router.get('/imdb/search/suggestions', requireAuth, async (req, res) => {
  try {
    if (!imdb.isImdbApiEnabled()) {
      return sendError(res, 503, ErrorCodes.INTERNAL_ERROR, 'IMDb API not enabled');
    }

    const query = String(req.query.query || '');
    if (!query) {
      return sendError(res, 400, ErrorCodes.VALIDATION_ERROR, 'Query required');
    }

    const result = await imdb.getSuggestions(query);
    res.json(result);
  } catch (error) {
    log.error('GET /imdb/search/suggestions error', { error: (error as Error).message });
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, safeErrorMessage(error as Error));
  }
});

// ─── Anime Preview Endpoints ───

const PREVIEW_PAGE_SIZE = 20;
const PREVIEW_MAX_BACKFILL = 5;

function normalizePreviewContentType(type: unknown): ContentType {
  if (type === 'anime') return 'anime';
  if (type === 'series') return 'series';
  return 'movie';
}

async function runPreviewBackfill(opts: {
  fetchPage: (page: number) => Promise<{ metas: StremioMetaPreview[]; hasMore: boolean }>;
  startPage?: number;
  firstPageResult?: { metas: StremioMetaPreview[]; hasMore: boolean };
  randomize: boolean;
  previewPosterProvider: PreviewPosterProvider | null;
  req: Request;
}): Promise<StremioMetaPreview[]> {
  const { fetchPage, startPage = 1, firstPageResult, randomize, previewPosterProvider, req } = opts;
  const metas: StremioMetaPreview[] = [];
  let page = startPage;
  let pages = 0;
  while (metas.length < PREVIEW_PAGE_SIZE && pages < PREVIEW_MAX_BACKFILL) {
    const result = pages === 0 && firstPageResult ? firstPageResult : await fetchPage(page);
    metas.push(...result.metas);
    pages++;
    if (!result.hasMore) break;
    page++;
  }
  const ordered = randomize ? shuffleArray(metas) : metas;
  return applyPreviewPosterProvider(
    ordered.slice(0, PREVIEW_PAGE_SIZE),
    previewPosterProvider,
    req
  );
}

type RequestProfileStep = {
  name: string;
  durationMs: number;
  details?: Record<string, unknown>;
};

type RequestProfileStepAggregate = {
  name: string;
  count: number;
  totalMs: number;
  maxMs: number;
  avgMs: number;
};

type RequestProfileSummary = {
  totalMs: number;
  stepCount: number;
  topSteps: RequestProfileStepAggregate[];
  steps: RequestProfileStep[];
};

function monotonicNowNs(): bigint {
  return process.hrtime.bigint();
}

function monotonicDurationMs(startNs: bigint): number {
  return Number(process.hrtime.bigint() - startNs) / 1_000_000;
}

class RequestProfiler {
  private readonly enabled: boolean;

  private readonly startedAtNs: bigint;

  private readonly steps: RequestProfileStep[] = [];

  constructor(enabled: boolean) {
    this.enabled = enabled;
    this.startedAtNs = monotonicNowNs();
  }

  start(name: string): { name: string; startedAtNs: bigint } | null {
    if (!this.enabled) return null;
    return { name, startedAtNs: monotonicNowNs() };
  }

  end(
    token: { name: string; startedAtNs: bigint } | null,
    details?: Record<string, unknown>
  ): void {
    if (!this.enabled || !token) return;
    this.record(token.name, monotonicDurationMs(token.startedAtNs), details);
  }

  record(name: string, durationMs: number, details?: Record<string, unknown>): void {
    if (!this.enabled) return;
    this.steps.push({
      name,
      durationMs: Number(durationMs.toFixed(3)),
      ...(details ? { details } : {}),
    });
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  summary(): RequestProfileSummary | null {
    if (!this.enabled) return null;

    const grouped = new Map<string, { count: number; totalMs: number; maxMs: number }>();
    for (const step of this.steps) {
      const existing = grouped.get(step.name);
      if (!existing) {
        grouped.set(step.name, {
          count: 1,
          totalMs: step.durationMs,
          maxMs: step.durationMs,
        });
        continue;
      }

      existing.count += 1;
      existing.totalMs += step.durationMs;
      existing.maxMs = Math.max(existing.maxMs, step.durationMs);
    }

    const topSteps = Array.from(grouped.entries())
      .map(([name, entry]) => ({
        name,
        count: entry.count,
        totalMs: Number(entry.totalMs.toFixed(3)),
        maxMs: Number(entry.maxMs.toFixed(3)),
        avgMs: Number((entry.totalMs / entry.count).toFixed(3)),
      }))
      .sort((a, b) => b.totalMs - a.totalMs)
      .slice(0, 20);

    return {
      totalMs: Number(monotonicDurationMs(this.startedAtNs).toFixed(3)),
      stepCount: this.steps.length,
      topSteps,
      steps: this.steps.slice(0, 200),
    };
  }
}

function parseBooleanFlag(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (Array.isArray(value)) return value.some((item) => parseBooleanFlag(item));
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return (
      normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
    );
  }
  return false;
}

function isTraktPreviewProfilingEnabled(req: Request): boolean {
  return (
    parseBooleanFlag(req.body?.profile) ||
    parseBooleanFlag(req.query?.profile) ||
    parseBooleanFlag(req.headers['x-profile'])
  );
}

router.post('/anilist/preview', requireAuth, async (req, res) => {
  try {
    const { filters, type } = req.body;
    const previewPosterProvider = resolvePreviewPosterProvider(req);
    const safeFilters = filters || {};
    const hasStudioFilter = Array.isArray(safeFilters.studios) && safeFilters.studios.length > 0;
    const randomize = Boolean(safeFilters.randomize || safeFilters.sortBy === 'random');
    const contentType = normalizePreviewContentType(type);
    let startPage = 1;

    if (randomize) {
      // AniList API fields (total, lastPage) are unreliable per official docs
      // Disable randomization for AniList to avoid performance issues
      log.debug('AniList randomization disabled - using page 1 instead', { type });
      startPage = 1;
    }

    let metasWithPreviewPoster: StremioMetaPreview[];
    if (hasStudioFilter && !randomize) {
      const pageNumbers = Array.from({ length: PREVIEW_MAX_BACKFILL }, (_, i) => i + 1);
      const batched = await anilist.browseBatch(safeFilters, contentType, pageNumbers);
      const metas: StremioMetaPreview[] = [];
      for (const result of batched) {
        metas.push(...anilist.batchConvertToStremioMeta(result.media, contentType));
        if (metas.length >= PREVIEW_PAGE_SIZE) break;
      }
      metasWithPreviewPoster = await applyPreviewPosterProvider(
        metas.slice(0, PREVIEW_PAGE_SIZE),
        previewPosterProvider,
        req
      );
    } else {
      metasWithPreviewPoster = await runPreviewBackfill({
        fetchPage: async (p) => {
          const r = await anilist.browse(safeFilters, contentType, p);
          return {
            metas: anilist.batchConvertToStremioMeta(r.media, contentType),
            hasMore: r.hasNextPage,
          };
        },
        startPage,
        randomize,
        previewPosterProvider,
        req,
      });
    }

    res.json({
      metas: metasWithPreviewPoster,
      totalResults: null,
    });
  } catch (error) {
    log.error('POST /anilist/preview error', { error: (error as Error).message });
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, safeErrorMessage(error as Error));
  }
});

router.get('/anilist/studios', requireAuth, async (req, res) => {
  try {
    const query = String(req.query.q || '').trim();
    if (!query || query.length < 2) {
      return res.json({ studios: [] });
    }
    const studios = await anilist.searchStudios(query);
    res.json({ studios });
  } catch (error) {
    log.error('GET /anilist/studios error', { error: (error as Error).message });
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, safeErrorMessage(error as Error));
  }
});

router.post('/mal/preview', requireAuth, async (req, res) => {
  try {
    const { filters, type } = req.body;
    const previewPosterProvider = resolvePreviewPosterProvider(req);
    const safeFilters = filters || {};
    const contentType = normalizePreviewContentType(type);

    const fetchPage = async (p: number) => {
      const r = await mal.discover(safeFilters, contentType, p);
      if (r.upstreamUnavailable) {
        throw new AppError(
          503,
          ErrorCodes.INTERNAL_ERROR,
          'MyAnimeList results are temporarily unavailable because Jikan cannot reach its upstream service. Please try again later.'
        );
      }
      return {
        metas: mal.batchConvertToStremioMeta(r.anime, contentType),
        hasMore: r.hasMore && r.anime.length > 0,
      };
    };

    const metasWithPreviewPoster = await runPreviewBackfill({
      fetchPage,
      startPage: 1,
      randomize: false,
      previewPosterProvider,
      req,
    });

    res.json({ metas: metasWithPreviewPoster, totalResults: null });
  } catch (error) {
    log.error('POST /mal/preview error', { error: (error as Error).message });
    if (error instanceof AppError) {
      return sendError(res, error.statusCode, error.code, error.message);
    }
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, safeErrorMessage(error as Error));
  }
});

router.post('/kitsu/preview', requireAuth, async (req, res) => {
  try {
    const { filters, type } = req.body;
    const previewPosterProvider = resolvePreviewPosterProvider(req);
    const safeFilters = filters || {};
    const randomize = Boolean(safeFilters.randomize || safeFilters.sortBy === 'random');
    const contentType = normalizePreviewContentType(type);
    let startPage = 1;

    if (randomize) {
      const probe = await kitsu.discover(safeFilters, contentType, 1);
      const totalPages = Math.ceil(probe.total / 20) || 1;
      // Pick a random page within valid bounds (1 to totalPages inclusive)
      startPage = Math.floor(Math.random() * totalPages) + 1;
    }

    const metasWithPreviewPoster = await runPreviewBackfill({
      fetchPage: async (p) => {
        const r = await mal.discover(safeFilters, contentType, p);
        return {
          metas: mal.batchConvertToStremioMeta(r.anime, contentType),
          hasMore: r.hasMore && r.anime.length > 0,
        };
      },
      startPage,
      randomize,
      previewPosterProvider,
      req,
    });
    res.json({ metas: metasWithPreviewPoster, totalResults: null });
  } catch (error) {
    log.error('POST /mal/preview error', { error: (error as Error).message });
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, safeErrorMessage(error as Error));
  }
});

router.post('/kitsu/preview', requireAuth, async (req, res) => {
  try {
    const { filters, type } = req.body;
    const previewPosterProvider = resolvePreviewPosterProvider(req);
    const safeFilters = filters || {};
    const randomize = Boolean(safeFilters.randomize || safeFilters.sortBy === 'random');
    const contentType = normalizePreviewContentType(type);
    let startPage = 1;

    if (randomize) {
      const probe = await kitsu.discover(safeFilters, contentType, 1);
      const totalPages = Math.ceil(probe.total / 20) || 1;
      // Pick a random page within valid bounds (1 to totalPages inclusive)
      startPage = Math.floor(Math.random() * totalPages) + 1;
    }

    const metasWithPreviewPoster = await runPreviewBackfill({
      fetchPage: async (p) => {
        const r = await kitsu.discover(safeFilters, contentType, p);
        return {
          metas: kitsu.batchConvertToStremioMeta(r.anime, contentType),
          hasMore: r.hasMore && r.anime.length > 0,
        };
      },
      startPage,
      randomize,
      previewPosterProvider,
      req,
    });
    res.json({ metas: metasWithPreviewPoster, totalResults: null });
  } catch (error) {
    log.error('POST /kitsu/preview error', { error: (error as Error).message });
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, safeErrorMessage(error as Error));
  }
});

router.post('/simkl/preview', requireAuth, async (req, res) => {
  try {
    const { filters, type } = req.body;
    const previewPosterProvider = resolvePreviewPosterProvider(req);
    const safeFilters = filters || {};
    const listType = safeFilters.simklListType || 'trending';
    const randomize = Boolean(safeFilters.randomize || safeFilters.sortBy === 'random');

    // Trending uses CDN (no API key needed), other list types need an API key
    const simklApiKey: string | null = config.simklApi.clientId || null;
    if (!simklApiKey && listType !== 'trending') {
      return sendError(
        res,
        503,
        ErrorCodes.INTERNAL_ERROR,
        'Simkl API key not configured on server.'
      );
    }
    const contentType = normalizePreviewContentType(type);
    let startPage = 1;

    if (randomize) {
      const probe = await simkl.discover(safeFilters, contentType, 1, simklApiKey || undefined);
      if (listType === 'trending' || listType === 'airing') {
        const previewMetas = shuffleArray(
          simkl.batchConvertToStremioMeta(probe.items, contentType)
        ).slice(0, PREVIEW_PAGE_SIZE);
        const metasWithPreviewPoster = await applyPreviewPosterProvider(
          previewMetas,
          previewPosterProvider,
          req
        );
        return res.json({ metas: metasWithPreviewPoster, totalResults: null });
      }
      const maxPage = probe.hasMore ? 5 : 1;
      startPage = Math.floor(Math.random() * maxPage) + 1;
    }

    const metasWithPreviewPoster = await runPreviewBackfill({
      fetchPage: async (p) => {
        const r = await simkl.discover(safeFilters, contentType, p, simklApiKey || undefined);
        return {
          metas: simkl.batchConvertToStremioMeta(r.items, contentType),
          hasMore: r.hasMore && r.items.length > 0,
        };
      },
      startPage,
      randomize,
      previewPosterProvider,
      req,
    });
    res.json({ metas: metasWithPreviewPoster, totalResults: null });
  } catch (error) {
    log.error('POST /simkl/preview error', { error: (error as Error).message });
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, safeErrorMessage(error as Error));
  }
});

router.post('/trakt/preview', requireAuth, resolveApiKey, async (req, res) => {
  try {
    const profiler = new RequestProfiler(isTraktPreviewProfilingEnabled(req));
    const initTimer = profiler.start('preview.init');
    const { filters, type } = req.body;
    const previewPosterProvider = resolvePreviewPosterProvider(req);
    const safeFilters = filters || {};
    const queryFilters = { ...safeFilters };
    const randomize = Boolean(queryFilters.randomize || queryFilters.sortBy === 'random');
    const previewListType = queryFilters.traktListType || 'calendar';
    const isCalendarType = previewListType === 'calendar' || previewListType === 'recently_aired';
    const contentType = (type === 'series' ? 'series' : 'movie') as ContentType;
    const metas: import('../types/stremio.ts').StremioMetaPreview[] = [];
    let page = 1;
    profiler.end(initTimer, {
      listType: previewListType,
      contentType,
      randomize,
      isCalendarType,
    });

    const finalizeResponse = (previewMetas: StremioMetaPreview[]) => {
      const response: {
        metas: StremioMetaPreview[];
        totalResults: null;
        profile?: RequestProfileSummary;
      } = {
        metas: previewMetas,
        totalResults: null,
      };

      const profileSummary = profiler.summary();
      if (profileSummary) {
        response.profile = profileSummary;
        log.info('Trakt preview profile', {
          listType: previewListType,
          contentType,
          randomize,
          totalMs: profileSummary.totalMs,
          topSteps: profileSummary.topSteps.slice(0, 10),
        });
      }

      return response;
    };

    const discoverProfileHook:
      | import('../services/trakt/discover.ts').DiscoverProfileHook
      | undefined = profiler.isEnabled()
      ? (event) => {
          profiler.record(`discover.${event.phase}`, event.durationMs, event.details);
        }
      : undefined;

    getApiKey(req);
    const configLoadTimer = profiler.start('preview.config_lookup');
    const lookupConfig = await getPreviewLookupConfig(req);
    profiler.end(configLoadTimer, { configCount: lookupConfig ? 1 : 0 });

    // Resolve Trakt Client ID: server env var → user's saved key
    let traktClientId: string | null = config.traktApi.clientId || null;
    if (!traktClientId) {
      if (lookupConfig) {
        traktClientId = getTraktKeyFromConfig(lookupConfig);
      }
    }
    if (!traktClientId) {
      return sendError(
        res,
        503,
        ErrorCodes.INTERNAL_ERROR,
        'Trakt Client ID not configured on server.'
      );
    }

    const excludeGenres: string[] | undefined = Array.isArray(queryFilters.traktExcludeGenres)
      ? queryFilters.traktExcludeGenres.filter(
          (genre: unknown): genre is string => typeof genre === 'string'
        )
      : undefined;

    const discoverOptions: import('../services/trakt/discover.ts').DiscoverOptions | undefined =
      discoverProfileHook ? { onProfile: discoverProfileHook } : undefined;

    if (randomize) {
      const randomProbeTimer = profiler.start('preview.random_probe.discover');
      const probe = await trakt.discover(
        queryFilters,
        contentType,
        1,
        traktClientId,
        discoverOptions
      );
      profiler.end(randomProbeTimer, {
        itemsCount: probe.items.length,
        hasMore: probe.hasMore,
      });

      const randomFilterTimer = profiler.start('preview.random_probe.filter');
      const filteredItems = excludeGenres?.length
        ? probe.items.filter(
            (item) => !(item.genres || []).some((g: string) => excludeGenres!.includes(g))
          )
        : probe.items;
      profiler.end(randomFilterTimer, {
        beforeCount: probe.items.length,
        afterCount: filteredItems.length,
        excluded: excludeGenres?.length || 0,
      });

      if (previewListType === 'boxoffice' || isCalendarType) {
        const convertTimer = profiler.start('preview.random_probe.convert_and_shuffle');
        const previewMetas = shuffleArray(
          trakt.batchConvertToStremioMeta(filteredItems, contentType)
        ).slice(0, PREVIEW_PAGE_SIZE);
        profiler.end(convertTimer, {
          inputCount: filteredItems.length,
          outputCount: previewMetas.length,
        });

        const artworkTimer = profiler.start('preview.apply_preview_poster');
        const metasWithPreviewPoster = await applyPreviewPosterProvider(
          previewMetas,
          previewPosterProvider,
          req
        );
        profiler.end(artworkTimer, {
          provider: previewPosterProvider || 'default',
          count: metasWithPreviewPoster.length,
        });
        return res.json(finalizeResponse(metasWithPreviewPoster));
      }
      const maxPage = probe.hasMore ? 5 : 1;
      page = Math.floor(Math.random() * maxPage) + 1;
    }

    let pages = 0;
    while (metas.length < PREVIEW_PAGE_SIZE && pages < PREVIEW_MAX_BACKFILL) {
      const discoverTimer = profiler.start('preview.backfill.discover');
      const result = await trakt.discover(
        queryFilters,
        contentType,
        page,
        traktClientId,
        discoverOptions
      );
      profiler.end(discoverTimer, {
        page,
        itemsCount: result.items.length,
        hasMore: result.hasMore,
      });

      const filterTimer = profiler.start('preview.backfill.filter');
      const filtered = excludeGenres?.length
        ? result.items.filter(
            (item) => !(item.genres || []).some((g: string) => excludeGenres!.includes(g))
          )
        : result.items;
      profiler.end(filterTimer, {
        page,
        beforeCount: result.items.length,
        afterCount: filtered.length,
        excluded: excludeGenres?.length || 0,
      });

      const convertTimer = profiler.start('preview.backfill.convert');
      metas.push(...trakt.batchConvertToStremioMeta(filtered, contentType));
      profiler.end(convertTimer, {
        page,
        convertedCount: filtered.length,
        metasAccumulated: metas.length,
      });
      pages++;
      if (!result.hasMore) break;
      page++;
    }

    const finalSliceTimer = profiler.start('preview.finalize_slice');
    const previewMetas = randomize ? shuffleArray(metas) : metas;
    const finalMetas = previewMetas.slice(0, PREVIEW_PAGE_SIZE);
    profiler.end(finalSliceTimer, {
      beforeSliceCount: previewMetas.length,
      afterSliceCount: finalMetas.length,
    });

    const artworkTimer = profiler.start('preview.apply_preview_poster');
    const metasWithPreviewPoster = await applyPreviewPosterProvider(
      finalMetas,
      previewPosterProvider,
      req
    );
    profiler.end(artworkTimer, {
      provider: previewPosterProvider || 'default',
      count: metasWithPreviewPoster.length,
    });

    res.json(finalizeResponse(metasWithPreviewPoster));
  } catch (error) {
    log.error('POST /trakt/preview error', { error: (error as Error).message });
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, safeErrorMessage(error as Error));
  }
});

router.get('/trakt/networks', requireAuth, resolveApiKey, async (req, res) => {
  try {
    let traktClientId: string | null = config.traktApi.clientId || null;
    if (!traktClientId) {
      const apiKey = getApiKey(req);
      const configs = await getConfigsByApiKey(apiKey);
      if (configs.length > 0) {
        traktClientId = getTraktKeyFromConfig(configs[0]);
      }
    }
    const networks = await trakt.getNetworks(traktClientId || undefined).catch(() => []);
    res.json({ networks });
  } catch (error) {
    log.error('GET /trakt/networks error', { error: (error as Error).message });
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, safeErrorMessage(error as Error));
  }
});

router.get('/geo/cities', requireAuth, async (req, res) => {
  try {
    const query = String(req.query.query || '');
    if (!query || query.length < 2) {
      return sendError(
        res,
        400,
        ErrorCodes.VALIDATION_ERROR,
        'Query must be at least 2 characters'
      );
    }

    const limit = validateLimit(req.query.limit as string, 20, 10);
    const results = await searchCities(query, limit);
    res.json({ results });
  } catch (error) {
    log.error('GET /geo/cities error', { error: (error as Error).message });
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, safeErrorMessage(error as Error));
  }
});

router.post('/preview', requireAuth, resolveApiKey, async (req, res) => {
  try {
    const { type, filters: rawFilters, page: rawPage = 1 } = req.body;
    const previewPosterProvider = resolvePreviewPosterProvider(req);
    const apiKey = getApiKey(req);

    if (!type || !isValidContentType(type)) {
      return sendError(res, 400, ErrorCodes.VALIDATION_ERROR, 'Invalid content type');
    }

    const filters = sanitizeFilters(rawFilters);
    const page = sanitizePage(rawPage);

    const resolvedFilters = resolveDynamicDatePreset(filters, type) as CatalogFilters | null;

    type PreviewResult = {
      results?: unknown[];
      total_results?: number;
      total_pages?: number;
      page?: number;
    };
    let results: PreviewResult | null = null;

    const listType = resolvedFilters?.listType;
    const randomize = Boolean(resolvedFilters?.randomize || resolvedFilters?.sortBy === 'random');

    if (listType && listType !== 'discover') {
      results = (await tmdb.fetchSpecialList(apiKey, listType, type, {
        page,
        displayLanguage: resolvedFilters?.displayLanguage,
        language: resolvedFilters?.language,
        region: resolvedFilters?.countries,
        collectionId: resolvedFilters?.collectionId,
        studioId: resolvedFilters?.studioId,
        sortBy: resolvedFilters?.sortBy,
        randomize,
      })) as PreviewResult;
    } else {
      results = (await tmdb.discover(apiKey, {
        type,
        ...(resolvedFilters as Record<string, unknown>),
        page,
        randomize,
      })) as PreviewResult;
    }

    const allResults = (results?.results || []) as import('../types/index.ts').TmdbResult[];
    const previewResults = allResults.slice(0, 20);
    const displayLanguage = resolvedFilters?.displayLanguage;
    const isCompanyFilmographyIdsOnly = Boolean(
      (results as { __companyFilmographyIdsOnly?: boolean } | null)?.__companyFilmographyIdsOnly
    );

    const previewCustomUrlPattern =
      previewPosterProvider === 'customUrl' ? await resolvePreviewCustomUrlPattern(req) : null;

    const previewProviderNeedsImdbIds =
      previewPosterProvider === 'imdb' ||
      previewPosterProvider === 'tvdb' ||
      (previewPosterProvider === 'customUrl' &&
        customUrlPatternRequiresImdbId(previewCustomUrlPattern));

    const shouldEnrichWithImdbIds = !isCompanyFilmographyIdsOnly && previewProviderNeedsImdbIds;

    if (shouldEnrichWithImdbIds) {
      try {
        await tmdb.enrichItemsWithImdbIds(apiKey, previewResults, type);
      } catch (error) {
        logSwallowedError('api:preview-enrich-imdb-ids', error);
      }
    }

    let filteredMetas;

    if (isCompanyFilmographyIdsOnly) {
      const tmdbIds = previewResults.map((item) => item.id);
      const detailsMap = await tmdb.batchGetDetails(apiKey, tmdbIds, type, { displayLanguage });
      filteredMetas = (
        await Promise.all(
          tmdbIds.map((tmdbId) =>
            tmdb.toStremioMetaPreview(
              detailsMap.get(tmdbId) as import('../types/index.ts').TmdbDetails | null,
              type,
              null,
              displayLanguage || null,
              null
            )
          )
        )
      ).filter(Boolean);
    } else {
      let genreMap: Record<string, string> | null = null;

      if ((results?.results?.length ?? 0) > 0 && displayLanguage && displayLanguage !== 'en') {
        try {
          const localizedGenres = await tmdb.getGenres(apiKey, type, displayLanguage);
          if (Array.isArray(localizedGenres)) {
            const map: Record<string, string> = {};
            localizedGenres.forEach((g) => {
              map[String(g.id)] = g.name;
            });
            genreMap = map;
          }
        } catch (err) {
          log.warn('Failed to fetch localized genres for preview', {
            displayLanguage,
            error: (err as Error).message,
          });
        }
      }

      const metas = previewResults.map((item) => {
        return tmdb.toStremioMeta(item, type, null, null, genreMap);
      });

      filteredMetas = metas.filter(Boolean);
    }

    const metasWithPreviewPoster = await applyPreviewPosterProvider(
      filteredMetas as StremioMetaPreview[],
      previewPosterProvider,
      req
    );

    log.debug('Preview results', {
      fetchedCount: allResults.length,
      filteredCount: metasWithPreviewPoster.length,
      companyFilmographyIdsOnly: isCompanyFilmographyIdsOnly,
    });

    res.json({
      metas: metasWithPreviewPoster,
      totalResults: results?.total_results ?? 0,
      totalPages: results?.total_pages ?? 0,
      page: results?.page ?? 1,
      previewEmpty: metasWithPreviewPoster.length === 0,
    });
  } catch (error) {
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, safeErrorMessage(error as Error));
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
    log.error('GET /stats error', { error: (error as Error).message });
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, safeErrorMessage(error as Error));
  }
});

router.post('/config', requireAuth, resolveApiKey, strictRateLimit, async (req, res) => {
  try {
    const { catalogs, preferences, configName } = req.body;

    if (catalogs !== undefined && !Array.isArray(catalogs)) {
      return sendError(res, 400, ErrorCodes.VALIDATION_ERROR, 'catalogs must be an array');
    }
    if (
      preferences !== undefined &&
      (typeof preferences !== 'object' || preferences === null || Array.isArray(preferences))
    ) {
      return sendError(res, 400, ErrorCodes.VALIDATION_ERROR, 'preferences must be an object');
    }
    if (configName !== undefined && typeof configName !== 'string') {
      return sendError(res, 400, ErrorCodes.VALIDATION_ERROR, 'configName must be a string');
    }
    if (typeof configName === 'string' && configName.length > 200) {
      return sendError(
        res,
        400,
        ErrorCodes.VALIDATION_ERROR,
        'configName must be 200 characters or less'
      );
    }

    const apiKey = getApiKey(req);

    log.info('Create config request', { catalogCount: catalogs?.length || 0 });

    const newUserId = nanoid(10);

    const savedConfig = await saveUserConfig({
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
      configName: savedConfig.configName || '',
      catalogs: savedConfig.catalogs || [],
      preferences: savedConfig.preferences || {},
      installUrl: manifestUrl,
      stremioUrl: `stremio://${host}/${newUserId}/manifest.json`,
      configureUrl: `${baseUrl}/configure/${newUserId}`,
    };

    log.info('Config created', { userId: newUserId, catalogCount: response.catalogs.length });
    res.json(response);
  } catch (error) {
    log.error('POST /config error', { error: (error as Error).message });
    const message = safeErrorMessage(error as Error);
    if (
      (error as Error).message.includes('Invalid artwork API key') ||
      (error as Error).message.includes('Invalid TMDB API key format')
    ) {
      return sendError(res, 400, ErrorCodes.VALIDATION_ERROR, message);
    }
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, safeErrorMessage(error as Error));
  }
});

router.get('/config/:userId', requireAuth, requireConfigOwnership, async (req, res) => {
  try {
    setNoCacheHeaders(res);

    const userConfig = req.config!;

    const response = {
      userId: userConfig.userId,
      configName: userConfig.configName || '',
      catalogs: userConfig.catalogs || [],
      preferences: userConfig.preferences || {},
      hasApiKey: !!userConfig.tmdbApiKeyEncrypted,
    };

    log.debug('Returning config', {
      userId: userConfig.userId,
      catalogCount: response.catalogs.length,
    });
    res.json(response);
  } catch (error) {
    log.error('GET /config/:userId error', { error: (error as Error).message });
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, safeErrorMessage(error as Error));
  }
});

router.put(
  '/config/:userId',
  requireAuth,
  requireConfigOwnership,
  strictRateLimit,
  async (req, res) => {
    try {
      const userId = req.params.userId as string;
      const { catalogs, preferences, configName } = req.body;

      if (catalogs !== undefined && !Array.isArray(catalogs)) {
        return sendError(res, 400, ErrorCodes.VALIDATION_ERROR, 'catalogs must be an array');
      }
      if (
        preferences !== undefined &&
        (typeof preferences !== 'object' || preferences === null || Array.isArray(preferences))
      ) {
        return sendError(res, 400, ErrorCodes.VALIDATION_ERROR, 'preferences must be an object');
      }
      if (configName !== undefined && typeof configName !== 'string') {
        return sendError(res, 400, ErrorCodes.VALIDATION_ERROR, 'configName must be a string');
      }
      if (typeof configName === 'string' && configName.length > 200) {
        return sendError(
          res,
          400,
          ErrorCodes.VALIDATION_ERROR,
          'configName must be 200 characters or less'
        );
      }

      const apiKey = getApiKey(req);

      log.info('Update config request', { userId, catalogCount: catalogs?.length || 0 });

      const savedConfig = await saveUserConfig({
        userId,
        tmdbApiKey: apiKey,
        configName: configName || '',
        catalogs: catalogs || [],
        preferences: preferences || {},
      });

      try {
        getConfigCache().invalidate(userId);
      } catch (err) {
        logSwallowedError('api:config-cache-invalidate', err);
      }

      const baseUrl = getBaseUrl(req);
      const host = baseUrl.replace(/^https?:\/\//, '');
      const manifestUrl = `${baseUrl}/${userId}/manifest.json`;

      const response = {
        userId,
        configName: savedConfig.configName || '',
        catalogs: savedConfig.catalogs || [],
        preferences: savedConfig.preferences || {},
        installUrl: manifestUrl,
        stremioUrl: `stremio://${host}/${userId}/manifest.json`,
        configureUrl: `${baseUrl}/configure/${userId}`,
      };

      log.info('Config updated', { userId, catalogCount: response.catalogs.length });
      res.json(response);
    } catch (error) {
      log.error('PUT /config/:userId error', { error: (error as Error).message });
      const message = safeErrorMessage(error as Error);
      if (
        (error as Error).message.includes('Invalid artwork API key') ||
        (error as Error).message.includes('Invalid TMDB API key format')
      ) {
        return sendError(res, 400, ErrorCodes.VALIDATION_ERROR, message);
      }
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, safeErrorMessage(error as Error));
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
      const userId = req.params.userId as string;
      const apiKey = getApiKey(req);

      log.info('Delete config request', { userId });

      const result = await deleteUserConfig(userId, apiKey);

      log.info('Config deleted', { userId });
      res.json(result);
    } catch (error) {
      log.error('DELETE /config/:userId error', { error: (error as Error).message });

      if (
        (error as Error).message.includes('not found') ||
        (error as Error).message.includes('Access denied')
      ) {
        return sendError(res, 404, ErrorCodes.NOT_FOUND, safeErrorMessage(error as Error));
      }
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, safeErrorMessage(error as Error));
    }
  }
);

export { router as apiRouter };
