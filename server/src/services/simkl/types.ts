export interface SimklAnime {
  title: string;
  year?: number;
  type?: string;
  anime_type?: string;
  ids: {
    simkl?: number;
    simkl_id?: number;
    slug?: string;
    imdb?: string;
    tmdb?: string;
    mal?: string;
    anidb?: string;
    anilist?: string;
    kitsu?: string;
    livechart?: string;
    animeplanet?: string;
    anisearch?: string;
  };
  poster?: string;
  fanart?: string;
  overview?: string;
  genres?: string[];
  status?: string;
  runtime?: number;
  total_episodes?: number;
  rank?: number;
  ratings?: {
    simkl?: { rating: number; votes: number };
    imdb?: { rating: number; votes: number };
    mal?: { rating: number; votes: number };
  };
  certification?: string;
  trailers?: Array<{ name?: string; youtube?: string; url?: string }>;
  url?: string;
}

export interface SimklTrendingItem {
  title: string;
  year?: number;
  type?: string;
  ids: SimklAnime['ids'];
  poster?: string;
  fanart?: string;
  rank?: number;
  ratings?: SimklAnime['ratings'];
  anime_type?: string;
}

export interface SimklSearchResult {
  title: string;
  year?: number;
  type?: string;
  ids: SimklAnime['ids'];
  poster?: string;
  all_titles?: string[];
}

export const SIMKL_LIST_TYPES = [
  { value: 'trending', label: 'Trending' },
  { value: 'best', label: 'Best' },
  { value: 'genre', label: 'By Genre' },
  { value: 'premieres', label: 'Premieres' },
  { value: 'airing', label: 'Airing' },
] as const;

export const SIMKL_TRENDING_PERIODS = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
] as const;

export const SIMKL_BEST_FILTERS = [
  { value: 'voted', label: 'Top Voted' },
  { value: 'watched', label: 'Most Watched' },
  { value: 'year', label: 'Best of Year' },
  { value: 'month', label: 'Best of Month' },
  { value: 'all', label: 'All Time' },
] as const;

export const SIMKL_ANIME_TYPES = [
  { value: 'all', label: 'All' },
  { value: 'tv', label: 'TV' },
  { value: 'movies', label: 'Movies' },
  { value: 'ovas', label: 'OVA' },
  { value: 'onas', label: 'ONA' },
] as const;

export const SIMKL_SORT_OPTIONS = [
  { value: 'rank', label: 'Rank' },
  { value: 'votes', label: 'Votes' },
  { value: 'release', label: 'Release Date' },
  { value: 'title', label: 'Title' },
] as const;

export const SIMKL_GENRES = [
  'Action',
  'Adventure',
  'Comedy',
  'Drama',
  'Fantasy',
  'Gore',
  'Harem',
  'Historical',
  'Horror',
  'Isekai',
  'Josei',
  'Magic',
  'Martial Arts',
  'Mecha',
  'Military',
  'Music',
  'Mystery',
  'Parody',
  'Psychological',
  'Racing',
  'Reincarnation',
  'Romance',
  'Samurai',
  'School',
  'Sci-Fi',
  'Seinen',
  'Shounen',
  'Slice of Life',
  'Sports',
  'Super Power',
  'Supernatural',
  'Thriller',
] as const;

export const SIMKL_IMAGE_BASE = 'https://wsrv.nl/?url=https://simkl.in';
