import type { ContentType, PosterShape } from './common.ts';
import type { TmdbReleaseDates, TmdbContentRatings } from './tmdb.ts';

export interface StremioLink {
  name: string;
  category: 'imdb' | 'Genres' | 'Cast' | 'Directors' | 'Writers' | 'Networks' | 'Studios' | 'share';
  url: string;
}

export interface StremioTrailer {
  source: string;
  type: string;
}

export interface TrailerStream {
  title: string;
  ytId: string;
  lang: string;
}

export interface StremioVideo {
  id: string;
  season: number;
  episode: number;
  title: string;
  released?: string;
  overview?: string;
  thumbnail?: string;
  available?: boolean;
  runtime?: string;
}

export interface AppExtrasCastMember {
  name: string;
  character: string;
  photo: string | null;
}

export interface AppExtrasCrewMember {
  name: string;
  photo: string | null;
}

export interface AppExtras {
  cast: AppExtrasCastMember[];
  directors: AppExtrasCrewMember[];
  writers: AppExtrasCrewMember[];
  seasonPosters: string[];
  releaseDates: TmdbReleaseDates | TmdbContentRatings | null;
  certification: string | null;
}

export interface StremioBehaviorHints {
  defaultVideoId?: string | null;
  hasScheduledVideos?: boolean;
}

export interface ManifestBehaviorHints {
  configurable: boolean;
  configurationRequired: boolean;
  newEpisodeNotifications: boolean;
}

export interface StremioMeta {
  id: string;
  tmdbId: number;
  imdbId: string | null;
  imdb_id: string | null;
  type: ContentType;
  name: string;
  slug: string;
  poster: string | null;
  posterShape: PosterShape;
  background: string | null;
  fanart: string | null;
  landscapePoster: string | null;
  logo?: string;
  description: string;
  year?: string;
  releaseInfo: string;
  imdbRating?: string;
  genres: string[];
  cast?: string[];
  director?: string;
  writer?: string;
  runtime?: string;
  language?: string;
  country?: string;
  released?: string;
  links?: StremioLink[];
  trailer?: string;
  trailers?: StremioTrailer[];
  trailerStreams?: TrailerStream[];
  app_extras: AppExtras;
  behaviorHints: StremioBehaviorHints;
  status?: string | null;
  videos?: StremioVideo[];
}

export interface StremioMetaPreview {
  id: string;
  tmdbId: number;
  imdbId: string | null;
  imdb_id: string | null;
  type: ContentType;
  name: string;
  slug: string;
  poster: string | null;
  posterShape: PosterShape;
  background: string | null;
  fanart: string | null;
  landscapePoster: string | null;
  logo?: string;
  description: string;
  releaseInfo: string;
  imdbRating?: string;
  genres: string[];
  cast?: string[];
  director?: string;
  writer?: string;
  runtime?: string;
  links?: StremioLink[];
  behaviorHints: Record<string, unknown>;
}

export interface ManifestCatalogExtra {
  name: 'skip' | 'search' | 'genre';
  isRequired?: boolean;
  options?: string[];
  optionsLimit?: number;
}

export interface ManifestCatalog {
  id: string;
  type: ContentType;
  name: string;
  pageSize?: number;
  extra: ManifestCatalogExtra[];
}

export interface StremioManifest {
  id: string;
  name: string;
  description: string;
  version: string;
  logo: string;
  idPrefixes: string[];
  resources: string[];
  types: ContentType[];
  catalogs: ManifestCatalog[];
  behaviorHints: ManifestBehaviorHints;
}

export interface AddonExtraParams {
  skip?: string;
  search?: string | null;
  genre?: string;
  displayLanguage?: string;
  language?: string;
}

export interface CatalogResponse {
  metas: StremioMetaPreview[];
  cacheMaxAge?: number;
  staleRevalidate?: number;
}

export interface MetaResponse {
  meta: StremioMeta | Record<string, never>;
  cacheMaxAge?: number;
  staleRevalidate?: number;
  staleError?: number;
}
