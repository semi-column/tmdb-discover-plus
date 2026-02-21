import type { ContentType, PosterServiceType } from '../../types/index.ts';

export interface ImdbImage {
  id?: string;
  createdOn?: string;
  url: string;
  width: number;
  height: number;
  caption?: string;
}

export interface ImdbPerson {
  id: string;
  url: string;
  fullName: string;
  primaryImage: ImdbImage | null;
}

export interface ImdbCastMember extends ImdbPerson {
  characters?: string[];
  images?: ImdbImage[];
}

export interface ImdbReleaseDate {
  month: number | null;
  day: number | null;
  year: number;
  date: string;
  country: { name: string; id: string } | null;
}

export interface ImdbProductionCompany {
  id: string;
  name: string;
}

export interface ImdbExternalLink {
  url: string;
  label: string;
}

export interface ImdbTitle {
  id: string;
  url: string;
  primaryTitle: string;
  originalTitle: string;
  type: string;
  description: string;
  primaryImage: ImdbImage | null;
  posterImages?: ImdbImage[];
  trailer?: string;
  contentRating?: string;
  startYear: number;
  endYear?: number | null;
  releaseDate: ImdbReleaseDate | null;
  interests?: string[];
  countriesOfOrigin?: string[];
  externalLinks?: ImdbExternalLink[];
  spokenLanguages?: string[];
  filmingLocations?: string[];
  productionCompanies?: ImdbProductionCompany[];
  budget?: number;
  grossWorldwide?: number;
  genres: string[];
  isAdult: boolean;
  runtimeMinutes: number;
  averageRating: number;
  numVotes: number;
  metascore?: number;
  directors: ImdbPerson[];
  writers: ImdbPerson[];
  cast: ImdbCastMember[];
}

export interface ImdbPageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

export interface ImdbSearchResult {
  titles: ImdbTitle[];
  pageInfo: ImdbPageInfo;
  totalCount?: number;
}

export interface ImdbRankingEntry extends ImdbTitle {
  chartRating?: number;
  chartPosition?: number;
  rankChange?: number;
}

export interface ImdbRankingResult {
  titles: ImdbRankingEntry[];
  pageInfo?: ImdbPageInfo;
}

export interface ImdbListItem extends ImdbTitle {
  listPosition?: number;
}

export interface ImdbListResult {
  titles: ImdbListItem[];
  pageInfo: ImdbPageInfo;
  listName?: string;
  listDescription?: string;
}

export interface ImdbSuggestion {
  image: { height: number; imageUrl: string; width: number } | null;
  id: string;
  label: string;
  description: string;
  rank?: number;
  qualifier?: string;
  qualifierId?: string;
  year?: number;
}

export interface ImdbSuggestionsResult {
  suggestions: ImdbSuggestion[];
  query: string;
  version: number;
}

export type ImdbSortBy =
  | 'POPULARITY'
  | 'TITLE_REGIONAL'
  | 'USER_RATING'
  | 'USER_RATING_COUNT'
  | 'BOX_OFFICE_GROSS_DOMESTIC'
  | 'RUNTIME'
  | 'YEAR'
  | 'RELEASE_DATE';

export type ImdbSortOrder = 'ASC' | 'DESC';

export type ImdbTitleType =
  | 'movie'
  | 'tvSeries'
  | 'short'
  | 'tvEpisode'
  | 'tvMiniSeries'
  | 'tvMovie'
  | 'tvSpecial'
  | 'tvShort'
  | 'videoGame'
  | 'video'
  | 'musicVideo'
  | 'podcastSeries'
  | 'podcastEpisode';

export const IMDB_GENRES = [
  'Action',
  'Adult',
  'Adventure',
  'Animation',
  'Biography',
  'Comedy',
  'Crime',
  'Documentary',
  'Drama',
  'Family',
  'Fantasy',
  'Film-Noir',
  'Game-Show',
  'History',
  'Horror',
  'Music',
  'Musical',
  'Mystery',
  'News',
  'Reality-Tv',
  'Romance',
  'Sci-Fi',
  'Short',
  'Sport',
  'Talk-Show',
  'Thriller',
  'War',
  'Western',
] as const;

export type ImdbGenre = (typeof IMDB_GENRES)[number];

