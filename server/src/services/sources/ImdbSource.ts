import { isImdbApiEnabled } from '../imdb/index.ts';
import { sanitizeFiltersForSource } from '../../utils/validation.ts';
import { DISPLAY } from '../../constants.ts';
import type { CatalogFilters } from '../../types/config.ts';
import type { IDiscoverSource, ManifestSearchCatalog, CatalogRequestContext } from './types.ts';
import { handleImdbCatalogRequest } from '../../routes/handlers/imdbHandler.ts';

export const ImdbSource: IDiscoverSource = {
  sourceId: 'imdb',
  catalogIdPrefix: 'imdb',
  defaultPageSize: DISPLAY.IMDB_PAGE_SIZE,

  isEnabled() {
    return isImdbApiEnabled();
  },

  sanitizeFilters(filters: CatalogFilters): CatalogFilters {
    return sanitizeFiltersForSource('imdb', filters as Record<string, unknown>) as CatalogFilters;
  },

  async handleCatalogRequest(ctx: CatalogRequestContext): Promise<void> {
    return handleImdbCatalogRequest(
      ctx.userId,
      ctx.type,
      ctx.catalogId,
      ctx.extra,
      ctx.res,
      ctx.req
    );
  },

  getSearchCatalogs(): ManifestSearchCatalog[] {
    if (!isImdbApiEnabled()) return [];
    return [
      {
        id: 'imdb-search-movie',
        type: 'movie',
        name: 'IMDb Search',
        extra: [{ name: 'search', isRequired: true }, { name: 'skip' }],
      },
      {
        id: 'imdb-search-series',
        type: 'series',
        name: 'IMDb Search',
        extra: [{ name: 'search', isRequired: true }, { name: 'skip' }],
      },
    ];
  },
};
