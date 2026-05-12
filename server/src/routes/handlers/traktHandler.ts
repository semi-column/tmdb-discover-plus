import type { Request, Response } from 'express';
import type { ContentType } from '../../types/common.ts';
import type { StremioMetaPreview, CatalogConfig } from '../../types/index.ts';
import { getUserConfig, getTraktKeyFromConfig } from '../../services/configService.ts';
import { getCache } from '../../services/cache/index.ts';
import * as trakt from '../../services/trakt/index.ts';
import { config } from '../../config.ts';
import { createLogger } from '../../utils/logger.ts';
import { shuffleArray } from '../../utils/helpers.ts';
import { CACHE_TTLS, buildCatalogId, catalogServerTtl } from '../../constants.ts';
import type { ArtworkOptions } from '../../types/config.ts';
import { decrypt } from '../../utils/encryption.ts';
import {
  createArtworkOptions,
  resolveContentType,
  applyArtworkOverridesToMetaPreviews,
} from '../../services/artworkService.ts';

const log = createLogger('addon:trakt');
const PAGE_SIZE = 20;
const MAX_BACKFILL_PAGES = 5;

function resolveTraktGenreSlug(
  genreValue: string,
  genresByType: { movie: trakt.TraktGenre[]; series: trakt.TraktGenre[] },
  type: ContentType
): string | null {
  const normalized = genreValue.trim().toLowerCase();
  const scopedGenres = type === 'movie' ? genresByType.movie : genresByType.series;
  const match = scopedGenres.find(
    (genre) => genre.slug.toLowerCase() === normalized || genre.name.toLowerCase() === normalized
  );
  return match?.slug || null;
}

function filterExcludedGenres(
  items: (trakt.TraktMovie | trakt.TraktShow)[],
  excludeGenres?: string[]
): (trakt.TraktMovie | trakt.TraktShow)[] {
  if (!excludeGenres?.length) return items;
  return items.filter((item) => {
    const itemGenres = item.genres || [];
    return !excludeGenres.some((g) => itemGenres.includes(g));
  });
}

async function fetchWithBackfill(
  fetchPage: (
    page: number
  ) => Promise<{ items: (trakt.TraktMovie | trakt.TraktShow)[]; hasMore: boolean }>,
  type: ContentType,
  startPage: number,
  excludeGenres?: string[],
  artworkOptions: ArtworkOptions | null = null
): Promise<StremioMetaPreview[]> {
  const metas: StremioMetaPreview[] = [];
  let currentPage = startPage;
  let pagesChecked = 0;

  while (metas.length < PAGE_SIZE && pagesChecked < MAX_BACKFILL_PAGES) {
    const result = await fetchPage(currentPage);
    const filtered = filterExcludedGenres(result.items, excludeGenres);
    const batch = trakt.batchConvertToStremioMeta(filtered, type, artworkOptions);
    metas.push(...batch);
    pagesChecked++;

    if (!result.hasMore || result.items.length === 0) break;
    currentPage++;
  }

  return metas.slice(0, PAGE_SIZE);
}

