import { Router, type Request, type Response } from 'express';
import { getUserConfig, getApiKeyFromConfig } from '../services/configService.ts';
import type {
  UserConfig,
  ArtworkOptions,
  CatalogFilters,
  TmdbResult,
  TmdbDetails,
  ContentType,
  StremioMeta,
  StremioMetaPreview,
} from '../types/index.ts';
import type { ImdbTitle } from '../services/imdb/types.ts';
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
import { SORT_OPTIONS } from '../services/tmdb/referenceData.ts';
import { createLogger } from '../utils/logger.ts';
import crypto from 'crypto';
import {
  buildImdbEnrichmentCacheKey,
  buildArtworkIntegrationScope,
} from '../services/imdb/cacheKey.ts';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { etagMiddleware } from '../utils/etag.ts';
import { CachedError } from '../services/cache/CacheWrapper.ts';
import { getCache } from '../services/cache/index.ts';
import {
  isValidUserId,
  isValidContentType,
  sanitizeImdbFilters,
  sanitizeFiltersForSource,
} from '../utils/validation.ts';
import { buildCatalogExtraFromQuery, isNoSelectionGenre } from '../utils/catalogExtras.ts';
import { sendError, ErrorCodes } from '../utils/AppError.ts';
import {
  CACHE_TTLS,
  DISPLAY,
  ERROR_DEDUP,
  normalizeBaseUrl,
  buildCatalogId,
  catalogServerTtl,
} from '../constants.ts';
import { logSwallowedError } from '../utils/helpers.ts';
import { handleAnilistCatalogRequest } from './handlers/anilistHandler.ts';
import { handleMalCatalogRequest } from './handlers/malHandler.ts';
import { handleKitsuCatalogRequest } from './handlers/kitsuHandler.ts';
import { handleSimklCatalogRequest } from './handlers/simklHandler.ts';
import { handleTraktCatalogRequest } from './handlers/traktHandler.ts';
import { getEntryByPrefixedId } from '../services/animeIdMap/index.ts';
import { resolveRequestedMetaId } from '../utils/metaIdResolution.ts';
import { decrypt } from '../utils/encryption.ts';
import {
  createArtworkOptions,
  resolveContentType,
  applyArtworkOverrides,
  applyArtworkOverridesToMetaPreviews,
  requiresAsyncArtworkResolution,
} from '../services/artworkService.ts';

const log = createLogger('addon');

const recentErrors = new Map<string, number>();
const ERROR_DEDUP_TTL = ERROR_DEDUP.TTL_MS;

const recentErrorsCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [k, ts] of recentErrors) {
    if (now - ts > ERROR_DEDUP_TTL) recentErrors.delete(k);
  }
}, 60_000);
recentErrorsCleanupTimer.unref();

function shouldLogError(userId: string, errorMsg: string): boolean {
  const key = `${userId.slice(0, 8)}:${errorMsg.slice(0, 50)}`;
  const now = Date.now();
  const last = recentErrors.get(key);
  if (last && now - last < ERROR_DEDUP_TTL) return false;
  recentErrors.set(key, now);
  if (recentErrors.size > ERROR_DEDUP.MAX_SIZE) {
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
  } catch (err) {
    logSwallowedError('addon:static-genre-map-load', err);
    return {};
  }
})();

const router = Router();
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
      'Invalid content type — must be movie, series, or anime'
    );
  }
  next();
});

import {
  buildManifest,
  enrichManifestWithGenres,
  enrichManifestWithExtras,
} from '../services/manifestService.ts';

const TMDB_PAGE_SIZE = DISPLAY.TMDB_PAGE_SIZE;
const IMDB_PAGE_SIZE = DISPLAY.IMDB_PAGE_SIZE;

function pickPreferredMetaLanguage(config: UserConfig | null): string {
  return config?.preferences?.defaultLanguage || 'en';
}

