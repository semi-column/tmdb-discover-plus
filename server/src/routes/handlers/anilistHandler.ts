import type { Request, Response } from 'express';
import type { ContentType } from '../../types/common.ts';
import type { StremioMetaPreview, CatalogConfig, ArtworkOptions } from '../../types/index.ts';
import type { AnilistCatalogFilters } from '../../types/config.ts';
import { getUserConfig } from '../../services/configService.ts';
import { getCache } from '../../services/cache/index.ts';
import * as anilist from '../../services/anilist/index.ts';
import { createLogger } from '../../utils/logger.ts';
import { shuffleArray } from '../../utils/helpers.ts';
import { CACHE_TTLS, buildCatalogId, catalogServerTtl } from '../../constants.ts';
import {
  createArtworkOptions,
  resolveContentType,
  applyArtworkOverridesToMetaPreviews,
} from '../../services/artworkService.ts';
import { decrypt } from '../../utils/encryption.ts';

const log = createLogger('addon:anilist');
const PAGE_SIZE = 20;
const MAX_BACKFILL_PAGES = 5;

/**
 * Fetches enough upstream pages to fill PAGE_SIZE mapped metas.
 * Items without IMDB/Kitsu IDs get dropped during conversion, so we
 * may need to fetch additional pages to compensate.
 */
async function fetchWithBackfill(
  fetchPage: (page: number) => Promise<{
    media: import('../../services/anilist/types.ts').AnilistMedia[];
    hasNextPage: boolean;
  }>,
  type: ContentType,
  startPage: number,
  artworkOptions: ArtworkOptions | null = null
): Promise<StremioMetaPreview[]> {
  const metas: StremioMetaPreview[] = [];
  let currentPage = startPage;
  let pagesChecked = 0;

  while (metas.length < PAGE_SIZE && pagesChecked < MAX_BACKFILL_PAGES) {
    const result = await fetchPage(currentPage);
    const batch = anilist.batchConvertToStremioMeta(result.media, type, artworkOptions);
    metas.push(...batch);
    pagesChecked++;

    if (!result.hasNextPage) break;
    currentPage++;
  }

  return metas.slice(0, PAGE_SIZE);
}

export async function handleAnilistCatalogRequest(
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

    const artworkOptions: ArtworkOptions | null = createArtworkOptions(
      userConfig.preferences || null,
      (encrypted) => {
        try {
          return decrypt(encrypted);
        } catch {
          return null;
        }
      },
      'anime'
    );

    // Search catalog
    if (
      catalogId === 'anilist-search-movie' ||
      catalogId === 'anilist-search-series' ||
      catalogId === 'anilist-search-anime'
    ) {
      if (!searchQuery) {
        res.json({ metas: [] });
        return;
      }
      const metas = await fetchWithBackfill(
        (p) => anilist.search(searchQuery, type, p),
        type,
        page,
        artworkOptions
      );
      const resolvedMetas = await applyArtworkOverridesToMetaPreviews(metas, artworkOptions);
      res.set(
        'Cache-Control',
        `max-age=${CACHE_TTLS.CATALOG_HEADER}, stale-while-revalidate=${CACHE_TTLS.CATALOG_STALE_REVALIDATE}, stale-if-error=259200`
      );
      log.debug('AniList search results', {
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

    // Find catalog config
    const catalogConfig = userConfig.catalogs.find((c: CatalogConfig) => {
      return buildCatalogId('anilist', c) === catalogId;
    });

    if (!catalogConfig) {
      log.debug('AniList catalog config not found', { catalogId });
      res.json({ metas: [] });
      return;
    }

    const filters = catalogConfig.filters || {};
    const selectedExtraGenre =
      typeof extra.genre === 'string' && extra.genre !== 'All' ? extra.genre : null;
    const effectiveFilters = { ...filters } as Record<string, unknown>;

    if (selectedExtraGenre) {
      effectiveFilters.genres = [selectedExtraGenre];
      if (Array.isArray(effectiveFilters.excludeGenres)) {
        effectiveFilters.excludeGenres = effectiveFilters.excludeGenres.filter(
          (genre: unknown) => String(genre).toLowerCase() !== selectedExtraGenre.toLowerCase()
        );
      }
    }

    const randomize = Boolean(effectiveFilters.randomize || effectiveFilters.sortBy === 'random');
    const cache = getCache();
    const cacheKey = `anilist:catalog:${catalogId}:${type}:${page}:${selectedExtraGenre || ''}`;

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
    const browseFilters = effectiveFilters as unknown as AnilistCatalogFilters;
    if (randomize) {
      const probe = await anilist.browse(browseFilters, type, 1);
      const lastPage = Math.ceil(probe.total / 50) || 1;
      const randomPage = Math.floor(Math.random() * Math.min(lastPage, 50)) + 1;
      metas = await fetchWithBackfill(
        (p) => anilist.browse(browseFilters, type, p),
        type,
        randomPage,
        artworkOptions
      );
      metas = shuffleArray(metas);
    } else {
      metas = await fetchWithBackfill(
        (p) => anilist.browse(browseFilters, type, p),
        type,
        page,
        artworkOptions
      );
    }

    metas = await applyArtworkOverridesToMetaPreviews(metas, artworkOptions);

    const response = { metas };

    if (!randomize) {
      const ttl = catalogServerTtl(
        effectiveFilters.sortBy === 'TRENDING_DESC' ? 'trending' : 'discover'
      );
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

    log.debug('AniList catalog response', {
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
    log.error('AniList catalog error', {
      catalogId,
      error: (err as Error).message,
      durationMs: Date.now() - startTime,
    });
    res.json({ metas: [] });
  }
}
