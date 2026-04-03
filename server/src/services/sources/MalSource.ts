import { sanitizeFiltersForSource } from '../../utils/validation.ts';
import { DISPLAY } from '../../constants.ts';
import type { CatalogFilters } from '../../types/config.ts';
import type { IDiscoverSource } from './types.ts';

export const MalSource: IDiscoverSource = {
  sourceId: 'mal',
  catalogIdPrefix: 'mal',
  defaultPageSize: DISPLAY.ANIME_PAGE_SIZE,

  isEnabled() {
    return true; // Jikan API - no key needed
  },

  sanitizeFilters(filters: CatalogFilters): CatalogFilters {
    return sanitizeFiltersForSource('mal', filters as Record<string, unknown>) as CatalogFilters;
  },
};
