import type { Request, Response } from 'express';
import type { ContentType } from '../../types/common.ts';
import type { StremioMetaPreview, CatalogConfig } from '../../types/index.ts';
import { getUserConfig } from '../../services/configService.ts';
import { getCache } from '../../services/cache/index.ts';
import * as anilist from '../../services/anilist/index.ts';
import { createLogger } from '../../utils/logger.ts';
import { CACHE_TTLS, buildCatalogId, catalogServerTtl } from '../../constants.ts';

const log = createLogger('addon:anilist');
const PAGE_SIZE = 20;
const MAX_BACKFILL_PAGES = 5;

/**
 * Fetches enough upstream pages to fill PAGE_SIZE mapped metas.
 * Items without IMDB/Kitsu IDs get dropped during conversion, so we
 * may need to fetch additional pages to compensate.
 */
async function fetchWithBackfill(
  fetchPage: (
    page: number
  ) => Promise<{
    media: import('../../services/anilist/types.ts').AnilistMedia[];
    hasNextPage: boolean;
  }>,
  type: ContentType,
  startPage: number
): Promise<StremioMetaPreview[]> {
  const metas: StremioMetaPreview[] = [];
  let currentPage = startPage;
  let pagesChecked = 0;

  while (metas.length < PAGE_SIZE && pagesChecked < MAX_BACKFILL_PAGES) {
    const result = await fetchPage(currentPage);
    const batch = anilist.batchConvertToStremioMeta(result.media, type);
    metas.push(...batch);
    pagesChecked++;

    if (!result.hasNextPage || result.media.length === 0) break;
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

    // Search catalog
    if (catalogId === 'anilist-search-movie' || catalogId === 'anilist-search-series') {
      if (!searchQuery) {
        res.json({ metas: [] });
        return;
      }
      const metas = await fetchWithBackfill(
        (p) => anilist.search(searchQuery, type, p),
        type,
        page
      );
      res.set(
        'Cache-Control',
        `max-age=${CACHE_TTLS.CATALOG_HEADER}, stale-while-revalidate=${CACHE_TTLS.CATALOG_STALE_REVALIDATE}, stale-if-error=259200`
      );
      log.debug('AniList search results', {
        count: metas.length,
        query: searchQuery,
        durationMs: Date.now() - startTime,
      });
      res.json({ metas });
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
    const cache = getCache();
    const cacheKey = `anilist:catalog:${catalogId}:${type}:${page}`;

    // Check cache
    const cached = await cache.get(cacheKey);
    if (cached) {
      res.set(
        'Cache-Control',
        `max-age=${CACHE_TTLS.CATALOG_HEADER}, stale-while-revalidate=${CACHE_TTLS.CATALOG_STALE_REVALIDATE}, stale-if-error=259200`
      );
      res.json(cached);
      return;
    }

    // Fetch from AniList with backfill
    const metas = await fetchWithBackfill((p) => anilist.browse(filters, type, p), type, page);

    const response = { metas };

    // Cache the result
    const ttl = catalogServerTtl(filters.sortBy === 'TRENDING_DESC' ? 'trending' : 'discover');
    cache.set(cacheKey, response, ttl).catch(() => {});

    res.set(
      'Cache-Control',
      `max-age=${CACHE_TTLS.CATALOG_HEADER}, stale-while-revalidate=${CACHE_TTLS.CATALOG_STALE_REVALIDATE}, stale-if-error=259200`
    );

    log.debug('AniList catalog response', {
      catalogId,
      count: metas.length,
      page,
      durationMs: Date.now() - startTime,
    });

    res.json(response);
  } catch (err) {
    log.error('AniList catalog error', {
      catalogId,
      error: (err as Error).message,
      durationMs: Date.now() - startTime,
    });
    res.json({ metas: [] });
  }
}
