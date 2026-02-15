import { Router } from 'express';
import {
  getUserConfig,
  getApiKeyFromConfig,
  getPosterKeyFromConfig,
} from '../services/configService.js';
import * as tmdb from '../services/tmdb/index.js';
import * as imdb from '../services/imdb/index.ts';
import { shuffleArray, getBaseUrl, normalizeGenreName, parseIdArray } from '../utils/helpers.js';
import { resolveDynamicDatePreset } from '../utils/dateHelpers.js';
import { createLogger } from '../utils/logger.ts';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { addonRateLimit } from '../utils/rateLimit.js';
import { etagMiddleware } from '../utils/etag.js';
import { config } from '../config.ts';
import { isValidUserId, isValidContentType, sanitizeImdbFilters } from '../utils/validation.ts';
import { sendError, ErrorCodes } from '../utils/AppError.ts';

const log = createLogger('addon');

const __filename_addon = fileURLToPath(import.meta.url);
const __dirname_addon = path.dirname(__filename_addon);
const STATIC_GENRE_MAP = (() => {
  try {
    const genresPath = path.resolve(__dirname_addon, '..', 'data', 'tmdb_genres.json');
    return JSON.parse(fs.readFileSync(genresPath, 'utf8'));
  } catch {
    return {};
  }
})();

const router = Router();
router.use(addonRateLimit);
router.use(etagMiddleware);

router.param('userId', (req, res, next, value) => {
  if (!isValidUserId(value)) {
    return sendError(res, 400, ErrorCodes.VALIDATION_ERROR, 'Invalid user ID format');
  }
  next();
});

router.param('type', (req, res, next, value) => {
  if (!isValidContentType(value)) {
    return sendError(
      res,
      400,
      ErrorCodes.VALIDATION_ERROR,
      'Invalid content type — must be movie or series'
    );
  }
  next();
});

import { buildManifest, enrichManifestWithGenres } from '../services/manifestService.js';

const TMDB_PAGE_SIZE = 20;

function pickPreferredMetaLanguage(config) {
  return config?.preferences?.defaultLanguage || 'en';
}

router.get('/:userId/manifest.json', async (req, res) => {
  try {
    const { userId } = req.params;
    const config = await getUserConfig(userId);
    const baseUrl = getBaseUrl(req);

    const manifest = buildManifest(config || {}, baseUrl);

    if (config) {
      await enrichManifestWithGenres(manifest, config);

      if (config.preferences?.shuffleCatalogs) {
        manifest.catalogs = shuffleArray(manifest.catalogs);
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        res.set('Surrogate-Control', 'no-store');
      } else {
        res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
      }
    }

    if (!res.headersSent) {
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
    }

    res.etagJson(manifest, { extra: userId });
  } catch (error) {
    log.error('Manifest error', { error: error.message });
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, error.message);
  }
});

function parseExtra(extraString) {
  const params = {};
  if (!extraString) return params;

  const parts = extraString.split('&');
  for (const part of parts) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const key = part.substring(0, eqIdx);
    const value = part.substring(eqIdx + 1);
    if (key && value !== undefined) {
      params[key] = decodeURIComponent(value);
    }
  }
  return params;
}

function extractGenreIds(item) {
  const ids = Array.isArray(item?.genre_ids)
    ? item.genre_ids
    : Array.isArray(item?.genres)
      ? item.genres.map((g) => g?.id).filter(Boolean)
      : [];
  return ids.map(String);
}