function buildArtworkOptions(
  userConfig: UserConfig,
  type?: ContentType,
  source?: string
): ArtworkOptions {
  return createArtworkOptions(
    userConfig.preferences || null,
    (encrypted) => {
      try {
        return decrypt(encrypted);
      } catch {
        return null;
      }
    },
    resolveContentType(type || 'movie', source)
  );
}

function getPlaceholderUrls(baseUrl: string): {
  posterPlaceholder: string;
  backdropPlaceholder: string;
} {
  const base = normalizeBaseUrl(baseUrl);
  return {
    posterPlaceholder: `${base}/placeholder-poster.svg`,
    backdropPlaceholder: `${base}/placeholder-thumbnail.svg`,
  };
}

function buildMetaCacheKey(payload: Record<string, unknown>): string {
  const digest = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return `meta:full:${digest}`;
}

router.get('/:userId/manifest.json', async (req, res) => {
  try {
    const { userId } = req.params;
    const config = await getUserConfig(userId);
    const baseUrl = getBaseUrl(req);

    const manifest = buildManifest(config, baseUrl);

    if (config) {
      await enrichManifestWithGenres(manifest, config);
      await enrichManifestWithExtras(manifest, config);

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

    res.etagJson(manifest, { extra: userId });
  } catch (error) {
    log.error('Manifest error', { error: (error as Error).message });
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, (error as Error).message);
  }
});

function parseExtra(extraString: string | undefined): Record<string, string> {
  if (!extraString) return {};
  const params = new URLSearchParams(extraString);
  const result: Record<string, string> = {};
  for (const [key, value] of params) {
    result[key] = value;
  }
  return result;
}

