import { isSimklEnabled } from '../simkl/index.ts';
import { sanitizeFiltersForSource } from '../../utils/validation.ts';
import { DISPLAY } from '../../constants.ts';
import type { CatalogFilters } from '../../types/config.ts';
import type { IDiscoverSource, ManifestSearchCatalog, CatalogRequestContext } from './types.ts';
import { handleSimklCatalogRequest } from '../../routes/handlers/simklHandler.ts';

export const SimklSource: IDiscoverSource = {
  sourceId: 'simkl',
  catalogIdPrefix: 'simkl',
  defaultPageSize: DISPLAY.ANIME_PAGE_SIZE,

  isEnabled() {
    return isSimklEnabled();
  },

  sanitizeFilters(filters: CatalogFilters): CatalogFilters {
    return sanitizeFiltersForSource('simkl', filters as Record<string, unknown>) as CatalogFilters;
  },

  async handleCatalogRequest(ctx: CatalogRequestContext): Promise<void> {
    return handleSimklCatalogRequest(
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
        id: 'simkl-search-movie',
        type: 'movie',
        name: 'Simkl Search',
        extra: [{ name: 'search', isRequired: true }, { name: 'skip' }],
      },
      {
        id: 'simkl-search-series',
        type: 'series',
        name: 'Simkl Search',
        extra: [{ name: 'search', isRequired: true }, { name: 'skip' }],
      },
      {
        id: 'simkl-search-anime',
        type: 'anime',
        name: 'Simkl Search',
        extra: [{ name: 'search', isRequired: true }, { name: 'skip' }],
      },
    ];
  },
};
