import { config } from '../../config.ts';

export { traktFetch, getTraktClientId } from './client.ts';
export {
  getTrending,
  getPopular,
  getFavorited,
  getWatched,
  getPlayed,
  getCollected,
  getAnticipated,
  getBoxOffice,
  getCalendar,
  getRecommended,
  getRecentlyAired,
  searchTrakt,
  getListItems,
  discover,
} from './discover.ts';
export type { DiscoverOptions } from './discover.ts';
export { traktToStremioMeta, batchConvertToStremioMeta } from './stremioMeta.ts';
export * from './reference.ts';
export type {
  TraktMovie,
  TraktShow,
  TraktTrendingMovie,
  TraktTrendingShow,
  TraktSearchResult,
  TraktGenre,
  TraktNetwork,
} from './types.ts';
export {
  TRAKT_LIST_TYPES,
  TRAKT_PERIODS,
  TRAKT_CALENDAR_TYPES,
  TRAKT_COMMUNITY_METRICS,
  TRAKT_SHOW_STATUSES,
  TRAKT_GENRES,
  TRAKT_CERTIFICATIONS_MOVIES,
  TRAKT_CERTIFICATIONS_SHOWS,
} from './types.ts';

export function isTraktEnabled(): boolean {
  return config.traktApi.enabled;
}