export const IMDB_KEYWORDS = [
  'action-hero',
  'alien-invasion',
  'alternate-history',
  'anime',
  'anti-hero',
  'avant-garde',
  'b-movie',
  'bank-robbery',
  'based-on-book',
  'based-on-comic-book',
  'based-on-novel',
  'based-on-play',
  'based-on-true-story',
  'bechdel-test-passed',
  'black-comedy',
  'bollywood',
  'caper',
  'chick-flick',
  'coming-of-age',
  'conspiracy',
  'criminal-mastermind',
  'cult-film',
  'cyberpunk',
  'dark-fantasy',
  'dc-comics',
  'dystopia',
  'epic',
  'espionage',
  'experimental-film',
  'f-rated',
  'fairy-tale',
  'femme-fatale',
  'futuristic',
  'good-versus-evil',
  'haunting',
  'heist',
  'high-school',
  'independent-film',
  'kidnapping',
  'kung-fu',
  'lgbtq',
  'magical-realism',
  'marvel-comics',
  'mockumentary',
  'monster',
  'on-the-run',
  'one-man-army',
  'parallel-world',
  'paranormal-phenomenon',
  'parenthood',
  'parody',
  'police-detective',
  'post-apocalypse',
  'postmodern',
  'redemption',
  'rescue',
  'road-movie',
  'robbery',
  'satire',
  'sequel',
  'space-travel',
  'spaghetti-western',
  'spoof',
  'steampunk',
  'superhero',
  'supernatural-power',
  'swashbuckler',
  'time-travel',
  'triple-f-rated',
  'vampire',
  'zombie',
] as const;

export type ImdbKeyword = (typeof IMDB_KEYWORDS)[number];

export const IMDB_AWARDS = [
  'oscar',
  'best_picture_oscar',
  'best_director_oscar',
  'golden_globe',
  'emmy',
] as const;

export type ImdbAward = (typeof IMDB_AWARDS)[number];

export const IMDB_SORT_OPTIONS = [
  { value: 'POPULARITY', label: 'Popularity' },
  { value: 'USER_RATING', label: 'IMDb Rating' },
  { value: 'USER_RATING_COUNT', label: 'Number of Votes' },
  { value: 'YEAR', label: 'Year' },
  { value: 'RELEASE_DATE', label: 'Release Date' },
  { value: 'TITLE_REGIONAL', label: 'Title (A-Z)' },
  { value: 'BOX_OFFICE_GROSS_DOMESTIC', label: 'Box Office' },
  { value: 'RUNTIME', label: 'Runtime' },
] as const;

export const IMDB_TITLE_TYPES = [
  { value: 'movie', label: 'Movie' },
  { value: 'tvSeries', label: 'TV Series' },
  { value: 'tvMiniSeries', label: 'TV Mini-Series' },
  { value: 'tvMovie', label: 'TV Movie' },
  { value: 'short', label: 'Short Film' },
  { value: 'tvSpecial', label: 'TV Special' },
  { value: 'video', label: 'Video' },
] as const;

export interface ImdbAdvancedSearchParams {
  query?: string;
  types?: ImdbTitleType[];
  genres?: string[];
  sortBy?: ImdbSortBy;
  sortOrder?: ImdbSortOrder;
  imdbRatingMin?: number;
  totalVotesMin?: number;
  releaseDateStart?: string;
  releaseDateEnd?: string;
  runtimeMin?: number;
  runtimeMax?: number;
  languages?: string[];
  countries?: string[];
  imdbCountries?: string[];
  keywords?: string[];
  awardsWon?: string[];
  awardsNominated?: string[];
  limit?: number;
  endCursor?: string;
}

export interface ImdbCatalogFilters {
  source: 'imdb';
  listType?: 'discover' | 'top250' | 'popular' | 'imdb_list';
  imdbListId?: string;
  query?: string;
  genres?: string[];
  sortBy?: ImdbSortBy;
  sortOrder?: ImdbSortOrder;
  imdbRatingMin?: number;
  totalVotesMin?: number;
  releaseDateStart?: string;
  releaseDateEnd?: string;
  runtimeMin?: number;
  runtimeMax?: number;
  languages?: string[];
  countries?: string[];
  keywords?: string[];
  awardsWon?: string[];
  awardsNominated?: string[];
  types?: ImdbTitleType[];
  enableRatingPosters?: boolean;
}

export interface ImdbPosterOptions {
  apiKey: string;
  service: PosterServiceType;
}

export const IMDB_PRESET_CATALOGS = {
  movie: [
    { value: 'top250', label: '🏆 Top 250 Movies', description: 'IMDb Top 250 rated movies' },
    {
      value: 'popular',
      label: '🔥 Most Popular Movies',
      description: 'Most popular movies on IMDb right now',
    },
  ],
  series: [
    { value: 'top250', label: '🏆 Top 250 TV Shows', description: 'IMDb Top 250 rated TV shows' },
    {
      value: 'popular',
      label: '🔥 Most Popular TV Shows',
      description: 'Most popular TV shows on IMDb right now',
    },
  ],
} as const;
