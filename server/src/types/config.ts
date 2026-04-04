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
  countries?: string;
}

export interface BaseCatalogFilters {
  sortBy?: string;
  genres?: number[];
  excludeGenres?: number[];
  genreMatchMode?: import('./common.ts').GenreMatchMode;
  yearFrom?: number;
  yearTo?: number;
  ratingMin?: number;
  ratingMax?: number;
  runtimeMin?: number;
  runtimeMax?: number;
  language?: string;
  countries?: string;
  certifications?: string[];
  certificationCountry?: string;
  excludeKeywords?: string | string[];
  includeAdult?: boolean;
  randomize?: boolean;
  discoverOnly?: boolean;
  query?: string;
  genreNames?: string[];
}

export interface TmdbCatalogFilters extends BaseCatalogFilters {
  listType?: string;
  voteCountMin?: number;
  imdbOnly?: boolean;
  displayLanguage?: string;
  region?: string;
  releaseType?: number;
  releaseTypes?: number[];
  releaseDateFrom?: string;
  releaseDateTo?: string;
  primaryReleaseYear?: number;
  includeVideo?: boolean;
  airDateFrom?: string;
  airDateTo?: string;
  firstAirDateFrom?: string;
  firstAirDateTo?: string;
  firstAirDateYear?: number;
  includeNullFirstAirDates?: boolean;
  screenedTheatrically?: boolean;
  timezone?: string;
  withNetworks?: string;
  tvStatus?: string;
  tvType?: string;
  withPeople?: string;
  withCast?: string;
  withCrew?: string;
  withCompanies?: string;
  withKeywords?: string;
  excludeCompanies?: string;
  watchRegion?: string;
  watchProviders?: number[];
  watchMonetizationType?: string;
  watchMonetizationTypes?: string[];
  releasedOnly?: boolean;
  lastXYears?: number;
  certificationMin?: string;
  certificationMax?: string;
  datePreset?: string;
  certification?: string;
}

export interface ImdbCatalogFilters extends BaseCatalogFilters {
  imdbListId?: string;
  imdbRatingMin?: number;
  imdbRatingMax?: number;
  totalVotesMin?: number;
  totalVotesMax?: number;
  releaseDateStart?: string;
  releaseDateEnd?: string;
  imdbCountries?: string[];
  languages?: string[];
  keywords?: string[];
  awardsWon?: string[];
  awardsNominated?: string[];
  types?: string[];
  sortOrder?: string;
  rankedList?: string;
  rankedLists?: string[];
  excludeRankedLists?: string[];
  rankedListMaxRank?: number;
  creditedNames?: string[];
  companies?: string[];
  excludeCompanies?: string[];
  certificateRating?: string;
  certificateCountry?: string;
  certificates?: string[];
  explicitContent?: string;
  plot?: string | string[];
  filmingLocations?: string | string[];
  withData?: string[];
  inTheatersLat?: number;
  inTheatersLong?: number;
  inTheatersRadius?: number;
}

export interface AnilistCatalogFilters extends BaseCatalogFilters {
  anilistSort?: string;
  format?: string[];
  status?: string[];
  season?: string;
  seasonYear?: number;
  tags?: string[];
  excludeTags?: string[];
  tagCategories?: string[];
  countryOfOrigin?: string;
  sourceMaterial?: string[];
  averageScoreMin?: number;
  averageScoreMax?: number;
  popularityMin?: number;
  episodesMin?: number;
  episodesMax?: number;
  durationMin?: number;
  durationMax?: number;
  isAdult?: boolean;
}

export interface MalCatalogFilters extends BaseCatalogFilters {
  malRankingType?: string;
  malSeason?: string;
  malSeasonYear?: number;
  malMediaType?: string[];
  malStatus?: string[];
  malSort?: string;
  malRating?: string;
  malGenres?: number[];
  malExcludeGenres?: number[];
  malScoreMin?: number;
  malScoreMax?: number;
  malOrderBy?: string;
}

export interface SimklCatalogFilters extends BaseCatalogFilters {
  simklListType?: string;
  simklTrendingPeriod?: string;
  simklGenre?: string;
  simklType?: string;
  simklSort?: string;
  simklBestFilter?: string;
  simklYear?: string;
  simklNetwork?: string;
}

export type SourceType = 'tmdb' | 'imdb' | 'anilist' | 'mal' | 'simkl';

export type CatalogFilters = TmdbCatalogFilters &
  ImdbCatalogFilters &
  AnilistCatalogFilters &
  MalCatalogFilters &
  SimklCatalogFilters;

export interface CatalogFormState {
  selectedPeople?: Array<{ id: number | string; name: string; profile_path?: string }>;
  selectedCompanies?: Array<{ id: number | string; name: string; logo_path?: string }>;
  selectedKeywords?: Array<{ id: number | string; name: string }>;
  excludeKeywords?: Array<{ id: number | string; name: string }>;
  excludeCompanies?: Array<{ id: number | string; name: string; logo_path?: string }>;
  selectedNetworks?: Array<{ id: number | string; name: string; logo_path?: string }>;
  expandedSections?: Record<string, boolean>;
}

export interface CatalogConfig {
  _id: string;
  id?: string;
  name: string;
  type: ContentType;
  source?: SourceType;
  filters: CatalogFilters;
  formState?: CatalogFormState;
  enabled?: boolean;
}

export interface UserConfig {
  userId: string;
  configName?: string;
  apiKeyId?: string;
  tmdbApiKeyEncrypted?: string;
  tmdbApiKey?: string;
  malClientIdEncrypted?: string;
  malClientId?: string;
  simklApiKeyEncrypted?: string;
  simklApiKey?: string;
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
