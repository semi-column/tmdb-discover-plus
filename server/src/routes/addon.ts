import { Router, type Request, type Response } from 'express';
import {
  getUserConfig,
  getApiKeyFromConfig,
  getPosterKeyFromConfig,
} from '../services/configService.ts';
import type {
  UserConfig,
  PosterOptions,
  CatalogFilters,
  TmdbResult,
  TmdbDetails,
  ContentType,
} from '../types/index.ts';
import * as tmdb from '../services/tmdb/index.ts';
import * as imdb from '../services/imdb/index.ts';
import {
  shuffleArray,
  getBaseUrl,
  normalizeGenreName,
  parseIdArray,
  setNoCacheHeaders,
} from '../utils/helpers.ts';
import { resolveDynamicDatePreset } from '../utils/dateHelpers.ts';
import { createLogger } from '../utils/logger.ts';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { addonRateLimit } from '../utils/rateLimit.ts';
import { etagMiddleware } from '../utils/etag.ts';
import { config } from '../config.ts';
import { isValidUserId, isValidContentType, sanitizeImdbFilters } from '../utils/validation.ts';
import { sendError, ErrorCodes } from '../utils/AppError.ts';

const log = createLogger('addon');

const recentErrors = new Map<string, number>();
const ERROR_DEDUP_TTL = 300_000;

function shouldLogError(userId: string, errorMsg: string): boolean {
  const key = `${userId.slice(0, 8)}:${errorMsg.slice(0, 50)}`;
  const now = Date.now();
  const last = recentErrors.get(key);
  if (last && now - last < ERROR_DEDUP_TTL) return false;
  recentErrors.set(key, now);
  if (recentErrors.size > 500) {
    for (const [k, ts] of recentErrors) {
      if (now - ts > ERROR_DEDUP_TTL) recentErrors.delete(k);
    }
  }
  return true;
}

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

import { buildManifest, enrichManifestWithGenres } from '../services/manifestService.ts';

const TMDB_PAGE_SIZE = 20;

function pickPreferredMetaLanguage(config: UserConfig | null): string {
  return config?.preferences?.defaultLanguage || 'en';
}

function buildPosterOptions(userConfig: UserConfig): PosterOptions | null {
  if (userConfig.preferences?.posterService && userConfig.preferences.posterService !== 'none') {
    const apiKey = getPosterKeyFromConfig(userConfig);
    if (!apiKey) return null;
    return {
      apiKey,
      service: userConfig.preferences.posterService,
    };
  }
  return null;
}

function getPlaceholderUrls(baseUrl: string): {
  posterPlaceholder: string;
  backdropPlaceholder: string;
} {
  const base = baseUrl.replace(/\/$/, '');
  return {
    posterPlaceholder: `${base}/placeholder-poster.svg`,
    backdropPlaceholder: `${base}/placeholder-thumbnail.svg`,
  };
}

router.get('/:userId/manifest.json', async (req, res) => {
  try {
    const { userId } = req.params;
    const config = await getUserConfig(userId);
    const baseUrl = getBaseUrl(req);

    const manifest = buildManifest(config, baseUrl);

    if (config) {
      await enrichManifestWithGenres(manifest, config);

      if (config.preferences?.shuffleCatalogs) {
        manifest.catalogs = shuffleArray(manifest.catalogs);
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        res.set('Surrogate-Control', 'no-store');
      } else {
        setNoCacheHeaders(res);
      }
    } else {
      setNoCacheHeaders(res);
    }

    res.etagJson!(manifest, { extra: userId });
  } catch (error) {
    log.error('Manifest error', { error: (error as Error).message });
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, (error as Error).message);
  }
});

