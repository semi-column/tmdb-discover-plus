import { isTraktEnabled } from '../trakt/index.ts';
import { sanitizeFiltersForSource } from '../../utils/validation.ts';
import { DISPLAY } from '../../constants.ts';
import type { CatalogFilters } from '../../types/config.ts';
import type { IDiscoverSource, ManifestSearchCatalog, CatalogRequestContext } from './types.ts';
import { handleTraktCatalogRequest } from '../../routes/handlers/traktHandler.ts';

export const TraktSource: IDiscoverSource = {
  sourceId: 'trakt',
  catalogIdPrefix: 'trakt',
  defaultPageSize: DISPLAY.TMDB_PAGE_SIZE,

  isEnabled() {
    return isTraktEnabled();
  },

  sanitizeFilters(filters: CatalogFilters): CatalogFilters {
    return sanitizeFiltersForSource('trakt', filters as Record<string, unknown>) as CatalogFilters;
  },

  async handleCatalogRequest(ctx: CatalogRequestContext): Promise<void> {
    return handleTraktCatalogRequest(
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
        id: 'trakt-search-movie',
        type: 'movie',
        name: 'Trakt Search',
        extra: [{ name: 'search', isRequired: true }, { name: 'skip' }],
      },
      {
        id: 'trakt-search-series',
        type: 'series',
        name: 'Trakt Search',
        extra: [{ name: 'search', isRequired: true }, { name: 'skip' }],
      },
    ];
  },
};
