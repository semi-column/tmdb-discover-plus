import type { Request, Response } from 'express';
import type { ContentType } from '../../types/common.ts';
import type { StremioMetaPreview, CatalogConfig, ArtworkOptions } from '../../types/index.ts';
import { getUserConfig, getSimklKeyFromConfig } from '../../services/configService.ts';
import { getCache } from '../../services/cache/index.ts';
import * as simkl from '../../services/simkl/index.ts';
import { config } from '../../config.ts';
import { createLogger } from '../../utils/logger.ts';
import { shuffleArray } from '../../utils/helpers.ts';
import { CACHE_TTLS, buildCatalogId, catalogServerTtl } from '../../constants.ts';
import {
  createArtworkOptions,
  resolveContentType,
  applyArtworkOverridesToMetaPreviews,
} from '../../services/artworkService.ts';
import { decrypt } from '../../utils/encryption.ts';

const log = createLogger('addon:simkl');
const PAGE_SIZE = 20;
const MAX_BACKFILL_PAGES = 5;

function normalizeGenreName(value: string): string {
  return value.trim().toLowerCase();
}

function filterByExtraGenre(
  items: (simkl.SimklAnime | simkl.SimklTrendingItem)[],
  genreName?: string | null
): (simkl.SimklAnime | simkl.SimklTrendingItem)[] {
  if (!genreName) return items;
  const normalizedTarget = normalizeGenreName(genreName);

  return items.filter((item) => {
    const rawGenres = (item as { genres?: unknown }).genres;
    const genres = Array.isArray(rawGenres) ? rawGenres : [];
    return genres.some((genre: unknown) => normalizeGenreName(String(genre)) === normalizedTarget);
  });
}

/**
 * Fetches enough upstream pages to fill PAGE_SIZE mapped metas.
 */
async function fetchWithBackfill(
  fetchPage: (
    page: number
  ) => Promise<{ items: (simkl.SimklAnime | simkl.SimklTrendingItem)[]; hasMore: boolean }>,
  type: ContentType,
  startPage: number,
  genreName?: string | null,
  artworkOptions: ArtworkOptions | null = null
): Promise<StremioMetaPreview[]> {
  const metas: StremioMetaPreview[] = [];
  let currentPage = startPage;
  let pagesChecked = 0;

  while (metas.length < PAGE_SIZE && pagesChecked < MAX_BACKFILL_PAGES) {
    const result = await fetchPage(currentPage);
    const filteredItems = filterByExtraGenre(result.items, genreName);
    const batch = simkl.batchConvertToStremioMeta(filteredItems, type, artworkOptions);
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

    const artworkOptions: ArtworkOptions | null = createArtworkOptions(
      userConfig.preferences || null,
      (encrypted) => {
        try {
          return decrypt(encrypted);
        } catch {
          return null;
        }
      },
      resolveContentType(type, 'simkl')
    );

    // Resolve Simkl API key: server-side key, or user-provided key as fallback
    const simklApiKey = config.simklApi.clientId || getSimklKeyFromConfig(userConfig) || undefined;

    // Search catalog
    if (
      catalogId === 'simkl-search-movie' ||
      catalogId === 'simkl-search-series' ||
      catalogId === 'simkl-search-anime'
    ) {
      if (!searchQuery || !simklApiKey) {
        res.json({ metas: [] });
        return;
      }
      const results = await simkl.searchAnime(searchQuery, page, simklApiKey);
      const metas = simkl.batchConvertToStremioMeta(
        results.map((r) => ({ ...r, genres: [], overview: '' }) as simkl.SimklAnime),
        type,
        artworkOptions
      );
      const resolvedMetas = await applyArtworkOverridesToMetaPreviews(metas, artworkOptions);
      res.set(
        'Cache-Control',
        `max-age=${CACHE_TTLS.CATALOG_HEADER}, stale-while-revalidate=${CACHE_TTLS.CATALOG_STALE_REVALIDATE}, stale-if-error=259200`
      );
      log.debug('Simkl search results', {
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
      return buildCatalogId('simkl', c) === catalogId;
    });

    if (!catalogConfig) {
      log.debug('Simkl catalog config not found', { catalogId });
      res.json({ metas: [] });
      return;
    }

    const filters = catalogConfig.filters || {};
    const selectedExtraGenre =
      typeof extra.genre === 'string' && extra.genre !== 'All' ? extra.genre : null;
    const listType = filters.simklListType || 'trending';
    const randomize = Boolean(filters.randomize || filters.sortBy === 'random');

    // Non-trending list types require an API key
    if (listType !== 'trending' && !simklApiKey) {
      log.warn(
        'Simkl API key not configured — non-trending list types require SIMKL_CLIENT_ID env var',
        { userId, listType }
      );
      res.json({ metas: [] });
      return;
    }

    const cache = getCache();
    const cacheKey = `simkl:catalog:${catalogId}:${type}:${page}:${selectedExtraGenre || ''}`;

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
      const probe = await simkl.discover(filters, type, 1, simklApiKey);
      const probeFiltered = filterByExtraGenre(probe.items, selectedExtraGenre);
      if (listType === 'trending' || listType === 'airing') {
        metas = simkl.batchConvertToStremioMeta(probeFiltered, type, artworkOptions);
        metas = shuffleArray(metas).slice(0, PAGE_SIZE);
      } else {
        const maxPage = probe.hasMore ? 5 : 1;
        const randomPage = Math.floor(Math.random() * maxPage) + 1;
        metas = await fetchWithBackfill(
          (p) => simkl.discover(filters, type, p, simklApiKey),
          type,
          randomPage,
          selectedExtraGenre,
          artworkOptions
        );
        metas = shuffleArray(metas);
      }
    } else {
      metas = await fetchWithBackfill(
        (p) => simkl.discover(filters, type, p, simklApiKey),
        type,
        page,
        selectedExtraGenre,
        artworkOptions
      );
    }

    metas = await applyArtworkOverridesToMetaPreviews(metas, artworkOptions);

    const response = { metas };

    if (!randomize) {
      const isTrending = listType === 'trending';
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

    log.debug('Simkl catalog response', {
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
    log.error('Simkl catalog error', {
      catalogId,
      error: (err as Error).message,
      durationMs: Date.now() - startTime,
    });
    res.json({ metas: [] });
  }
}
