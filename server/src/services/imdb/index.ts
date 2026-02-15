export { imdbFetch, getImdbCircuitBreakerState, resetImdbCircuitBreaker } from './client.ts';
export { advancedSearch, getTopRanking, getPopular, getList } from './discover.ts';
export { getTitle } from './detail.ts';
export { search, getSuggestions } from './search.ts';
export {
  getGenres,
  getTitleTypes,
  getKeywords,
  getAwards,
  getSortOptions,
  getTitleTypeOptions,
  getPresetCatalogs,
} from './reference.ts';
export {
  imdbToStremioMeta,
  imdbToStremioFullMeta,
  imdbRankingToStremioMeta,
  imdbListItemToStremioMeta,
} from './stremioMeta.ts';
export {
  IMDB_GENRES,
  IMDB_KEYWORDS,
  IMDB_AWARDS,
  IMDB_SORT_OPTIONS,
  IMDB_TITLE_TYPES,
  IMDB_PRESET_CATALOGS,
} from './types.ts';
export type {
  ImdbTitle,
  ImdbSearchResult,
  ImdbRankingResult,
  ImdbRankingEntry,
  ImdbListResult,
  ImdbListItem,
  ImdbAdvancedSearchParams,
  ImdbCatalogFilters,
  ImdbSortBy,
  ImdbSortOrder,
  ImdbTitleType,
  ImdbPosterOptions,
} from './types.ts';

import { config } from '../../config.ts';
import { createLogger } from '../../utils/logger.ts';

const log = createLogger('imdb:init');

export function isImdbApiEnabled(): boolean {
  return config.imdbApi.enabled && !!config.imdbApi.apiKey && !!config.imdbApi.apiHost;
}

export function initImdbApi(): void {
  if (!config.imdbApi.apiKey || !config.imdbApi.apiHost) {
    log.info('IMDb API not configured — IMDb features disabled');
    return;
  }
  log.info('IMDb API enabled', { rateLimit: config.imdbApi.rateLimit });
}
