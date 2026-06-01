import { sanitizeFiltersForSource } from '../../utils/validation.ts';
import { DISPLAY } from '../../constants.ts';
import type { CatalogFilters } from '../../types/config.ts';
import type { IDiscoverSource, ManifestSearchCatalog, CatalogRequestContext } from './types.ts';
import { handleKitsuCatalogRequest } from '../../routes/handlers/kitsuHandler.ts';

export const KitsuSource: IDiscoverSource = {
  sourceId: 'kitsu',
  catalogIdPrefix: 'kitsu',
  defaultPageSize: DISPLAY.ANIME_PAGE_SIZE,

  isEnabled() {
    return true;
  },

  sanitizeFilters(filters: CatalogFilters): CatalogFilters {
    return sanitizeFiltersForSource('kitsu', filters as Record<string, unknown>) as CatalogFilters;
  },

  async handleCatalogRequest(ctx: CatalogRequestContext): Promise<void> {
    return handleKitsuCatalogRequest(
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
        id: 'kitsu-search-movie',
        type: 'movie',
        name: 'Kitsu Search',
        extra: [{ name: 'search', isRequired: true }, { name: 'skip' }],
      },
      {
        id: 'kitsu-search-series',
        type: 'series',
        name: 'Kitsu Search',
        extra: [{ name: 'search', isRequired: true }, { name: 'skip' }],
      },
      {
        id: 'kitsu-search-anime',
        type: 'anime',
        name: 'Kitsu Search',
        extra: [{ name: 'search', isRequired: true }, { name: 'skip' }],
      },
    ];
  },
};
