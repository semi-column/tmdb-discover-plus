export { jikanFetch } from './client.ts';
export { getRanking, getSeasonal, searchAnime, browseAnime, discover } from './discover.ts';
export { malToStremioMeta, batchConvertToStremioMeta } from './stremioMeta.ts';
export * from './reference.ts';
export type { MalAnime, JikanAnime, JikanResponse } from './types.ts';
export {
  MAL_RANKING_TYPES,
  MAL_SORT_OPTIONS,
  MAL_ORDER_BY_OPTIONS,
  MAL_MEDIA_TYPES,
  MAL_STATUSES,
  MAL_RATINGS,
  MAL_GENRES,
  MAL_SEASONS,
} from './types.ts';
