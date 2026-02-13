export type ContentType = 'movie' | 'series';

export type TmdbMediaType = 'movie' | 'tv';

export type PosterShape = 'poster' | 'landscape' | 'square';

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
  poster: string | null;
  posterShape: PosterShape;
  background: string | null;
  fanart: string | null;
  landscapePoster: string | null;
  description: string;
  releaseInfo: string;
  imdbRating?: string;
  genres: string[];
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

export type PosterServiceType = 'none' | 'rpdb' | 'topPosters';

export type GenreMatchMode = 'any' | 'all';

export interface UserPreferences {
  showAdultContent?: boolean;
  defaultLanguage?: string;
  shuffleCatalogs?: boolean;
  posterService?: PosterServiceType;
  posterApiKeyEncrypted?: string;
  posterApiKey?: string;
  disableSearch?: boolean;
}

export interface CatalogFilters {
  listType?: string;
  genres?: number[];
  excludeGenres?: number[];
  genreMatchMode?: GenreMatchMode;
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

export interface TmdbGenre {
  id: number;
  name: string;
}

export interface TmdbProductionCompany {
  id: number;
  name: string;
  logo_path: string | null;
  origin_country: string;
}

export interface TmdbNetwork {
  id: number;
  name: string;
  logo_path: string | null;
  origin_country?: string;
}

export interface TmdbCastMember {
  id: number;
  name: string;
  character: string;
  profile_path: string | null;
  order: number;
  popularity: number;
}

export interface TmdbCrewMember {
  id: number;
  name: string;
  job: string;
  department: string;
  profile_path: string | null;
  popularity: number;
}

export interface TmdbCredits {
  cast: TmdbCastMember[];
  crew: TmdbCrewMember[];
}

export interface TmdbExternalIds {
  imdb_id: string | null;
  tvdb_id: number | null;
  wikidata_id: string | null;
  facebook_id: string | null;
  instagram_id: string | null;
  twitter_id: string | null;
}

export interface TmdbVideoResult {
  id: string;
  key: string;
  name: string;
  site: string;
  type: string;
  iso_639_1: string;
  iso_3166_1: string;
  official: boolean;
  published_at: string;
}

export interface TmdbImage {
  file_path: string;
  iso_639_1: string | null;
  aspect_ratio: number;
  width: number;
  height: number;
  vote_average: number;
  vote_count: number;
}

export interface TmdbImages {
  logos: TmdbImage[];
  posters: TmdbImage[];
  backdrops: TmdbImage[];
}

export interface TmdbReleaseDateEntry {
  certification: string;
  iso_639_1: string;
  note: string;
  release_date: string;
  type: number;
}

export interface TmdbReleaseDateResult {
  iso_3166_1: string;
  release_dates: TmdbReleaseDateEntry[];
}

export interface TmdbReleaseDates {
  results: TmdbReleaseDateResult[];
}

export interface TmdbContentRatingResult {
  iso_3166_1: string;
  rating: string;
  descriptors?: string[];
}

export interface TmdbContentRatings {
  results: TmdbContentRatingResult[];
}

export interface TmdbCreatedBy {
  id: number;
  name: string;
  profile_path: string | null;
}

export interface TmdbSeason {
  id: number;
  season_number: number;
  name: string;
  overview: string;
  poster_path: string | null;
  air_date: string | null;
  episode_count: number;
  vote_average: number;
}

export interface TmdbEpisodeSummary {
  id: number;
  name: string;
  overview: string;
  season_number: number;
  episode_number: number;
  runtime: number | null;
}

export interface TmdbMovieResult {
  id: number;
  title: string;
  original_title: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  genre_ids: number[];
  genres?: TmdbGenre[];
  release_date: string;
  popularity: number;
  vote_average: number;
  vote_count: number;
  original_language: string;
  adult: boolean;
  video: boolean;
  imdb_id?: string;
}

export interface TmdbTvResult {
  id: number;
  name: string;
  original_name: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  genre_ids: number[];
  genres?: TmdbGenre[];
  first_air_date: string;
  popularity: number;
  vote_average: number;
  vote_count: number;
  original_language: string;
  origin_country: string[];
  imdb_id?: string;
}

export type TmdbResult = TmdbMovieResult | TmdbTvResult;

export interface TmdbPaginatedResponse<T = TmdbResult> {
  page: number;
  results: T[];
  total_pages: number;
  total_results: number;
}

export type TmdbDiscoverResponse = TmdbPaginatedResponse<TmdbResult>;
export type TmdbSearchResponse = TmdbPaginatedResponse<TmdbResult>;

export interface TmdbMovieDetails {
  id: number;
  title: string;
  original_title: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  genres: TmdbGenre[];
  release_date: string;
  runtime: number | null;
  status: string;
  revenue: number;
  budget: number;
  popularity: number;
  vote_average: number;
  vote_count: number;
  original_language: string;
  origin_country: string[];
  adult: boolean;
  video: boolean;
  production_companies: TmdbProductionCompany[];
  external_ids?: TmdbExternalIds;
  credits?: TmdbCredits;
  videos?: { results: TmdbVideoResult[] };
  release_dates?: TmdbReleaseDates;
  images?: TmdbImages;
}

export interface TmdbTvDetails {
  id: number;
  name: string;
  original_name: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  genres: TmdbGenre[];
  first_air_date: string;
  last_air_date: string | null;
  episode_run_time: number[];
  status: string;
  type: string;
  popularity: number;
  vote_average: number;
  vote_count: number;
  original_language: string;
  origin_country: string[];
  seasons: TmdbSeason[];
  networks: TmdbNetwork[];
  created_by: TmdbCreatedBy[];
  production_companies: TmdbProductionCompany[];
  number_of_seasons: number;
  number_of_episodes: number;
  last_episode_to_air: TmdbEpisodeSummary | null;
  next_episode_to_air: TmdbEpisodeSummary | null;
  external_ids?: TmdbExternalIds;
  credits?: TmdbCredits;
  videos?: { results: TmdbVideoResult[] };
  content_ratings?: TmdbContentRatings;
  images?: TmdbImages;
}

export type TmdbDetails = TmdbMovieDetails | TmdbTvDetails;

export interface TmdbEpisode {
  id: number;
  name: string;
  overview: string;
  season_number: number;
  episode_number: number;
  air_date: string | null;
  still_path: string | null;
  runtime: number | null;
  vote_average: number;
  vote_count: number;
  production_code: string;
  show_id: number;
}

export interface TmdbSeasonDetails {
  id: number;
  name: string;
  overview: string;
  season_number: number;
  air_date: string | null;
  poster_path: string | null;
  episodes: TmdbEpisode[];
}

export interface TmdbFindResponse {
  movie_results: TmdbMovieResult[];
  tv_results: TmdbTvResult[];
  person_results: TmdbPersonResult[];
}

export interface TmdbPersonResult {
  id: number;
  name: string;
  profile_path: string | null;
  known_for_department: string;
  popularity: number;
  known_for?: TmdbResult[];
}

export interface PersonSearchResult {
  id: number;
  name: string;
  profilePath: string | null;
  knownFor?: string;
}

export interface CompanySearchResult {
  id: number;
  name: string;
  logoPath: string | null;
}

export interface KeywordSearchResult {
  id: number;
  name: string;
}

export interface NetworkSearchResult {
  id: number;
  name: string;
  logoPath: string | null;
}

export interface TmdbLanguage {
  iso_639_1: string;
  english_name: string;
  name: string;
}

export interface TmdbCountry {
  iso_3166_1: string;
  english_name: string;
  native_name?: string;
}

export interface TmdbCertification {
  certification: string;
  meaning: string;
  order: number;
}

export type TmdbCertificationMap = Record<string, TmdbCertification[]>;

export interface TmdbWatchRegion {
  iso_3166_1: string;
  english_name: string;
  native_name: string;
}

export interface TmdbWatchProvider {
  provider_id: number;
  provider_name: string;
  logo_path: string;
  display_priority: number;
  display_priorities: Record<string, number>;
}

export interface ReferenceOption {
  value: string | number;
  label: string;
  description?: string;
}

export interface TvNetworkEntry {
  id: number;
  name: string;
  logo: string;
}

export interface DiscoverOptions {
  type?: ContentType;
  genres?: number[];
  excludeGenres?: number[];
  genreMatchMode?: GenreMatchMode;
  yearFrom?: number;
  yearTo?: number;
  ratingMin?: number;
  ratingMax?: number;
  sortBy?: string;
  language?: string;
  displayLanguage?: string;
  originCountry?: string | string[];
  includeAdult?: boolean;
  includeVideo?: boolean;
  voteCountMin?: number;
  page?: number;
  randomize?: boolean;
  releaseDateFrom?: string;
  releaseDateTo?: string;
  releaseTypes?: number[];
  releaseType?: number;
  certification?: string;
  certifications?: string[];
  certificationMin?: string;
  certificationMax?: string;
  certificationCountry?: string;
  primaryReleaseYear?: number;
  runtimeMin?: number;
  runtimeMax?: number;
  withCast?: string;
  withCrew?: string;
  withPeople?: string;
  withCompanies?: string;
  withKeywords?: string;
  excludeKeywords?: string;
  excludeCompanies?: string;
  region?: string;
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
  watchRegion?: string;
  watchProviders?: number[];
  watchMonetizationTypes?: string[];
  watchMonetizationType?: string;
}

export interface SpecialListOptions {
  page?: number;
  language?: string;
  displayLanguage?: string;
  region?: string;
  randomize?: boolean;
}

export type SpecialListType =
  | 'trending_day'
  | 'trending_week'
  | 'now_playing'
  | 'upcoming'
  | 'airing_today'
  | 'on_the_air'
  | 'top_rated'
  | 'popular'
  | 'random';

export interface ICacheAdapter {
  get(key: string): Promise<unknown | null>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
}

export type CacheErrorType =
  | 'EMPTY_RESULT'
  | 'RATE_LIMITED'
  | 'TEMPORARY_ERROR'
  | 'PERMANENT_ERROR'
  | 'NOT_FOUND'
  | 'CACHE_CORRUPTED';

export interface CacheWrapperEntry {
  __cacheWrapper: true;
  __storedAt: number;
  __ttl: number;
  data: unknown;
  __errorType?: CacheErrorType;
  __errorMessage?: string;
  __isStale?: boolean;
}

export interface CacheWrapperStats {
  hits: number;
  misses: number;
  errors: number;
  cachedErrors: number;
  corruptedEntries: number;
  deduplicatedRequests: number;
  staleServed: number;
  hitRate: string;
  inFlightRequests: number;
}

export interface CacheWrapOptions {
  allowStale?: boolean;
}

export interface IStorageAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getUserConfig(userId: string): Promise<UserConfig | null>;
  saveUserConfig(config: UserConfig): Promise<UserConfig>;
  getConfigsByApiKeyId(apiKeyId: string): Promise<UserConfig[]>;
  deleteUserConfig(userId: string): Promise<boolean>;
  getPublicStats(): Promise<PublicStats>;
}

