import { sanitizeFiltersForSource } from '../../utils/validation.ts';
import type { CatalogFilters } from '../../types/config.ts';
import type { IDiscoverSource, ManifestSearchCatalog } from './types.ts';

export const TmdbSource: IDiscoverSource = {
  sourceId: 'tmdb',
  catalogIdPrefix: 'tmdb',
  defaultPageSize: 20,

  isEnabled() {
    return true;
  },

  sanitizeFilters(filters: CatalogFilters): CatalogFilters {
    return sanitizeFiltersForSource('tmdb', filters as Record<string, unknown>) as CatalogFilters;
  },

  getSearchCatalogs(): ManifestSearchCatalog[] {
    return [
      {
        id: 'tmdb-search-movie',
        type: 'movie',
        name: 'TMDB Search',
        extra: [{ name: 'search', isRequired: true }, { name: 'skip' }],
      },
      {
        id: 'tmdb-search-series',
        type: 'series',
        name: 'TMDB Search',
        extra: [{ name: 'search', isRequired: true }, { name: 'skip' }],
      },
    ];
  },
};