async function resolveGenreFilter(extra, effectiveFilters, type, apiKey) {
  if (!extra.genre) return;

  try {
    const selected = String(extra.genre)
      .split(',')
      .map((s) => normalizeGenreName(s))
      .filter(Boolean);
    const mediaType = type === 'series' ? 'tv' : 'movie';

    let tmdbGenres = null;
    try {
      tmdbGenres = await tmdb.getGenres(apiKey, type);
    } catch (err) {
      tmdbGenres = null;
    }

    const reverse = {};

    if (tmdbGenres && Array.isArray(tmdbGenres)) {
      tmdbGenres.forEach((g) => {
        reverse[normalizeGenreName(g.name)] = String(g.id);
      });
    } else {
      try {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        const genresPath = path.resolve(__dirname, '..', 'data', 'tmdb_genres.json');
        const staticGenreMap = STATIC_GENRE_MAP;
        const mapping = staticGenreMap[mediaType] || {};
        Object.entries(mapping).forEach(([id, name]) => {
          reverse[normalizeGenreName(name)] = String(id);
        });
      } catch (err) {
        log.warn('Could not load static genres for mapping extra.genre', {
          error: err.message,
        });
      }
    }

    let genreIds = selected.map((name) => reverse[name]).filter(Boolean);

    if (genreIds.length === 0 && Object.keys(reverse).length > 0) {
      const fuzzyMatches = [];
      for (const sel of selected) {
        let found = null;
        if (reverse[sel]) found = reverse[sel];

        if (!found) {
          for (const k of Object.keys(reverse)) {
            if (k.includes(sel) || sel.includes(k)) {
              found = reverse[k];
              break;
            }
          }
        }

        if (!found) {
          const parts = sel.split(' ').filter(Boolean);
          if (parts.length > 0) {
            for (const k of Object.keys(reverse)) {
              const hasAll = parts.every((p) => k.includes(p));
              if (hasAll) {
                found = reverse[k];
                break;
              }
            }
          }
        }

        if (found) {
          fuzzyMatches.push({ selected: sel, matchedId: found });
          genreIds.push(found);
        }
      }
      if (fuzzyMatches.length > 0) {
        log.debug('Fuzzy genre matches applied', { count: fuzzyMatches.length });
      }
    }

    if (genreIds.length > 0) {
      effectiveFilters.genres = genreIds;
      log.debug('Genre filter applied', { genreCount: genreIds.length });
    } else {
      log.debug('No genre mapping found, using stored filters', { selected });
    }
  } catch (err) {
    log.warn('Error mapping extra.genre to IDs', { error: err.message });
  }
}

async function enrichCatalogResults(allItems, type, apiKey, displayLanguage, isSearch) {
  if (!isSearch) {
    try {
      await tmdb.enrichItemsWithImdbIds(apiKey, allItems, type);
    } catch (e) {
      log.warn('IMDb enrichment failed (continuing with TMDB IDs)', { error: e.message });
    }
  }

  let genreMap = null;
  if (allItems.length > 0 && displayLanguage && displayLanguage !== 'en') {
    try {
      const localizedGenres = await tmdb.getGenres(apiKey, type, displayLanguage);
      if (Array.isArray(localizedGenres)) {
        genreMap = {};
        localizedGenres.forEach((g) => {
          genreMap[String(g.id)] = g.name;
        });
      }
    } catch (err) {
      log.warn('Failed to fetch localized genres for catalog', {
        displayLanguage,
        error: err.message,
      });
    }
  }

  let ratingsMap = null;
  if (!isSearch) {
    try {
      ratingsMap = await tmdb.batchGetCinemetaRatings(allItems, type);
    } catch (e) {
      log.warn('Batch IMDb ratings failed', { error: e.message });
    }
  }

  return { genreMap, ratingsMap };
}

