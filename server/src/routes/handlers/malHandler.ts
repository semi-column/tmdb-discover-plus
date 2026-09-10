import type { Request, Response } from 'express';
import type { ContentType } from '../../types/common.ts';
import type { StremioMetaPreview, CatalogConfig, ArtworkOptions } from '../../types/index.ts';
import { getUserConfig } from '../../services/configService.ts';
import { getCache } from '../../services/cache/index.ts';
import * as mal from '../../services/mal/index.ts';
import { randomPageWithin } from '../../services/mal/discover.ts';
import { createLogger } from '../../utils/logger.ts';
import { buildCatalogId } from '../../constants.ts';
import { CACHE_TTLS, catalogServerTtl } from '../../cacheTtls.ts';
import {
  createArtworkOptions,
  resolveContentType,
  applyArtworkOverridesToMetaPreviews,
} from '../../services/artworkService.ts';
import { decrypt } from '../../utils/encryption.ts';

const log = createLogger('addon:mal');
const PAGE_SIZE = 20;
const MAX_BACKFILL_PAGES = 3;

/**
 * Fetches enough upstream pages to fill PAGE_SIZE mapped metas.
 * Jikan returns 25 per page, and ID mapping may drop some items.
 */
async function fetchWithBackfill(
  fetchPage: (
    page: number
  ) => Promise<{ anime: import('../../services/mal/types.ts').MalAnime[]; hasMore: boolean }>,
  type: ContentType,
  startPage: number,
  artworkOptions: ArtworkOptions | null = null,
  metaType: ContentType = type
): Promise<StremioMetaPreview[]> {
  const metas: StremioMetaPreview[] = [];
  let currentPage = startPage;
  let pagesChecked = 0;

  while (metas.length < PAGE_SIZE && pagesChecked < MAX_BACKFILL_PAGES) {
    const result = await fetchPage(currentPage);
    const batch = mal.batchConvertToStremioMeta(result.anime, metaType, artworkOptions);
    metas.push(...batch);
    pagesChecked++;

    if (!result.hasMore) break;
    currentPage++;
  }

  return metas.slice(0, PAGE_SIZE);
}

export async function handleMalCatalogRequest(
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

    const catalogConfig = userConfig.catalogs.find((c: CatalogConfig) => {
      return buildCatalogId('mal', c) === catalogId;
    });
    const isAnimeCatalog = catalogId === 'mal-search-anime' || catalogConfig?.type === 'anime';
    const discoveryType: ContentType = isAnimeCatalog ? 'anime' : type;
    const metaType: ContentType = type;

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
      catalogId === 'mal-search-movie' ||
      catalogId === 'mal-search-series' ||
      catalogId === 'mal-search-anime'
    ) {
      if (!searchQuery) {
        res.json({ metas: [] });
        return;
      }
      const metas = await fetchWithBackfill(
        (p) => mal.searchAnime(searchQuery, discoveryType, p),
        discoveryType,
        page,
        artworkOptions,
        metaType
      );
      const resolvedMetas = await applyArtworkOverridesToMetaPreviews(metas, artworkOptions);
      res.set(
        'Cache-Control',
        `max-age=${CACHE_TTLS.CATALOG_HEADER}, stale-while-revalidate=${CACHE_TTLS.CATALOG_STALE_REVALIDATE}, stale-if-error=${CACHE_TTLS.CATALOG_STALE_IF_ERROR}`
      );
      log.debug('MAL search results', {
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
    if (!catalogConfig) {
      log.debug('MAL catalog config not found', { catalogId });
      res.json({ metas: [] });
      return;
    }

    const filters = catalogConfig.filters || {};
    const randomize = Boolean(filters.randomize);
    const selectedExtraGenre =
      typeof extra.genre === 'string' && extra.genre !== 'All' ? extra.genre : null;
    const effectiveFilters = { ...filters };

    if (selectedExtraGenre) {
      const match = mal
        .getGenres()
        .find((genre) => genre.name.toLowerCase() === selectedExtraGenre.toLowerCase());
      if (match) {
        effectiveFilters.malGenres = [match.id];
        if (Array.isArray(effectiveFilters.malExcludeGenres)) {
          const nextExclude = effectiveFilters.malExcludeGenres.filter(
            (id: unknown) => Number(id) !== match.id
          );
          effectiveFilters.malExcludeGenres = nextExclude.length > 0 ? nextExclude : undefined;
        }
      }
    }

    const cache = getCache();
    const cacheKey = `mal:catalog:${catalogId}:${type}:${page}:${selectedExtraGenre || ''}`;

    const cached = randomize ? null : await cache.get(cacheKey);
    if (cached) {
      res.set(
        'Cache-Control',
        `max-age=${CACHE_TTLS.CATALOG_HEADER}, stale-while-revalidate=${CACHE_TTLS.CATALOG_STALE_REVALIDATE}, stale-if-error=${CACHE_TTLS.CATALOG_STALE_IF_ERROR}`
      );
      res.json({
        ...cached,
        cacheMaxAge: CACHE_TTLS.CATALOG_HEADER,
        staleRevalidate: CACHE_TTLS.CATALOG_STALE_REVALIDATE,
      });
      return;
    }

    let startPage = page;
    if (randomize) {
      const probe = await mal.discover(effectiveFilters, discoveryType, 1);
      startPage = randomPageWithin(probe.lastPage);
      log.debug('MAL random page selected', {
        catalogId,
        requestedPage: page,
        selectedPage: startPage,
        lastPage: probe.lastPage,
      });
    }

    let metas = await fetchWithBackfill(
      (p) => mal.discover(effectiveFilters, discoveryType, p),
      discoveryType,
      startPage,
      artworkOptions,
      metaType
    );

    metas = await applyArtworkOverridesToMetaPreviews(metas, artworkOptions);

    if (metas.length === 0) {
      log.debug('Skipping cache write for empty MAL catalog response', {
        catalogId,
        type,
        page,
      });
      res.set(
        'Cache-Control',
        `max-age=${CACHE_TTLS.CATALOG_HEADER}, stale-while-revalidate=${CACHE_TTLS.CATALOG_STALE_REVALIDATE}, stale-if-error=${CACHE_TTLS.CATALOG_STALE_IF_ERROR}`
      );
      res.json({ metas: [] });
      return;
    }

    const response = { metas };

    if (!randomize) {
      const ttl = catalogServerTtl('discover');
      cache.set(cacheKey, response, ttl).catch(() => {});
    }

    res.set(
      'Cache-Control',
      `max-age=${CACHE_TTLS.CATALOG_HEADER}, stale-while-revalidate=${CACHE_TTLS.CATALOG_STALE_REVALIDATE}, stale-if-error=${CACHE_TTLS.CATALOG_STALE_IF_ERROR}`
    );

    log.debug('MAL catalog response', {
      catalogId,
      count: metas.length,
      page,
      durationMs: Date.now() - startTime,
    });

    res.json({
      ...response,
      cacheMaxAge: CACHE_TTLS.CATALOG_HEADER,
      staleRevalidate: CACHE_TTLS.CATALOG_STALE_REVALIDATE,
    });
  } catch (err) {
    log.error('MAL catalog error', {
      catalogId,
      error: (err as Error).message,
      durationMs: Date.now() - startTime,
    });
    res.json({ metas: [] });
  }
}
