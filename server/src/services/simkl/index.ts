import { config } from '../../config.ts';

export { simklFetch, simklCdnFetch, getSimklApiKey } from './client.ts';
export {
  getTrending,
  getByGenre,
  getPremieres,
  getAiring,
  getBest,
  searchAnime,
  lookupById,
  discover,
} from './discover.ts';
export { simklToStremioMeta, batchConvertToStremioMeta } from './stremioMeta.ts';
export * from './reference.ts';
export type { SimklAnime, SimklTrendingItem, SimklSearchResult } from './types.ts';
export {
  SIMKL_LIST_TYPES,
  SIMKL_TRENDING_PERIODS,
  SIMKL_BEST_FILTERS,
  SIMKL_ANIME_TYPES,
  SIMKL_SORT_OPTIONS,
  SIMKL_GENRES,
} from './types.ts';

export function isSimklEnabled(): boolean {
  return config.simklApi.enabled;
}