function parseExtra(extraString: string | undefined): Record<string, string> {
  const params: Record<string, string> = {};
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

async function resolveGenreFilter(
  extra: Record<string, string>,
  effectiveFilters: Record<string, unknown>,
  type: string,
  apiKey: string
): Promise<void> {
  if (!extra.genre || extra.genre === 'All') return;

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

    const reverse: Record<string, string> = {};

    if (tmdbGenres && Array.isArray(tmdbGenres)) {
      tmdbGenres.forEach((g) => {
        reverse[normalizeGenreName(g.name)] = String(g.id);
      });
    } else {
      try {
        const staticGenreMap = STATIC_GENRE_MAP;
        const mapping = staticGenreMap[mediaType] || {};
        Object.entries(mapping).forEach(([id, name]) => {
          reverse[normalizeGenreName(name as string)] = String(id);
        });
      } catch (err) {
        log.warn('Could not load static genres for mapping extra.genre', {
          error: (err as Error).message,
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
    log.warn('Error mapping extra.genre to IDs', { error: (err as Error).message });
  }
}

async function enrichCatalogResults(
  allItems: TmdbResult[],
  type: string,
  apiKey: string,
  displayLanguage: string | undefined,
  isSearch: boolean
) {
  if (!isSearch) {
    try {
      await tmdb.enrichItemsWithImdbIds(apiKey, allItems, type);
    } catch (e) {
      log.warn('IMDb enrichment failed (continuing with TMDB IDs)', {
        error: (e as Error).message,
      });
    }
  }

  let genreMap: Record<string, string> | null = null;
  if (allItems.length > 0 && displayLanguage && displayLanguage !== 'en') {
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
      log.warn('Failed to fetch localized genres for catalog', {
        displayLanguage,
        error: (err as Error).message,
      });
    }
  }

  let ratingsMap = null;
  if (!isSearch) {
    try {
      ratingsMap = await tmdb.batchGetCinemetaRatings(allItems, type);
    } catch (e) {
      log.warn('Batch IMDb ratings failed', { error: (e as Error).message });
    }
  }

  return { genreMap, ratingsMap };
}

async function handleImdbCatalogRequest(
  userId: string,
  type: ContentType,
  catalogId: string,
  extra: Record<string, string>,
  res: Response,
  req: Request
) {
  const startTime = Date.now();
  try {
    if (!imdb.isImdbApiEnabled()) {
      return res.json({ metas: [] });
    }

    const skip = parseInt(extra.skip) || 0;
    const searchQuery = extra.search || null;

    const userConfig = await getUserConfig(userId);
    if (!userConfig) return res.json({ metas: [] });

    const posterOptions = buildPosterOptions(userConfig);

    if (catalogId === 'imdb-search-movie' || catalogId === 'imdb-search-series') {
      if (!searchQuery) return res.json({ metas: [] });
      const imdbTypes = type === 'series' ? ['tvSeries', 'tvMiniSeries'] : ['movie', 'tvMovie'];
      const result = await imdb.search(searchQuery, imdbTypes, 50);
      const metas = (result.titles || [])
        .map((item) => imdb.imdbToStremioMeta(item, type, posterOptions))
        .filter(Boolean);
      return res.etagJson!(
        { metas, cacheMaxAge: 300, staleRevalidate: 600 },
        { extra: `${userId}:${catalogId}:${searchQuery}` }
      );
    }

    const catalogConfig = userConfig.catalogs.find((c) => {
      const id = `imdb-${c._id || c.name.toLowerCase().replace(/\s+/g, '-')}`;
      return id === catalogId;
    });

    if (!catalogConfig) {
      log.debug('IMDb Catalog not found', {
        catalogId,
        available: userConfig.catalogs.map((c) => c.name),
      });
      return res.json({ metas: [] });
    }

    log.debug('IMDb Catalog matched', {
      name: catalogConfig.name,
      id: catalogId,
      filters: JSON.stringify(catalogConfig.filters),
    });

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
      const result = await imdb.getList(filters.imdbListId as string, skip);
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
      const result = await imdb.advancedSearch(
        searchParams as Parameters<typeof imdb.advancedSearch>[0],
        type,
        skip
      );
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
    const { posterPlaceholder } = getPlaceholderUrls(baseUrl);
    for (const m of metas) {
      if (!m) continue;
      if (!m.poster) m.poster = posterPlaceholder;
    }

    res.set('Cache-Control', 'max-age=300, stale-while-revalidate=600');
    log.debug('Returning IMDb catalog results', {
      count: metas.length,
      catalogId,
      skip,
      durationMs: Date.now() - startTime,
    });

    res.etagJson!(
      { metas, cacheMaxAge: 300, staleRevalidate: 600 },
      { extra: `${userId}:${catalogId}:${skip}` }
    );
  } catch (error) {
    log.error('IMDb catalog error', {
      catalogId,
      type,
      error: (error as Error).message,
      durationMs: Date.now() - startTime,
    });
    res.json({ metas: [] });
  }
}

async function handleCatalogRequest(
  userId: string,
  type: ContentType,
  catalogId: string,
  extra: Record<string, string>,
  res: Response,
  req: Request
) {
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

    const posterOptions = buildPosterOptions(config);

    let catalogConfig = config.catalogs.find((c) => {
      const id = `tmdb-${c._id || c.name.toLowerCase().replace(/\s+/g, '-')}`;
      return id === catalogId;
    });

    if (
      !catalogConfig &&
      (catalogId === 'tmdb-search-movie' || catalogId === 'tmdb-search-series')
    ) {
      catalogConfig = {
        _id: catalogId,
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
    const resolvedFilters = resolveDynamicDatePreset(
      effectiveFilters,
      type
    ) as CatalogFilters | null;

    const listType = resolvedFilters?.listType || catalogConfig.filters?.listType;
    const randomize = Boolean(
      resolvedFilters?.randomize ||
      catalogConfig.filters?.randomize ||
      resolvedFilters?.sortBy === 'random'
    );

    let result: { results?: unknown[] } | null = null;

    if (search) {
      if (/^tt\d{7,8}$/i.test(search.trim())) {
        try {
          const found = await tmdb.findByImdbId(apiKey, search.trim(), type, {
            language: config.preferences?.defaultLanguage,
          });
          if (found?.tmdbId) {
            const details = (await tmdb.getDetails(apiKey, found.tmdbId, type, {
              displayLanguage: config.preferences?.defaultLanguage,
            })) as TmdbDetails | null;
            if (details) {
              (details as TmdbDetails & { imdb_id?: string }).imdb_id =
                details.external_ids?.imdb_id || search.trim();
              result = { results: [details] };
            }
          }
        } catch (e) {
          log.warn('IMDb direct lookup failed, falling back to search', {
            search,
            error: (e as Error).message,
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
      result = (await tmdb.fetchSpecialList(apiKey, listType, type, {
        page,
        displayLanguage: config.preferences?.defaultLanguage,
        language: resolvedFilters?.language || catalogConfig.filters?.language,
        region: resolvedFilters?.countries || catalogConfig.filters?.countries,
        randomize,
      })) as { results?: unknown[] } | null;

      if (result?.results && effectiveFilters.genres) {
        const genreIds = new Set(
          (Array.isArray(effectiveFilters.genres)
            ? effectiveFilters.genres
            : [effectiveFilters.genres]
          )
            .map((id: unknown) => Number(id))
            .filter((id: number) => !isNaN(id))
        );
        if (genreIds.size > 0) {
          result.results = result.results.filter((item: unknown) => {
            const ids = (item as { genre_ids?: number[] }).genre_ids;
            if (!Array.isArray(ids)) return true;
            return ids.some((gid: number) => genreIds.has(gid));
          });
        }
      }
    } else {
      result = (await tmdb.discover(apiKey, {
        type,
        ...(resolvedFilters as Record<string, unknown>),
        displayLanguage: config.preferences?.defaultLanguage,
        page,
        randomize,
      })) as { results?: unknown[] } | null;
    }

    const allItems = (result?.results || []) as TmdbResult[];
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
    const { posterPlaceholder } = getPlaceholderUrls(baseUrl);
    for (const m of metas) {
      if (!m) continue;
      if (!m.poster) m.poster = posterPlaceholder;
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

    res.etagJson!(
      {
        metas: filteredMetas,
        cacheMaxAge: randomize ? 0 : 300,
        staleRevalidate: randomize ? 0 : 600,
      },
      { extra: `${userId}:${catalogId}:${skip}` }
    );
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errMsg = (error as Error).message;
    if (shouldLogError(userId, errMsg)) {
      log.error('Catalog error', {
        catalogId,
        type,
        userIdPrefix: userId.slice(0, 8),
        error: errMsg,
        durationMs,
        isTimeout: (error as Error).name === 'AbortError',
        code: (error as Error & { code?: string }).code || 'CATALOG_FETCH_ERROR',
      });
    }
    res.json({ metas: [] });
  }
}

async function handleMetaRequest(
  userId: string,
  type: ContentType,
  id: string,
  extra: Record<string, string>,
  res: Response,
  req: Request
) {
  if ((type as string) === 'tv') type = 'series';
  const startTime = Date.now();
  try {
    const config = await getUserConfig(userId);
    if (!config) return res.json({ meta: {} });

    const apiKey = getApiKeyFromConfig(config);
    if (!apiKey) return res.json({ meta: {} });

    const posterOptions = buildPosterOptions(config);

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
          return res.etagJson!(
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

    const details = (await tmdb.getDetails(apiKey, tmdbId, type, {
      language,
    })) as TmdbDetails | null;
    const detailsImdb = details?.external_ids?.imdb_id || null;
    imdbId = imdbId || detailsImdb;

    let videos = null;
    const hasLogos = (details?.images?.logos?.length ?? 0) > 0;
    const [episodesResult, allLogos] = await Promise.all([
      type === 'series'
        ? tmdb.getSeriesEpisodes(apiKey, tmdbId, details as TmdbDetails, { language })
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
        .map(
          (c) => `tmdb-${c._id || (c.name || 'catalog').toLowerCase().replace(/\s+/g, '-')}`
        )[0] || null;

    let userRegion = config.preferences?.region || config.preferences?.countries || null;

    if (!userRegion && Array.isArray(config.catalogs)) {
      const certCatalog = config.catalogs.find(
        (c) => c.filters?.certificationCountry && c.filters.certificationCountry !== 'US'
      );
      if (certCatalog) {
        userRegion = certCatalog.filters.certificationCountry ?? null;
      } else {
        const originCatalog = config.catalogs.find((c) => c.filters?.countries);
        if (originCatalog) {
          userRegion = originCatalog.filters.countries ?? null;
        }
      }
    }

    // Normalize userRegion: .lean() bypasses Mongoose coercion so the value may be an array
    if (userRegion && typeof userRegion !== 'string') {
      userRegion = Array.isArray(userRegion) ? String(userRegion[0]) : String(userRegion);
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
    const { posterPlaceholder, backdropPlaceholder } = getPlaceholderUrls(resolvedBaseUrl);
    if (meta && !meta.poster) meta.poster = posterPlaceholder;
    if (meta?.videos) {
      for (const v of meta.videos) {
        if (!v.thumbnail) v.thumbnail = backdropPlaceholder;
      }
    }

    res.etagJson!(
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
    const errMsg = (error as Error).message;
    if (shouldLogError(userId, errMsg)) {
      log.error('Meta error', {
        id,
        type,
        userIdPrefix: userId.slice(0, 8),
        error: errMsg,
        durationMs,
        isTimeout: (error as Error).name === 'AbortError',
        code: (error as Error & { code?: string }).code || 'META_FETCH_ERROR',
      });
    }
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
  await handleMetaRequest(userId, type as ContentType, id, extraParams, res, req);
});

router.get('/:userId/meta/:type/:id.json', async (req, res) => {
  const { userId, type, id } = req.params;
  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.query)) {
    if (typeof v === 'string') extra[k] = v;
  }
  await handleMetaRequest(userId, type as ContentType, id, extra, res, req);
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
  await handleCatalogRequest(userId, type as ContentType, catalogId, extraParams, res, req);
});

router.get('/:userId/catalog/:type/:catalogId.json', async (req, res) => {
  const { userId, type, catalogId } = req.params;
  const extra: Record<string, string> = {
    skip: String(req.query.skip || '0'),
    search: String(req.query.search || ''),
  };
  await handleCatalogRequest(userId, type as ContentType, catalogId, extra, res, req);
});

export { router as addonRouter };
