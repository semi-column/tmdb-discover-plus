/**
 * TMDB Service — barrel re-export.
 *
 * Consumers continue to use:
 *   import * as tmdb from '../services/tmdb.js';
 *
 * Node resolves `tmdb.js` → `tmdb/index.js` when `tmdb/` is a directory.
 * All public exports are re-exported here so the public API surface is unchanged.
 */

// HTTP client & validation
export { validateApiKey } from './client.js';

// Ratings
export { batchGetCinemetaRatings } from './ratings.js';

// Genres
export { getGenres, getCachedGenres } from './genres.js';

// Configuration (languages, countries, certifications, watch providers)
export {
  getLanguages,
  getOriginalLanguages,
  getCountries,
  getCertifications,
  getWatchRegions,
  getWatchProviders,
} from './configuration.js';

// Discovery & special lists
export { discover, fetchSpecialList } from './discover.js';

// Details
export { getDetails, getSeasonDetails, getSeriesEpisodes } from './details.js';

// Search
export { search, searchPerson, searchCompany, searchKeyword, comprehensiveSearch } from './search.js';

// Lookup (TMDB ↔ IMDb)
export { getExternalIds, enrichItemsWithImdbIds, findByImdbId } from './lookup.js';

// Entity lookup (person, company, keyword, network)
export {
  getPersonById,
  getCompanyById,
  getKeywordById,
  getNetworkById,
  getNetworks,
} from './entityLookup.js';

// Stremio meta conversion
export {
  formatRuntime,
  generateSlug,
  toStremioFullMeta,
  toStremioMeta,
} from './stremioMeta.js';

// Reference data constants
export {
  LIST_TYPES,
  PRESET_CATALOGS,
  SORT_OPTIONS,
  RELEASE_TYPES,
  TV_STATUSES,
  TV_TYPES,
  MONETIZATION_TYPES,
  TV_NETWORKS,
} from './referenceData.js';
