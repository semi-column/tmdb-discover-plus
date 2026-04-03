import type { Request, Response } from 'express';
import type { ContentType } from '../../types/common.ts';
import type { StremioMetaPreview, CatalogConfig } from '../../types/index.ts';
import { getUserConfig } from '../../services/configService.ts';
import { getCache } from '../../services/cache/index.ts';
import * as simkl from '../../services/simkl/index.ts';
import { config } from '../../config.ts';
import { createLogger } from '../../utils/logger.ts';
import { CACHE_TTLS, buildCatalogId, catalogServerTtl } from '../../constants.ts';

const log = createLogger('addon:simkl');
const PAGE_SIZE = 20;
const MAX_BACKFILL_PAGES = 5;

/**
 * Fetches enough upstream pages to fill PAGE_SIZE mapped metas.
 */
async function fetchWithBackfill(
  fetchPage: (
    page: number
  ) => Promise<{ items: (simkl.SimklAnime | simkl.SimklTrendingItem)[]; hasMore: boolean }>,
  type: ContentType,
  startPage: number
): Promise<StremioMetaPreview[]> {
  const metas: StremioMetaPreview[] = [];
  let currentPage = startPage;
  let pagesChecked = 0;

  while (metas.length < PAGE_SIZE && pagesChecked < MAX_BACKFILL_PAGES) {
    const result = await fetchPage(currentPage);
    const batch = simkl.batchConvertToStremioMeta(result.items, type);
    metas.push(...batch);
    pagesChecked++;

    if (!result.hasMore || result.items.length === 0) break;
    currentPage++;
  }

  return metas.slice(0, PAGE_SIZE);
}

export async function handleSimklCatalogRequest(
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

    // Resolve Simkl API key: server-side only
    const simklApiKey = config.simklApi.clientId || undefined;

    // Search catalog
    if (catalogId === 'simkl-search-movie' || catalogId === 'simkl-search-series') {
      if (!searchQuery || !simklApiKey) {
        res.json({ metas: [] });
        return;
      }
      const results = await simkl.searchAnime(searchQuery, page, simklApiKey);
      const metas = simkl.batchConvertToStremioMeta(
        results.map((r) => ({ ...r, genres: [], overview: '' }) as simkl.SimklAnime),
        type
      );
      res.set(
        'Cache-Control',
        `max-age=${CACHE_TTLS.CATALOG_HEADER}, stale-while-revalidate=${CACHE_TTLS.CATALOG_STALE_REVALIDATE}, stale-if-error=259200`
      );
      log.debug('Simkl search results', {
        count: metas.length,
        query: searchQuery,
        durationMs: Date.now() - startTime,
      });
      res.json({ metas });
      return;
    }

    // Find catalog config
    const catalogConfig = userConfig.catalogs.find((c: CatalogConfig) => {
      return buildCatalogId('simkl', c) === catalogId;
    });

    if (!catalogConfig) {
      log.debug('Simkl catalog config not found', { catalogId });
      res.json({ metas: [] });
      return;
    }

    const filters = catalogConfig.filters || {};
    const listType = filters.simklListType || 'trending';

    // Non-trending list types require an API key
    if (listType !== 'trending' && !simklApiKey) {
      log.debug('Simkl API key not available for non-trending request', { userId, listType });
      res.json({ metas: [] });
      return;
    }

    const cache = getCache();
    const cacheKey = `simkl:catalog:${catalogId}:${type}:${page}`;

    const cached = await cache.get(cacheKey);
    if (cached) {
      res.set(
        'Cache-Control',
        `max-age=${CACHE_TTLS.CATALOG_HEADER}, stale-while-revalidate=${CACHE_TTLS.CATALOG_STALE_REVALIDATE}, stale-if-error=259200`
      );
      res.json(cached);
      return;
    }

    const metas = await fetchWithBackfill(
      (p) => simkl.discover(filters, type, p, simklApiKey),
      type,
      page
    );

    const response = { metas };
    const isTrending = filters.simklListType === 'trending';
    const ttl = catalogServerTtl(isTrending ? 'trending' : 'discover');
    cache.set(cacheKey, response, ttl).catch(() => {});

    res.set(
      'Cache-Control',
      `max-age=${CACHE_TTLS.CATALOG_HEADER}, stale-while-revalidate=${CACHE_TTLS.CATALOG_STALE_REVALIDATE}, stale-if-error=259200`
    );

    log.debug('Simkl catalog response', {
      catalogId,
      count: metas.length,
      page,
      durationMs: Date.now() - startTime,
    });

    res.json(response);
  } catch (err) {
    log.error('Simkl catalog error', {
      catalogId,
      error: (err as Error).message,
      durationMs: Date.now() - startTime,
    });
    res.json({ metas: [] });
  }
}