async function resolveGenreFilter(
  extra: Record<string, string>,
  effectiveFilters: Record<string, unknown>,
  type: string,
  apiKey: string
): Promise<void> {
  if (isNoSelectionGenre(extra.genre)) return;

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

function resolveStremioExtras(
  extra: Record<string, string>,
  effectiveFilters: Record<string, unknown>,
  type: string,
  dropdownMode: 'genre' | 'year' | 'sortBy' | 'certification'
): void {
  const dropdownValue = extra.genre;

  if (dropdownMode === 'year' && !isNoSelectionGenre(dropdownValue)) {
    const year = parseInt(dropdownValue, 10);
    if (!isNaN(year)) {
      const isMovie = type === 'movie';
      effectiveFilters[isMovie ? 'releaseDateFrom' : 'airDateFrom'] = `${year}-01-01`;
      effectiveFilters[isMovie ? 'releaseDateTo' : 'airDateTo'] = `${year}-12-31`;
      delete effectiveFilters.datePreset;
      delete effectiveFilters.lastXYears;
    }
  }

  if (dropdownMode === 'sortBy' && !isNoSelectionGenre(dropdownValue)) {
    const catalogType = type === 'series' ? 'series' : 'movie';
    const sortOpts = SORT_OPTIONS[catalogType] || SORT_OPTIONS.movie;
    const match = sortOpts.find((s) => s.label === dropdownValue);
    if (match) {
      effectiveFilters.sortBy = match.value;
    }
  }

  if (dropdownMode === 'certification' && !isNoSelectionGenre(dropdownValue)) {
    effectiveFilters.certification = dropdownValue;
  }

  // Backward compatibility for previously emitted multi-extra manifests
  if (!isNoSelectionGenre(extra.year)) {
    const year = parseInt(extra.year, 10);
    if (!isNaN(year)) {
      const isMovie = type === 'movie';
      effectiveFilters[isMovie ? 'releaseDateFrom' : 'airDateFrom'] = `${year}-01-01`;
      effectiveFilters[isMovie ? 'releaseDateTo' : 'airDateTo'] = `${year}-12-31`;
      delete effectiveFilters.datePreset;
      delete effectiveFilters.lastXYears;
    }
  }

  if (!isNoSelectionGenre(extra.sortBy)) {
    const catalogType = type === 'series' ? 'series' : 'movie';
    const sortOpts = SORT_OPTIONS[catalogType] || SORT_OPTIONS.movie;
    const match = sortOpts.find((s) => s.label === extra.sortBy);
    if (match) {
      effectiveFilters.sortBy = match.value;
    }
  }

  if (!isNoSelectionGenre(extra.certification)) {
    effectiveFilters.certification = extra.certification;
  }
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

    const skip = parseInt(extra.skip, 10) || 0;
    const searchQuery = extra.search || null;

    const userConfig = await getUserConfig(userId);
    if (!userConfig) return res.json({ metas: [] });

    const apiKey = getApiKeyFromConfig(userConfig);
    if (!apiKey) return res.json({ metas: [] });

    const artworkOptions = buildArtworkOptions(userConfig, type, 'imdb');
    const displayLanguage = userConfig.preferences?.defaultLanguage;
    const artworkIntegrationScope = buildArtworkIntegrationScope(artworkOptions);
    const cache = getCache();

    const computeEnrichedMetas = async (pageTitles: ImdbTitle[]): Promise<StremioMetaPreview[]> => {
      const imdbIds = pageTitles
        .map((t) => t.id)
        .filter((id): id is string => !!id && /^tt\d+$/.test(id));

      const { resolvedIds, detailsMap } = await tmdb.batchResolveAndFetchDetails(
        apiKey,
        imdbIds,
        type,
        { displayLanguage },
        { language: displayLanguage }
      );

      const detailsForRatings = Array.from(detailsMap.values()).map((d) => ({
        imdb_id: (d as TmdbDetails)?.external_ids?.imdb_id || undefined,
      }));
      let ratingsMap: Map<string, string> | null = null;
      try {
        ratingsMap = await tmdb.batchGetCinemetaRatings(detailsForRatings, type);
      } catch (err) {
        logSwallowedError('addon:imdb-rating', err);
      }

      const mapped = (
        await Promise.all(
          pageTitles.map(async (title) => {
            const tmdbId = resolvedIds.get(title.id);
            if (tmdbId) {
              const details = detailsMap.get(tmdbId) as TmdbDetails | null;
              if (details) {
                return tmdb.toStremioMetaPreview(
                  details,
                  type,
                  artworkOptions,
                  displayLanguage || null,
                  ratingsMap
                );
              }
            }
            if (title.primaryTitle) {
              return imdb.imdbToStremioMeta(
                title,
                type,
                artworkOptions
              ) as StremioMetaPreview | null;
            }
            return null;
          })
        )
      ).filter((m): m is StremioMetaPreview => m !== null);

      return applyArtworkOverridesToMetaPreviews(mapped, artworkOptions);
    };

    if (catalogId === 'imdb-search-movie' || catalogId === 'imdb-search-series') {
      if (!searchQuery) return res.json({ metas: [] });
      const imdbTypes = type === 'series' ? ['tvSeries', 'tvMiniSeries'] : ['movie', 'tvMovie'];
      const searchResult = await imdb.search(searchQuery, imdbTypes, IMDB_PAGE_SIZE);
      const searchTitles = (searchResult.titles || []) as ImdbTitle[];
      const metas = await computeEnrichedMetas(searchTitles);
      const baseUrl = normalizeBaseUrl(userConfig.baseUrl || getBaseUrl(req));
      const { posterPlaceholder } = getPlaceholderUrls(baseUrl);
      for (const m of metas) {
        if (!m.poster) m.poster = posterPlaceholder;
      }
      res.set(
        'Cache-Control',
        `max-age=${CACHE_TTLS.CATALOG_HEADER}, stale-while-revalidate=${CACHE_TTLS.CATALOG_STALE_REVALIDATE}, stale-if-error=259200`
      );
      log.debug('Returning IMDb search results', {
        count: metas.length,
        catalogId,
        durationMs: Date.now() - startTime,
      });
      res.etagJson(
        {
          metas,
          cacheMaxAge: CACHE_TTLS.CATALOG_HEADER,
          staleRevalidate: CACHE_TTLS.CATALOG_STALE_REVALIDATE,
        },
        { extra: `${userId}:${catalogId}:${searchQuery}` }
      );
      return;
    }

    const catalogConfig = userConfig.catalogs.find((c) => {
      const id = buildCatalogId('imdb', c);
      return id === catalogId;
    });

    if (!catalogConfig) {
      log.debug('IMDb Catalog not found', {
        catalogId,
        available: userConfig.catalogs.map((c) => c.name),
      });
      return res.json({ metas: [] });
    }

    log.debug('IMDb Catalog matched', { name: catalogConfig.name, id: catalogId });

    const filters = sanitizeImdbFilters(
      sanitizeFiltersForSource('imdb', catalogConfig.filters || {})
    );
    const listType: string = (filters.listType as string) || 'discover';
    const effectiveFilters = { ...filters };
    if (!isNoSelectionGenre(extra.genre)) {
      effectiveFilters.genres = [extra.genre];
    }

    const isSpecialList =
      listType === 'top250' ||
      listType === 'popular' ||
      (listType === 'imdb_list' && Boolean(filters.imdbListId));

    const searchParams = !isSpecialList
      ? {
          query: effectiveFilters.query,
          types: effectiveFilters.types,
          genres: effectiveFilters.genres,
          excludeGenres: effectiveFilters.excludeGenres,
          sortBy: effectiveFilters.sortBy || 'POPULARITY',
          sortOrder: effectiveFilters.sortOrder || 'DESC',
          imdbRatingMin: effectiveFilters.imdbRatingMin,
          imdbRatingMax: effectiveFilters.imdbRatingMax,
          totalVotesMin: effectiveFilters.totalVotesMin,
          totalVotesMax: effectiveFilters.totalVotesMax,
          releaseDateStart: effectiveFilters.releaseDateStart,
          releaseDateEnd: effectiveFilters.releaseDateEnd,
          runtimeMin: effectiveFilters.runtimeMin,
          runtimeMax: effectiveFilters.runtimeMax,
          languages: effectiveFilters.languages,
          countries: effectiveFilters.countries,
          imdbCountries: effectiveFilters.imdbCountries,
          keywords: effectiveFilters.keywords,
          excludeKeywords: effectiveFilters.excludeKeywords,
          awardsWon: effectiveFilters.awardsWon,
          awardsNominated: effectiveFilters.awardsNominated,
          companies: effectiveFilters.companies,
          excludeCompanies: effectiveFilters.excludeCompanies,
          creditedNames: effectiveFilters.creditedNames,
          inTheatersLat: effectiveFilters.inTheatersLat,
          inTheatersLong: effectiveFilters.inTheatersLong,
          inTheatersRadius: effectiveFilters.inTheatersRadius,
          certificateRating: effectiveFilters.certificateRating,
          certificateCountry: effectiveFilters.certificateCountry,
          certificates: effectiveFilters.certificates,
          explicitContent: effectiveFilters.explicitContent,
          rankedList: effectiveFilters.rankedList,
          rankedLists: effectiveFilters.rankedLists,
          excludeRankedLists: effectiveFilters.excludeRankedLists,
          rankedListMaxRank: effectiveFilters.rankedListMaxRank,
          plot: effectiveFilters.plot,
          filmingLocations: effectiveFilters.filmingLocations,
          withData: effectiveFilters.withData,
        }
      : null;

    const enrichmentCacheKey = buildImdbEnrichmentCacheKey(
      type,
      listType,
      filters,
      searchParams,
      skip,
      artworkIntegrationScope,
      extra.genre || ''
    );

    const fetchAndEnrichPage = async (targetSkip: number): Promise<StremioMetaPreview[]> => {
      let pageTitles: ImdbTitle[] = [];
      if (listType === 'top250') {
        const result = await imdb.getTopRanking(type);
        pageTitles = ((result.titles || []) as ImdbTitle[]).slice(
          targetSkip,
          targetSkip + IMDB_PAGE_SIZE
        );
      } else if (listType === 'popular') {
        const result = await imdb.getPopular(type);
        pageTitles = ((result.titles || []) as ImdbTitle[]).slice(
          targetSkip,
          targetSkip + IMDB_PAGE_SIZE
        );
      } else if (listType === 'imdb_list' && filters.imdbListId) {
        const result = await imdb.getList(filters.imdbListId as string, targetSkip);
        pageTitles = (result.titles || []) as ImdbTitle[];
      } else if (searchParams) {
        const result = await imdb.advancedSearch(
          searchParams as Parameters<typeof imdb.advancedSearch>[0],
          type,
          targetSkip
        );
        pageTitles = (result.titles || []) as ImdbTitle[];
      }
      return computeEnrichedMetas(pageTitles);
    };

    const metas = (await cache.wrap(
      enrichmentCacheKey,
      () => fetchAndEnrichPage(skip),
      CACHE_TTLS.CATALOG_SERVER_DISCOVER,
      { allowStale: true }
    )) as StremioMetaPreview[];

    const baseUrl = normalizeBaseUrl(userConfig.baseUrl || getBaseUrl(req));
    const { posterPlaceholder } = getPlaceholderUrls(baseUrl);
    for (const m of metas) {
      if (!m.poster) m.poster = posterPlaceholder;
    }

    res.set(
      'Cache-Control',
      `max-age=${CACHE_TTLS.CATALOG_HEADER}, stale-while-revalidate=${CACHE_TTLS.CATALOG_STALE_REVALIDATE}, stale-if-error=259200`
    );
    log.debug('Returning IMDb catalog results', {
      count: metas.length,
      catalogId,
      skip,
      durationMs: Date.now() - startTime,
    });

    res.etagJson(
      {
        metas,
        cacheMaxAge: CACHE_TTLS.CATALOG_HEADER,
        staleRevalidate: CACHE_TTLS.CATALOG_STALE_REVALIDATE,
      },
      { extra: `${userId}:${catalogId}:${skip}` }
    );

    if (metas.length > 0 && skip % IMDB_PAGE_SIZE === 0 && imdb.isImdbApiEnabled()) {
      const nextSkip = skip + IMDB_PAGE_SIZE;
      const nextEnrichmentKey = buildImdbEnrichmentCacheKey(
        type,
        listType,
        filters,
        searchParams,
        nextSkip,
        artworkIntegrationScope,
        extra.genre || ''
      );
      cache
        .get(nextEnrichmentKey)
        .then((cached) => {
          if (cached) return;
          fetchAndEnrichPage(nextSkip)
            .then((nextMetas) =>
              cache
                .set(nextEnrichmentKey, nextMetas, CACHE_TTLS.CATALOG_SERVER_DISCOVER)
                .catch((e) => logSwallowedError('addon:imdb-prefetch-cache-set', e))
            )
            .catch((e) => logSwallowedError('addon:imdb-speculative-prefetch', e));
        })
        .catch(() => {});
    }
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

  if (catalogId.startsWith('anilist-')) {
    return handleAnilistCatalogRequest(userId, type, catalogId, extra, res, req);
  }

  if (catalogId.startsWith('mal-')) {
    return handleMalCatalogRequest(userId, type, catalogId, extra, res, req);
  }

  if (catalogId.startsWith('kitsu-')) {
    return handleKitsuCatalogRequest(userId, type, catalogId, extra, res, req);
  }

  if (catalogId.startsWith('simkl-')) {
    return handleSimklCatalogRequest(userId, type, catalogId, extra, res, req);
  }

  if (catalogId.startsWith('trakt-')) {
    return handleTraktCatalogRequest(userId, type, catalogId, extra, res, req);
  }

  const startTime = Date.now();
  try {
    const skip = parseInt(extra.skip, 10) || 0;
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

    const artworkOptions = buildArtworkOptions(config, type, 'tmdb');

    let catalogConfig = config.catalogs.find((c) => {
      const id = buildCatalogId('tmdb', c);
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

    const stremioExtraMode = (() => {
      const explicit = catalogConfig?.filters?.stremioExtraMode;
      if (
        explicit === 'genre' ||
        explicit === 'year' ||
        explicit === 'sortBy' ||
        explicit === 'certification'
      ) {
        return explicit;
      }
      const legacy = Array.isArray(catalogConfig?.filters?.stremioExtras)
        ? catalogConfig.filters.stremioExtras[0]
        : undefined;
      if (
        legacy === 'genre' ||
        legacy === 'year' ||
        legacy === 'sortBy' ||
        legacy === 'certification'
      ) {
        return legacy;
      }
      return 'genre';
    })();

    const effectiveFilters = { ...sanitizeFiltersForSource('tmdb', catalogConfig.filters || {}) };
    if (stremioExtraMode === 'genre') {
      await resolveGenreFilter(extra, effectiveFilters, type, apiKey);
    }
    resolveStremioExtras(extra, effectiveFilters, type, stremioExtraMode);
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

    const cache = getCache();
    const configVersion = config.updatedAt ? new Date(config.updatedAt).getTime() : 0;
    const catalogCacheKey = `catalog:${userId}:${catalogId}:${type}:${skip}:${extra.genre || ''}:${stremioExtraMode}:${configVersion}`;
    const serverTtl = catalogServerTtl(listType);

    const computeCatalogMetas = async (): Promise<StremioMetaPreview[]> => {
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
          collectionId: resolvedFilters?.collectionId || catalogConfig.filters?.collectionId,
          studioId: resolvedFilters?.studioId || catalogConfig.filters?.studioId,
          sortBy: resolvedFilters?.sortBy || catalogConfig.filters?.sortBy,
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

      const tmdbIds = allItems.map((item) => item.id);
      const detailsMap = await tmdb.batchGetDetails(apiKey, tmdbIds, type, { displayLanguage });

      const detailsForRatings = Array.from(detailsMap.values()).map((d) => ({
        imdb_id: (d as TmdbDetails)?.external_ids?.imdb_id || undefined,
      }));
      let ratingsMap: Map<string, string> | null = null;
      if (!search) {
        try {
          ratingsMap = await tmdb.batchGetCinemetaRatings(detailsForRatings, type);
        } catch (err) {
          logSwallowedError('addon:rating-fetch', err);
        }
      }

      const mapped = (
        await Promise.all(
          allItems.map(async (item) => {
            const details = detailsMap.get(item.id) as TmdbDetails | null;
            if (!details) return null;
            return tmdb.toStremioMetaPreview(
              details,
              type,
              artworkOptions,
              displayLanguage || null,
              ratingsMap
            );
          })
        )
      ).filter((m): m is StremioMetaPreview => m !== null);

      return applyArtworkOverridesToMetaPreviews(mapped, artworkOptions);
    };

    const metas = (
      randomize || search
        ? await computeCatalogMetas()
        : await cache.wrap(catalogCacheKey, computeCatalogMetas, serverTtl, { allowStale: true })
    ) as StremioMetaPreview[];

    const baseUrl = normalizeBaseUrl(config.baseUrl || getBaseUrl(req));
    const { posterPlaceholder } = getPlaceholderUrls(baseUrl);
    for (const m of metas) {
      if (!m.poster) m.poster = posterPlaceholder;
    }

    if (randomize) {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
      res.set('Surrogate-Control', 'no-store');
    } else {
      res.set(
        'Cache-Control',
        `max-age=${CACHE_TTLS.CATALOG_HEADER}, stale-while-revalidate=${CACHE_TTLS.CATALOG_STALE_REVALIDATE}, stale-if-error=259200`
      );
    }

    log.debug('Returning catalog results', {
      count: metas.length,
      page,
      skip,
      randomize,
      cacheHeader: res.get('Cache-Control'),
      durationMs: Date.now() - startTime,
    });

    res.etagJson(
      {
        metas,
        cacheMaxAge: randomize ? 0 : CACHE_TTLS.CATALOG_HEADER,
        staleRevalidate: randomize ? 0 : CACHE_TTLS.CATALOG_STALE_REVALIDATE,
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
  const stremioType = type;
  const tmdbType: ContentType = type === 'anime' ? 'series' : type;
  const startTime = Date.now();
  try {
    const config = await getUserConfig(userId);
    if (!config) return res.json({ meta: {} });

    const apiKey = getApiKeyFromConfig(config);
    if (!apiKey) return res.json({ meta: {} });

    const artworkOptions = buildArtworkOptions(config, type);

    const requestedId = String(id || '');
    const configuredLanguage = pickPreferredMetaLanguage(config);
    const language = extra?.displayLanguage || configuredLanguage || extra?.language || 'en';
    const baseUrl = getBaseUrl(req);
    const resolvedBaseUrl = normalizeBaseUrl(config.baseUrl || baseUrl);

    log.debug('Meta language resolution', {
      configured: configuredLanguage,
      extraDisplay: extra?.displayLanguage,
      extraLang: extra?.language,
      final: language,
    });
    const cache = getCache();
    const configVersion = config.updatedAt ? new Date(config.updatedAt).getTime() : 0;
    const artworkScope = buildArtworkIntegrationScope(artworkOptions);
    const metaCacheKey = buildMetaCacheKey({
      userId,
      type,
      requestedId,
      language,
      baseUrl: resolvedBaseUrl,
      configVersion,
      artworkScope,
    });

    const cacheEntry = await cache.getEntry(metaCacheKey);
    const cacheState = cacheEntry?.__errorType
      ? 'error'
      : cacheEntry?.__isStale
        ? 'stale'
        : cacheEntry
          ? 'hit'
          : 'miss';

    const computeMeta = async (): Promise<Partial<StremioMeta> | null> => {
      const resolvedId = resolveRequestedMetaId(requestedId, getEntryByPrefixedId);
      let tmdbId = resolvedId.tmdbId;
      let imdbId = resolvedId.imdbId;

      if (!tmdbId && resolvedId.requiresImdbLookup && imdbId) {
        const found = await tmdb.findByImdbId(apiKey, imdbId, tmdbType, { language });
        tmdbId = found?.tmdbId || null;
      }

      if (!tmdbId) return null;

      const details = (await tmdb.getDetails(apiKey, tmdbId, tmdbType, {
        language,
      })) as TmdbDetails | null;
      if (!details) return null;

      const detailsImdb = details?.external_ids?.imdb_id || null;
      imdbId = imdbId || detailsImdb;

      const hasLogos = (details?.images?.logos?.length ?? 0) > 0;
      const [episodesResult, allLogos] = await Promise.all([
        tmdbType === 'series'
          ? tmdb.getSeriesEpisodes(apiKey, tmdbId, details as TmdbDetails, {
              language,
              artworkOptions,
            })
          : Promise.resolve(null),
        !hasLogos ? tmdb.getLogos(apiKey, tmdbId, tmdbType) : Promise.resolve(null),
      ]);

      if (episodesResult) {
        log.debug('Fetched series episodes', { tmdbId, episodeCount: episodesResult.length || 0 });
      }

      const manifestUrl = `${baseUrl}/${userId}/manifest.json`;

      const genreCatalogId =
        (config.catalogs || [])
          .filter(
            (c) =>
              c.enabled !== false &&
              (c.type === stremioType || c.type === tmdbType || (!c.type && tmdbType === 'movie'))
          )
          .map((c) => buildCatalogId('tmdb', c))[0] || null;

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

      if (userRegion && typeof userRegion !== 'string') {
        userRegion = Array.isArray(userRegion) ? String(userRegion[0]) : String(userRegion);
      }

      const fullMeta = await tmdb.toStremioFullMeta(
        details,
        stremioType,
        imdbId,
        requestedId,
        artworkOptions,
        episodesResult,
        language,
        { manifestUrl, genreCatalogId, allLogos, userRegion }
      );

      if (!requiresAsyncArtworkResolution(artworkOptions)) {
        return fullMeta;
      }

      const resolvedArtwork = await applyArtworkOverrides(
        {
          tmdbId,
          imdbId,
          type: stremioType,
          language,
        },
        {
          poster: fullMeta.poster,
          backdrop: fullMeta.background,
          logo: fullMeta.logo || null,
          landscape: fullMeta.landscapePoster || fullMeta.fanart || fullMeta.background,
        },
        artworkOptions,
        { checkExistence: false }
      );

      const backdrop = resolvedArtwork.backdrop;
      const landscape = resolvedArtwork.landscape || backdrop;

      return {
        ...fullMeta,
        poster: resolvedArtwork.poster,
        background: backdrop,
        fanart: landscape,
        landscapePoster: landscape,
        logo: resolvedArtwork.logo || undefined,
      };
    };

    let meta = null as Partial<StremioMeta> | null;

    try {
      meta = (await cache.wrap(metaCacheKey, computeMeta, CACHE_TTLS.META_HEADER, {
        allowStale: true,
      })) as Partial<StremioMeta> | null;
    } catch (error) {
      if (error instanceof CachedError) {
        log.warn('Bypassing cached meta error and recomputing', {
          id: requestedId,
          type,
          cacheError: error.errorType,
        });
        await cache.del(metaCacheKey);
        meta = await computeMeta();
        if (meta) {
          await cache.set(metaCacheKey, meta, CACHE_TTLS.META_HEADER);
        }
      } else {
        throw error;
      }
    }

    const responseMeta: Partial<StremioMeta> | Record<string, never> = meta || {};
    const { posterPlaceholder, backdropPlaceholder } = getPlaceholderUrls(resolvedBaseUrl);
    if (!responseMeta.poster) responseMeta.poster = posterPlaceholder;
    if (responseMeta.videos) {
      for (const v of responseMeta.videos) {
        if (!v.thumbnail) v.thumbnail = backdropPlaceholder;
      }
    }

    log.debug('Meta response served', {
      id: requestedId,
      type,
      userIdPrefix: userId.slice(0, 8),
      language,
      cacheState,
      durationMs: Date.now() - startTime,
      hasVideos: Array.isArray(responseMeta.videos),
      videoCount: Array.isArray(responseMeta.videos) ? responseMeta.videos.length : 0,
    });

    res.set(
      'Cache-Control',
      `max-age=${CACHE_TTLS.META_HEADER}, stale-while-revalidate=${CACHE_TTLS.META_HEADER * 2}, stale-if-error=259200`
    );
    res.etagJson(
      {
        meta: responseMeta,
        cacheMaxAge: CACHE_TTLS.META_HEADER,
        staleRevalidate: CACHE_TTLS.META_HEADER * 2,
        staleError: 259200,
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

function parseAddonUrlExtra(originalUrl: string, splitId: string, fallback: string): string {
  try {
    const splitMarker = `/${splitId}/`;
    const parts = originalUrl.split(splitMarker);
    if (parts.length > 1) {
      let after = parts[1];
      const qIdx = after.indexOf('?');
      if (qIdx !== -1) after = after.substring(0, qIdx);
      const jsonIdx = after.indexOf('.json');
      if (jsonIdx !== -1) after = after.substring(0, jsonIdx);
      return after;
    }
  } catch (err) {
    logSwallowedError('addon:url-parse', err);
  }
  return fallback;
}

router.get('/:userId/meta/:type/:id/:extra.json', async (req, res) => {
  const { userId, type, id } = req.params;
  const original = req.originalUrl || req.url || '';
  const rawExtra = parseAddonUrlExtra(original, id, req.params.extra || '');

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
  const rawExtra = parseAddonUrlExtra(original, catalogId, req.params.extra || '');

  const extraParams = parseExtra(rawExtra);
  await handleCatalogRequest(userId, type as ContentType, catalogId, extraParams, res, req);
});

router.get('/:userId/catalog/:type/:catalogId.json', async (req, res) => {
  const { userId, type, catalogId } = req.params;
  const extra = buildCatalogExtraFromQuery(req.query as Record<string, unknown>);
  await handleCatalogRequest(userId, type as ContentType, catalogId, extra, res, req);
});

export { router as addonRouter };