export interface PublicStats {
  totalUsers: number;
  totalCatalogs: number;
}

export interface IImdbRatingsAdapter {
  set(imdbId: string, value: string): Promise<void>;
  get(imdbId: string): Promise<string | null>;
  getMany(imdbIds: string[]): Promise<Map<string, string>>;
  setBatch(entries: [string, string][]): Promise<void>;
  clear(): Promise<void>;
  count(): Promise<number>;
  setMeta(key: string, value: string): Promise<void>;
  getMeta(key: string): Promise<string | null>;
  delMeta(key: string): Promise<void>;
  destroy(): Promise<void>;
}

export interface ImdbRating {
  rating: number;
  votes: number;
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

export type GenreMap = Record<string, string>;

export type StaticGenreMap = {
  movie: Record<string, string>;
  tv: Record<string, string>;
};

export type GenreCache = {
  movie: Record<string, TmdbGenre[]>;
  tv: Record<string, TmdbGenre[]>;
};

export interface ApiKeyValidationResult {
  valid: boolean;
  error?: string;
}

export interface ComprehensiveSearchOptions {
  displayLanguage?: string;
  language?: string;
  includeAdult?: boolean;
}

export interface ComprehensiveSearchResponse {
  results: TmdbResult[];
  total_results: number;
  page: number;
}

export interface TmdbPersonCredit {
  id: number;
  title?: string;
  name?: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  genre_ids: number[];
  release_date?: string;
  first_air_date?: string;
  popularity: number;
  vote_average: number;
  vote_count: number;
  original_language: string;
  character?: string;
  job?: string;
  department?: string;
}

export interface TmdbPersonCreditsResponse {
  cast: TmdbPersonCredit[];
  crew: TmdbPersonCredit[];
}

export type UsToLocalRatingsMap = Record<string, Record<string, string>>;

export interface Logger {
  debug(message: string, data?: Record<string, unknown> | null): void;
  info(message: string, data?: Record<string, unknown> | null): void;
  warn(message: string, data?: Record<string, unknown> | null): void;
  error(message: string, data?: Record<string, unknown> | null): void;
}
