export { anilistFetch } from './client.ts';
export { browse, search } from './discover.ts';
export { anilistToStremioMeta, batchConvertToStremioMeta } from './stremioMeta.ts';
export * from './reference.ts';
export type { AnilistMedia, AnilistPageResponse, AnilistPageInfo } from './types.ts';
export {
  ANILIST_GENRES,
  ANILIST_FORMATS,
  ANILIST_STATUSES,
  ANILIST_SEASONS,
  ANILIST_SORT_OPTIONS,
  ANILIST_SOURCE_MATERIALS,
  ANILIST_COUNTRIES,
  ANILIST_TAGS,
} from './types.ts';

export function isAnilistEnabled(): boolean {
  return true;
}