async function handleImdbCatalogRequest(userId, type, catalogId, extra, res, req) {
  const startTime = Date.now();
  try {
    if (!imdb.isImdbApiEnabled()) {
      return res.json({ metas: [] });
    }

    const skip = parseInt(extra.skip) || 0;
    const searchQuery = extra.search || null;

    const userConfig = await getUserConfig(userId);
    if (!userConfig) return res.json({ metas: [] });

    const posterOptions =
      userConfig.preferences?.posterService && userConfig.preferences.posterService !== 'none'
        ? {
            apiKey: getPosterKeyFromConfig(userConfig),
            service: userConfig.preferences.posterService,
          }
        : null;

    if (catalogId === 'imdb-search-movie' || catalogId === 'imdb-search-series') {
      if (!searchQuery) return res.json({ metas: [] });
      const imdbTypes = type === 'series' ? ['tvSeries', 'tvMiniSeries'] : ['movie', 'tvMovie'];
      const result = await imdb.search(searchQuery, imdbTypes, 50);
      const metas = (result.titles || [])
        .map((item) => imdb.imdbToStremioMeta(item, type, posterOptions))
        .filter(Boolean);
      return res.etagJson(
        { metas, cacheMaxAge: 300, staleRevalidate: 600 },
        { extra: `${userId}:${catalogId}:${searchQuery}` }
      );
    }

    const catalogConfig = userConfig.catalogs.find((c) => {
      const id = `imdb-${c._id || c.name.toLowerCase().replace(/\s+/g, '-')}`;
      return id === catalogId;
    });

    if (!catalogConfig) return res.json({ metas: [] });

    const filters = sanitizeImdbFilters(catalogConfig.filters || {});
    const listType = filters.listType || 'discover';
    let titles = [];

    const effectiveFilters = { ...filters };
    if (extra.genre && extra.genre !== 'All') {
      effectiveFilters.genres = [extra.genre];
    }

    if (listType === 'top250') {
      const result = await imdb.getTopRanking(type);
      titles = (result.titles || []).slice(skip, skip + 100);
    } else if (listType === 'popular') {
      const result = await imdb.getPopular(type);
      titles = (result.titles || []).slice(skip, skip + 100);
    } else if (listType === 'imdb_list' && filters.imdbListId) {
      const result = await imdb.getList(filters.imdbListId, skip);
      titles = result.titles || [];
    } else {
      const searchParams = {
        query: effectiveFilters.query,
        types: effectiveFilters.types,
        genres: effectiveFilters.genres,
        sortBy: effectiveFilters.sortBy || 'POPULARITY',
        sortOrder: effectiveFilters.sortOrder || 'ASC',
        imdbRatingMin: effectiveFilters.imdbRatingMin,
        totalVotesMin: effectiveFilters.totalVotesMin,
        releaseDateStart: effectiveFilters.releaseDateStart,
        releaseDateEnd: effectiveFilters.releaseDateEnd,
        runtimeMin: effectiveFilters.runtimeMin,
        runtimeMax: effectiveFilters.runtimeMax,
        languages: effectiveFilters.languages,
        countries: effectiveFilters.countries,
        keywords: effectiveFilters.keywords,
        awardsWon: effectiveFilters.awardsWon,
        awardsNominated: effectiveFilters.awardsNominated,
      };
      const result = await imdb.advancedSearch(searchParams, type, skip);
      titles = result.titles || [];
    }

    const catalogPosterOverride = catalogConfig.filters?.enableRatingPosters;
    const effectivePosterOptions =
      catalogPosterOverride === true
        ? posterOptions || null
        : catalogPosterOverride === false
          ? null
          : posterOptions;

    const metas = titles
      .map((item) => imdb.imdbToStremioMeta(item, type, effectivePosterOptions))
      .filter(Boolean);

    const baseUrl = (userConfig.baseUrl || getBaseUrl(req)).replace(/\/$/, '');
    for (const m of metas) {
      if (!m) continue;
      if (!m.poster) m.poster = `${baseUrl}/placeholder-poster.svg`;
    }

    res.set('Cache-Control', 'max-age=300, stale-while-revalidate=600');
    log.debug('Returning IMDb catalog results', {
      count: metas.length,
      catalogId,
      skip,
      durationMs: Date.now() - startTime,
    });

    res.etagJson(
      { metas, cacheMaxAge: 300, staleRevalidate: 600 },
      { extra: `${userId}:${catalogId}:${skip}` }
    );
  } catch (error) {
    log.error('IMDb catalog error', {
      catalogId,
      type,
      error: error.message,
      durationMs: Date.now() - startTime,
    });
    res.json({ metas: [] });
  }
}