export async function handleTraktCatalogRequest(
  userId: string,
  type: ContentType,
  catalogId: string,
  extra: Record<string, string>,
  res: Response,
  req: Request
): Promise<void> {
  const startTime = Date.now();
  try {
    const skip = parseInt(extra.skip, 10) || 0;
    const searchQuery = extra.search || null;
    const page = Math.floor(skip / PAGE_SIZE) + 1;

    const userConfig = await getUserConfig(userId);
    if (!userConfig) {
      res.json({ metas: [] });
      return;
    }

    const traktClientId =
      config.traktApi.clientId || getTraktKeyFromConfig(userConfig) || undefined;
    const artworkOptions: ArtworkOptions = createArtworkOptions(
      userConfig.preferences || null,
      (encrypted) => {
        try {
          return decrypt(encrypted);
        } catch {
          return null;
        }
      },
      resolveContentType(type, 'trakt')
    );

    if (catalogId === 'trakt-search-movie' || catalogId === 'trakt-search-series') {
      if (!searchQuery || !traktClientId) {
        res.json({ metas: [] });
        return;
      }
      const result = await trakt.searchTrakt(searchQuery, type, page, traktClientId);
      const metas = trakt.batchConvertToStremioMeta(result.items, type, artworkOptions);
      const resolvedMetas = await applyArtworkOverridesToMetaPreviews(metas, artworkOptions);
      res.set(
        'Cache-Control',
        `max-age=${CACHE_TTLS.CATALOG_HEADER}, stale-while-revalidate=${CACHE_TTLS.CATALOG_STALE_REVALIDATE}, stale-if-error=259200`
      );
      log.debug('Trakt search results', {
        count: resolvedMetas.length,
        query: searchQuery,
        durationMs: Date.now() - startTime,
      });
      res.json({
        metas: resolvedMetas,
        cacheMaxAge: CACHE_TTLS.CATALOG_HEADER,
        staleRevalidate: CACHE_TTLS.CATALOG_STALE_REVALIDATE,
      });
      return;
    }

    const catalogConfig = userConfig.catalogs.find((c: CatalogConfig) => {
      return buildCatalogId('trakt', c) === catalogId;
    });

    if (!catalogConfig) {
      log.debug('Trakt catalog config not found', { catalogId });
      res.json({ metas: [] });
      return;
    }

    const filters = catalogConfig.filters || {};
    const selectedExtraGenre =
      typeof extra.genre === 'string' && extra.genre !== 'All' ? extra.genre : null;
    const effectiveFilters = { ...filters };

    if (selectedExtraGenre) {
      const traktGenres = await trakt.getGenresByType(traktClientId);
      const slug = resolveTraktGenreSlug(selectedExtraGenre, traktGenres, type);
      if (slug) {
        effectiveFilters.traktGenres = [slug];
        if (Array.isArray(effectiveFilters.traktExcludeGenres)) {
          const nextExclude = effectiveFilters.traktExcludeGenres.filter(
            (genre: unknown) => String(genre) !== slug
          );
          effectiveFilters.traktExcludeGenres = nextExclude.length > 0 ? nextExclude : undefined;
        }
      }
    }

    const listType = effectiveFilters.traktListType || 'calendar';
    const randomize = Boolean(effectiveFilters.randomize || effectiveFilters.sortBy === 'random');
    const excludeGenres = Array.isArray(effectiveFilters.traktExcludeGenres)
      ? effectiveFilters.traktExcludeGenres.filter(
          (genre): genre is string => typeof genre === 'string'
        )
      : undefined;

    if (!traktClientId) {
      log.warn('Trakt Client ID not configured', { userId, listType });
      res.json({ metas: [] });
      return;
    }

    const cache = getCache();
    const cacheKey = `trakt:catalog:${catalogId}:${type}:${page}:${selectedExtraGenre || ''}`;

    if (!randomize) {
      const cached = await cache.get(cacheKey);
      if (cached) {
        res.set(
          'Cache-Control',
          `max-age=${CACHE_TTLS.CATALOG_HEADER}, stale-while-revalidate=${CACHE_TTLS.CATALOG_STALE_REVALIDATE}, stale-if-error=259200`
        );
        res.json({
          ...cached,
          cacheMaxAge: CACHE_TTLS.CATALOG_HEADER,
          staleRevalidate: CACHE_TTLS.CATALOG_STALE_REVALIDATE,
        });
        return;
      }
    }

    let metas: StremioMetaPreview[];
    if (randomize) {
      const probe = await trakt.discover(effectiveFilters, type, 1, traktClientId);
      const filteredItems = filterExcludedGenres(probe.items, excludeGenres);
      if (listType === 'boxoffice' || listType === 'calendar' || listType === 'recently_aired') {
        metas = trakt.batchConvertToStremioMeta(filteredItems, type, artworkOptions);
        metas = shuffleArray(metas).slice(0, PAGE_SIZE);
      } else {
        const maxPage = probe.hasMore ? 5 : 1;
        const randomPage = Math.floor(Math.random() * maxPage) + 1;
        metas = await fetchWithBackfill(
          (p) => trakt.discover(effectiveFilters, type, p, traktClientId),
          type,
          randomPage,
          excludeGenres,
          artworkOptions
        );
        metas = shuffleArray(metas);
      }
    } else {
      metas = await fetchWithBackfill(
        (p) => trakt.discover(effectiveFilters, type, p, traktClientId),
        type,
        page,
        excludeGenres,
        artworkOptions
      );
    }

    metas = await applyArtworkOverridesToMetaPreviews(metas, artworkOptions);

    const response = { metas };

    if (!randomize) {
      const isTrending =
        listType === 'trending' || listType === 'calendar' || listType === 'recently_aired';
      const ttl = catalogServerTtl(isTrending ? 'trending' : 'discover');
      cache.set(cacheKey, response, ttl).catch(() => {});
    }

    if (randomize) {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
    } else {
      res.set(
        'Cache-Control',
        `max-age=${CACHE_TTLS.CATALOG_HEADER}, stale-while-revalidate=${CACHE_TTLS.CATALOG_STALE_REVALIDATE}, stale-if-error=259200`
      );
    }

    log.debug('Trakt catalog response', {
      catalogId,
      count: metas.length,
      page,
      durationMs: Date.now() - startTime,
    });

    res.json({
      ...response,
      cacheMaxAge: randomize ? 0 : CACHE_TTLS.CATALOG_HEADER,
      staleRevalidate: randomize ? 0 : CACHE_TTLS.CATALOG_STALE_REVALIDATE,
    });
  } catch (err) {
    log.error('Trakt catalog error', {
      catalogId,
      error: (err as Error).message,
      durationMs: Date.now() - startTime,
    });
    res.json({ metas: [] });
  }
}
