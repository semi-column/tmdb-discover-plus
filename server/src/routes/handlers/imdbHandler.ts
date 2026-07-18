import type { Request, Response } from 'express';
import type { ContentType } from '../../types/common.ts';
import type { StremioMetaPreview, TmdbDetails } from '../../types/index.ts';
import type { ImdbTitle } from '../../services/imdb/types.ts';

import * as imdb from '../../services/imdb/index.ts';
import * as tmdb from '../../services/tmdb/index.ts';
import { getUserConfig, getApiKeyFromConfig } from '../../services/configService.ts';
import { getCache } from '../../services/cache/index.ts';
import {
  buildImdbEnrichmentCacheKey,
  buildArtworkIntegrationScope,
} from '../../services/imdb/cacheKey.ts';
import { applyArtworkOverridesToMetaPreviews } from '../../services/artworkService.ts';
import { sanitizeImdbFilters, sanitizeFiltersForSource } from '../../utils/validation.ts';
import { isNoSelectionGenre } from '../../utils/catalogExtras.ts';
import { getBaseUrl, logSwallowedError } from '../../utils/helpers.ts';
import { DISPLAY, normalizeBaseUrl, buildCatalogId } from '../../constants.ts';
import { CACHE_TTLS } from '../../cacheTtls.ts';
import { createLogger } from '../../utils/logger.ts';
import { buildArtworkOptions, getPlaceholderUrls } from './sharedHelpers.ts';

const log = createLogger('addon:imdb');
const IMDB_PAGE_SIZE = DISPLAY.IMDB_PAGE_SIZE;

export async function handleImdbCatalogRequest(
  userId: string,
  type: ContentType,
  catalogId: string,
  extra: Record<string, string>,
  res: Response,
  req: Request
): Promise<void> {
  const startTime = Date.now();
  try {
    if (!imdb.isImdbApiEnabled()) {
      res.json({ metas: [] });
      return;
    }

    const skip = parseInt(extra.skip, 10) || 0;
    const searchQuery = extra.search || null;

    const userConfig = await getUserConfig(userId);
    if (!userConfig) {
      res.json({ metas: [] });
      return;
    }

    const apiKey = getApiKeyFromConfig(userConfig);
    if (!apiKey) {
      res.json({ metas: [] });
      return;
    }

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
      if (!searchQuery) {
        res.json({ metas: [] });
        return;
      }
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
        `max-age=${CACHE_TTLS.CATALOG_HEADER}, stale-while-revalidate=${CACHE_TTLS.CATALOG_STALE_REVALIDATE}, stale-if-error=${CACHE_TTLS.CATALOG_STALE_IF_ERROR}`
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
      res.json({ metas: [] });
      return;
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
      `max-age=${CACHE_TTLS.CATALOG_HEADER}, stale-while-revalidate=${CACHE_TTLS.CATALOG_STALE_REVALIDATE}, stale-if-error=${CACHE_TTLS.CATALOG_STALE_IF_ERROR}`
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