async function handleCatalogRequest(userId, type, catalogId, extra, res, req) {
  if (catalogId.startsWith('imdb-')) {
    return handleImdbCatalogRequest(userId, type, catalogId, extra, res, req);
  }

  const startTime = Date.now();
  try {
    const skip = parseInt(extra.skip) || 0;
    const search = extra.search || null;

    const page = Math.floor(skip / TMDB_PAGE_SIZE) + 1;

    log.debug('Catalog request', { catalogId, skip, page, extra });

    const config = await getUserConfig(userId);
    if (!config) {
      log.debug('No config found', { userId });
      return res.json({ metas: [] });
    }

    const apiKey = getApiKeyFromConfig(config);
    if (!apiKey) {
      log.debug('No API key found for config', { userId });
      return res.json({ metas: [] });
    }

    const posterOptions =
      config.preferences?.posterService && config.preferences.posterService !== 'none'
        ? {
            apiKey: getPosterKeyFromConfig(config),
            service: config.preferences.posterService,
          }
        : null;

    let catalogConfig = config.catalogs.find((c) => {
      const id = `tmdb-${c._id || c.name.toLowerCase().replace(/\s+/g, '-')}`;
      return id === catalogId;
    });

    if (
      !catalogConfig &&
      (catalogId === 'tmdb-search-movie' || catalogId === 'tmdb-search-series')
    ) {
      catalogConfig = {
        name: 'TMDB Search',
        type: catalogId === 'tmdb-search-movie' ? 'movie' : 'series',
        filters: {},
      };
    }

    if (!catalogConfig) {
      log.debug('Catalog not found', { catalogId });
      return res.json({ metas: [] });
    }

    const effectiveFilters = { ...(catalogConfig.filters || {}) };
    await resolveGenreFilter(extra, effectiveFilters, type, apiKey);
    const resolvedFilters = resolveDynamicDatePreset(effectiveFilters, type);

    const listType = resolvedFilters?.listType || catalogConfig.filters?.listType;
    const randomize =
      resolvedFilters?.randomize ||
      catalogConfig.filters?.randomize ||
      resolvedFilters?.sortBy === 'random';

    let result = null;

    if (search) {
      if (/^tt\d{7,8}$/i.test(search.trim())) {
        try {
          const found = await tmdb.findByImdbId(apiKey, search.trim(), type, {
            language: config.preferences?.defaultLanguage,
          });
          if (found?.tmdbId) {
            const details = await tmdb.getDetails(apiKey, found.tmdbId, type, {
              displayLanguage: config.preferences?.defaultLanguage,
            });
            if (details) {
              details.imdb_id = details.external_ids?.imdb_id || search.trim();
              result = { results: [details] };
            }
          }
        } catch (e) {
          log.warn('IMDb direct lookup failed, falling back to search', {
            search,
            error: e.message,
          });
        }
      }

      if (!result) {
        result = await tmdb.comprehensiveSearch(apiKey, search, type, page, {
          displayLanguage: config.preferences?.defaultLanguage,
          includeAdult: config.preferences?.includeAdult,
        });
      }
    } else if (listType && listType !== 'discover') {
      result = await tmdb.fetchSpecialList(apiKey, listType, type, {
        page,
        displayLanguage: config.preferences?.defaultLanguage,
        language: resolvedFilters?.language || catalogConfig.filters?.language,
        region: resolvedFilters?.originCountry || catalogConfig.filters?.originCountry,
        randomize,
      });
    } else {
      result = await tmdb.discover(apiKey, {
        type,
        ...resolvedFilters,
        displayLanguage: config.preferences?.defaultLanguage,
        page,
        randomize,
      });
    }

    const allItems = result?.results || [];
    const displayLanguage = config.preferences?.defaultLanguage;

    const catalogPosterOverride = catalogConfig.filters?.enableRatingPosters;
    const effectivePosterOptions =
      catalogPosterOverride === true
        ? posterOptions || null
        : catalogPosterOverride === false
          ? null
          : posterOptions;

    const { genreMap, ratingsMap } = await enrichCatalogResults(
      allItems,
      type,
      apiKey,
      displayLanguage,
      !!search
    );

    const metas = allItems.map((item) => {
      return tmdb.toStremioMeta(item, type, null, effectivePosterOptions, genreMap, ratingsMap);
    });

    const baseUrl = (config.baseUrl || getBaseUrl(req)).replace(/\/$/, '');
    for (const m of metas) {
      if (!m) continue;
      if (!m.poster) m.poster = `${baseUrl}/placeholder-poster.svg`;
    }

    const filteredMetas = metas.filter((m) => m !== null);

    if (randomize) {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
      res.set('Surrogate-Control', 'no-store');
    } else {
      res.set('Cache-Control', 'max-age=300, stale-while-revalidate=600');
    }

    log.debug('Returning catalog results', {
      count: filteredMetas.length,
      page,
      skip,
      randomize,
      cacheHeader: res.get('Cache-Control'),
      durationMs: Date.now() - startTime,
    });

    res.etagJson(
      {
        metas: filteredMetas,
        cacheMaxAge: randomize ? 0 : 300,
        staleRevalidate: randomize ? 0 : 600,
      },
      { extra: `${userId}:${catalogId}:${skip}` }
    );
  } catch (error) {
    const durationMs = Date.now() - startTime;
    log.error('Catalog error', {
      catalogId,
      type,
      error: error.message,
      durationMs,
      isTimeout: error.name === 'AbortError',
      code: error.code || 'CATALOG_FETCH_ERROR',
    });
    res.json({ metas: [] });
  }
}

