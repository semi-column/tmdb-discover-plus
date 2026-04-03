import { isSimklEnabled } from '../simkl/index.ts';
import { sanitizeFiltersForSource } from '../../utils/validation.ts';
import { DISPLAY } from '../../constants.ts';
import type { CatalogFilters } from '../../types/config.ts';
import type { IDiscoverSource } from './types.ts';

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
};
