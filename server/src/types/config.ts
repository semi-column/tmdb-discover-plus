import type { ContentType } from './common.ts';

export type PosterServiceType = 'none' | 'rpdb' | 'topPosters';

export interface UserPreferences {
  showAdultContent?: boolean;
  defaultLanguage?: string;
  shuffleCatalogs?: boolean;
  posterService?: PosterServiceType;
  posterApiKeyEncrypted?: string;
  posterApiKey?: string;
  disableSearch?: boolean;
  disableImdbSearch?: boolean;
  includeAdult?: boolean;
  region?: string;
  originCountry?: string;
}

export interface CatalogFilters {
  listType?: string;
  genres?: number[];
  excludeGenres?: number[];
  genreMatchMode?: import('./common.ts').GenreMatchMode;
  yearFrom?: number;
  yearTo?: number;
  ratingMin?: number;
  ratingMax?: number;
  sortBy?: string;
  language?: string;
  displayLanguage?: string;
  originCountry?: string;
  region?: string;
  includeAdult?: boolean;
  genreNames?: string[];
  discoverOnly?: boolean;
  randomize?: boolean;
  imdbOnly?: boolean;
  voteCountMin?: number;
  runtimeMin?: number;
  runtimeMax?: number;
  releaseDateFrom?: string;
  releaseDateTo?: string;
  releaseType?: number;
  releaseTypes?: number[];
  certification?: string;
  certifications?: string[];
  certificationCountry?: string;
  airDateFrom?: string;
  airDateTo?: string;
  datePreset?: string;
  withNetworks?: string;
  tvStatus?: string;
  tvType?: string;
  withCast?: string;
  withCrew?: string;
  withPeople?: string;
  withCompanies?: string;
  withKeywords?: string;
  excludeKeywords?: string;
  watchRegion?: string;
  watchProviders?: number[];
  watchMonetizationType?: string;
  watchMonetizationTypes?: string[];
  enableRatingPosters?: boolean;
}

export interface CatalogConfig {
  _id: string;
  id?: string;
  name: string;
  type: ContentType;
  source?: 'tmdb' | 'imdb';
  filters: CatalogFilters;
  enabled?: boolean;
}

export interface UserConfig {
  userId: string;
  configName?: string;
  apiKeyId?: string;
  tmdbApiKeyEncrypted?: string;
  tmdbApiKey?: string;
  catalogs: CatalogConfig[];
  preferences: UserPreferences;
  createdAt?: Date;
  updatedAt?: Date;
  baseUrl?: string;
}

export interface PosterOptions {
  apiKey: string;
  service: PosterServiceType;
}

export interface PosterUrlOptions extends PosterOptions {
  tmdbId: number | string;
  type: ContentType;
  imdbId?: string | null;
}

export interface ConfigCacheOptions {
  maxSize?: number;
  ttlMs?: number;
}

export interface ConfigCacheStats {
  size: number;
  maxSize: number;
  pendingLoads: number;
  hits: number;
  misses: number;
  evictions: number;
  coalesced: number;
}
