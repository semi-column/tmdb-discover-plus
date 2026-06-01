import type { CatalogFilters } from '../../types/config.ts';
import type { IDiscoverSource, ManifestSearchCatalog, CatalogRequestContext } from './types.ts';
import { sanitizeFiltersForSource } from '../../utils/validation.ts';
import { DISPLAY } from '../../constants.ts';
import { handleAnilistCatalogRequest } from '../../routes/handlers/anilistHandler.ts';

export const AnilistSource: IDiscoverSource = {
  sourceId: 'anilist',
  catalogIdPrefix: 'anilist',
  defaultPageSize: DISPLAY.ANIME_PAGE_SIZE,

  isEnabled() {
    return true;
  },

  sanitizeFilters(filters: CatalogFilters): CatalogFilters {
    return sanitizeFiltersForSource(
      'anilist',
      filters as Record<string, unknown>
    ) as CatalogFilters;
  },

  async handleCatalogRequest(ctx: CatalogRequestContext): Promise<void> {
    return handleAnilistCatalogRequest(
      ctx.userId,
      ctx.type,
      ctx.catalogId,
      ctx.extra,
      ctx.res,
      ctx.req
    );
  },

  getSearchCatalogs(): ManifestSearchCatalog[] {
    return [
      {
        id: 'anilist-search-movie',
        type: 'movie',
        name: 'AniList Search',
        extra: [{ name: 'search', isRequired: true }, { name: 'skip' }],
      },
      {
        id: 'anilist-search-series',
        type: 'series',
        name: 'AniList Search',
        extra: [{ name: 'search', isRequired: true }, { name: 'skip' }],
      },
      {
        id: 'anilist-search-anime',
        type: 'anime',
        name: 'AniList Search',
        extra: [{ name: 'search', isRequired: true }, { name: 'skip' }],
      },
    ];
  },
};
