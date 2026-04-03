import type { CatalogFilters } from '../../types/config.ts';
import type { IDiscoverSource } from './types.ts';
import { sanitizeFiltersForSource } from '../../utils/validation.ts';
import { DISPLAY } from '../../constants.ts';

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
};
