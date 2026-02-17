import type { ContentType, GenreMatchMode } from './common.ts';

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