async function handleMetaRequest(userId, type, id, extra, res, req) {
  const startTime = Date.now();
  try {
    const config = await getUserConfig(userId);
    if (!config) return res.json({ meta: {} });

    const apiKey = getApiKeyFromConfig(config);
    if (!apiKey) return res.json({ meta: {} });

    // Get poster service configuration
    const posterOptions =
      config.preferences?.posterService && config.preferences.posterService !== 'none'
        ? {
            apiKey: getPosterKeyFromConfig(config),
            service: config.preferences.posterService,
          }
        : null;

    const requestedId = String(id || '');
    const configuredLanguage = pickPreferredMetaLanguage(config);
    const language = extra?.displayLanguage || configuredLanguage || extra?.language || 'en';

    log.debug('Meta language resolution', {
      configured: configuredLanguage,
      extraDisplay: extra?.displayLanguage,
      extraLang: extra?.language,
      final: language,
    });

    let tmdbId = null;
    let imdbId = null;

    if (/^tt\d+/i.test(requestedId)) {
      imdbId = requestedId;
      const found = await tmdb.findByImdbId(apiKey, imdbId, type, { language });
      tmdbId = found?.tmdbId || null;

      if (!tmdbId && imdb.isImdbApiEnabled()) {
        const imdbDetail = await imdb.getTitle(imdbId);
        if (imdbDetail) {
          const meta = imdb.imdbToStremioFullMeta(imdbDetail, type, posterOptions);
          return res.etagJson(
            { meta, cacheMaxAge: 3600, staleRevalidate: 86400, staleError: 86400 },
            { extra: `${userId}:${id}` }
          );
        }
      }
    } else if (requestedId.startsWith('tmdb:')) {
      tmdbId = Number(requestedId.replace('tmdb:', ''));
    } else if (/^\d+$/.test(requestedId)) {
      tmdbId = Number(requestedId);
    }

    if (!tmdbId) return res.json({ meta: {} });

    const details = await tmdb.getDetails(apiKey, tmdbId, type, { language });
    const detailsImdb = details?.external_ids?.imdb_id || null;
    imdbId = imdbId || detailsImdb;

    let videos = null;
    const hasLogos = details?.images?.logos?.length > 0;
    const [episodesResult, allLogos] = await Promise.all([
      type === 'series'
        ? tmdb.getSeriesEpisodes(apiKey, tmdbId, details, { language })
        : Promise.resolve(null),
      !hasLogos ? tmdb.getLogos(apiKey, tmdbId, type) : Promise.resolve(null),
    ]);
    videos = episodesResult;
    if (videos) {
      log.debug('Fetched series episodes', { tmdbId, episodeCount: videos?.length || 0 });
    }

    // Build the manifest URL for genre deep-links
    const baseUrl = getBaseUrl(req);
    const manifestUrl = `${baseUrl}/${userId}/manifest.json`;

    // Find the first user catalog of this type that has genre support for deep-linking
    const genreCatalogId =
      (config.catalogs || [])
        .filter((c) => c.enabled !== false && (c.type === type || (!c.type && type === 'movie')))
        .map((c) => `tmdb-${c._id || c.name.toLowerCase().replace(/\s+/g, '-')}`)[0] || null;

    let userRegion = config.preferences?.region || config.preferences?.originCountry || null;

    if (!userRegion && Array.isArray(config.catalogs)) {
      const certCatalog = config.catalogs.find(
        (c) => c.filters?.certificationCountry && c.filters.certificationCountry !== 'US'
      );
      if (certCatalog) {
        userRegion = certCatalog.filters.certificationCountry;
      } else {
        const originCatalog = config.catalogs.find((c) => c.filters?.originCountry);
        if (originCatalog) {
          userRegion = originCatalog.filters.originCountry;
        }
      }
    }

    const meta = await tmdb.toStremioFullMeta(
      details,
      type,
      imdbId,
      requestedId,
      posterOptions,
      videos,
      language,
      { manifestUrl, genreCatalogId, allLogos, userRegion }
    );

    // Apply fallback images for missing poster/thumbnail
    const resolvedBaseUrl = (config.baseUrl || baseUrl).replace(/\/$/, '');
    if (meta && !meta.poster) meta.poster = `${resolvedBaseUrl}/placeholder-poster.svg`;
    if (meta?.videos) {
      for (const v of meta.videos) {
        if (!v.thumbnail) v.thumbnail = `${resolvedBaseUrl}/placeholder-thumbnail.svg`;
      }
    }

    res.etagJson(
      {
        meta,
        cacheMaxAge: 3600,
        staleRevalidate: 86400,
        staleError: 86400,
      },
      { extra: `${userId}:${id}` }
    );
  } catch (error) {
    const durationMs = Date.now() - startTime;
    log.error('Meta error', {
      id,
      type,
      error: error.message,
      durationMs,
      isTimeout: error.name === 'AbortError',
      code: error.code || 'META_FETCH_ERROR',
    });
    res.json({ meta: {} });
  }
}

