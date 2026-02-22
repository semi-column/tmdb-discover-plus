export { validateApiKey } from './client.ts';

export { batchGetCinemetaRatings } from './ratings.ts';

export { getGenres, getCachedGenres } from './genres.ts';

export {
  getLanguages,
  getOriginalLanguages,
  getCountries,
  getCertifications,
  getWatchRegions,
  getWatchProviders,
} from './configuration.ts';

export { discover, fetchSpecialList } from './discover.ts';

export {
  getDetails,
  getLogos,
  getSeasonDetails,
  getSeriesEpisodes,
  batchGetDetails,
} from './details.ts';

export {
  search,
  searchPerson,
  searchCompany,
  searchKeyword,
  comprehensiveSearch,
} from './search.ts';

export {
  getExternalIds,
  enrichItemsWithImdbIds,
  findByImdbId,
  batchResolveImdbIds,
} from './lookup.ts';

export {
  getPersonById,
  getCompanyById,
  getKeywordById,
  getNetworkById,
  getNetworks,
} from './entityLookup.ts';

export {
  formatRuntime,
  generateSlug,
  toStremioFullMeta,
  toStremioMeta,
  toStremioMetaPreview,
} from './stremioMeta.ts';

export {
  LIST_TYPES,
  PRESET_CATALOGS,
  SORT_OPTIONS,
  RELEASE_TYPES,
  TV_STATUSES,
  TV_TYPES,
  MONETIZATION_TYPES,
  TV_NETWORKS,
} from './referenceData.ts';