router.get('/:userId/meta/:type/:id/:extra.json', async (req, res) => {
  const { userId, type, id } = req.params;
  const original = req.originalUrl || req.url || '';
  let rawExtra = req.params.extra || '';
  try {
    const splitMarker = `/${id}/`;
    const parts = original.split(splitMarker);
    if (parts.length > 1) {
      let after = parts[1];
      const qIdx = after.indexOf('?');
      if (qIdx !== -1) after = after.substring(0, qIdx);
      const jsonIdx = after.indexOf('.json');
      if (jsonIdx !== -1) after = after.substring(0, jsonIdx);
      rawExtra = after;
    }
  } catch {
    rawExtra = req.params.extra || '';
  }

  const extraParams = parseExtra(rawExtra);
  await handleMetaRequest(userId, type, id, extraParams, res, req);
});

router.get('/:userId/meta/:type/:id.json', async (req, res) => {
  const { userId, type, id } = req.params;
  await handleMetaRequest(userId, type, id, { ...req.query }, res, req);
});

router.get('/:userId/catalog/:type/:catalogId/:extra.json', async (req, res) => {
  const { userId, type, catalogId } = req.params;
  const original = req.originalUrl || req.url || '';
  let rawExtra = req.params.extra || '';
  try {
    const splitMarker = `/${catalogId}/`;
    const parts = original.split(splitMarker);
    if (parts.length > 1) {
      let after = parts[1];
      const qIdx = after.indexOf('?');
      if (qIdx !== -1) after = after.substring(0, qIdx);
      const jsonIdx = after.indexOf('.json');
      if (jsonIdx !== -1) after = after.substring(0, jsonIdx);
      rawExtra = after;
    }
  } catch (err) {
    rawExtra = req.params.extra || '';
  }

  const extraParams = parseExtra(rawExtra);
  await handleCatalogRequest(userId, type, catalogId, extraParams, res, req);
});

router.get('/:userId/catalog/:type/:catalogId.json', async (req, res) => {
  const { userId, type, catalogId } = req.params;
  const extra = {
    skip: req.query.skip || '0',
    search: req.query.search || null,
  };
  await handleCatalogRequest(userId, type, catalogId, extra, res, req);
});

export { router as addonRouter };
