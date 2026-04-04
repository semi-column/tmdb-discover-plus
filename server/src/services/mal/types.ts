export interface JikanAnime {
  mal_id: number;
  url: string;
  images: {
    jpg: { image_url?: string; small_image_url?: string; large_image_url?: string };
    webp?: { image_url?: string; small_image_url?: string; large_image_url?: string };
  };
  trailer?: { youtube_id?: string; url?: string };
  title: string;
  title_english?: string | null;
  title_japanese?: string | null;
  titles?: Array<{ type: string; title: string }>;
  type?: string | null;
  source?: string | null;
  episodes?: number | null;
  status?: string | null;
  airing?: boolean;
  aired?: { from?: string | null; to?: string | null; string?: string };
  duration?: string | null;
  rating?: string | null;
  score?: number | null;
  scored_by?: number | null;
  rank?: number | null;
  popularity?: number | null;
  members?: number;
  favorites?: number;
  synopsis?: string | null;
  season?: string | null;
  year?: number | null;
  studios?: Array<{ mal_id: number; type: string; name: string; url: string }>;
  genres?: Array<{ mal_id: number; type: string; name: string; url: string }>;
  themes?: Array<{ mal_id: number; type: string; name: string; url: string }>;
  demographics?: Array<{ mal_id: number; type: string; name: string; url: string }>;
}

// Keep MalAnime as alias for backward compatibility with stremioMeta.ts
export interface MalAnime {
  id: number;
  title: string;
  main_picture?: { medium?: string; large?: string };
  alternative_titles?: { en?: string; ja?: string };
  start_date?: string;
  synopsis?: string;
  mean?: number;
  rank?: number;
  popularity?: number;
  genres?: Array<{ id: number; name: string }>;
  media_type?: string;
  status?: string;
  num_episodes?: number;
  start_season?: { year: number; season: string };
  source?: string;
  studios?: Array<{ id: number; name: string }>;
}

export interface JikanPagination {
  last_visible_page: number;
  has_next_page: boolean;
  current_page: number;
  items: { count: number; total: number; per_page: number };
}

export interface JikanResponse {
  pagination: JikanPagination;
  data: JikanAnime[];
}

/**
 * Convert a Jikan anime object to the MalAnime shape used by stremioMeta.ts.
 * This avoids rewriting the conversion layer.
 */
export function jikanToMalAnime(j: JikanAnime): MalAnime {
  return {
    id: j.mal_id,
    title: j.title,
    main_picture: {
      large: j.images?.jpg?.large_image_url || j.images?.webp?.large_image_url,
      medium: j.images?.jpg?.image_url || j.images?.webp?.image_url,
    },
    alternative_titles: {
      en: j.title_english || undefined,
      ja: j.title_japanese || undefined,
    },
    start_date: j.aired?.from?.split('T')[0] || undefined,
    synopsis: j.synopsis || undefined,
    mean: j.score || undefined,
    rank: j.rank || undefined,
    popularity: j.popularity || undefined,
    genres: [...(j.genres || []), ...(j.themes || []), ...(j.demographics || [])].map((g) => ({
      id: g.mal_id,
      name: g.name,
    })),
    media_type: j.type?.toLowerCase() || undefined,
    status: j.status || undefined,
    num_episodes: j.episodes || undefined,
    start_season: j.season && j.year ? { year: j.year, season: j.season } : undefined,
    source: j.source || undefined,
    studios: j.studios?.map((s) => ({ id: s.mal_id, name: s.name })),
  };
}

export const MAL_RANKING_TYPES = [
  { value: 'all', label: 'Top Anime' },
  { value: 'airing', label: 'Top Airing' },
  { value: 'upcoming', label: 'Top Upcoming' },
  { value: 'tv', label: 'Top TV Series' },
  { value: 'movie', label: 'Top Movies' },
  { value: 'ova', label: 'Top OVA' },
  { value: 'special', label: 'Top Specials' },
  { value: 'bypopularity', label: 'Most Popular' },
  { value: 'favorite', label: 'Most Favorited' },
] as const;

export const MAL_SORT_OPTIONS = [
  { value: 'anime_score', label: 'Score' },
  { value: 'anime_num_list_users', label: 'Members' },
] as const;

export const MAL_ORDER_BY_OPTIONS = [
  { value: 'score', label: 'Score' },
  { value: 'popularity', label: 'Popularity' },
  { value: 'rank', label: 'Rank' },
  { value: 'members', label: 'Members' },
  { value: 'favorites', label: 'Favorites' },
  { value: 'start_date', label: 'Start Date' },
  { value: 'episodes', label: 'Episodes' },
  { value: 'title', label: 'Title' },
] as const;

export const MAL_MEDIA_TYPES = [
  { value: 'tv', label: 'TV' },
  { value: 'movie', label: 'Movie' },
  { value: 'ova', label: 'OVA' },
  { value: 'ona', label: 'ONA' },
  { value: 'special', label: 'Special' },
  { value: 'music', label: 'Music' },
] as const;

export const MAL_STATUSES = [
  { value: 'airing', label: 'Airing' },
  { value: 'complete', label: 'Finished' },
  { value: 'upcoming', label: 'Upcoming' },
] as const;

export const MAL_RATINGS = [
  { value: 'g', label: 'G - All Ages' },
  { value: 'pg', label: 'PG - Children' },
  { value: 'pg_13', label: 'PG-13 - Teens 13+' },
  { value: 'r', label: 'R - 17+' },
  { value: 'r+', label: 'R+ - Mild Nudity' },
] as const;

export const MAL_GENRES: Array<{ id: number; name: string }> = [
  { id: 1, name: 'Action' },
  { id: 2, name: 'Adventure' },
  { id: 5, name: 'Avant Garde' },
  { id: 46, name: 'Award Winning' },
  { id: 28, name: 'Boys Love' },
  { id: 4, name: 'Comedy' },
  { id: 8, name: 'Drama' },
  { id: 10, name: 'Fantasy' },
  { id: 26, name: 'Girls Love' },
  { id: 47, name: 'Gourmet' },
  { id: 14, name: 'Horror' },
  { id: 7, name: 'Mystery' },
  { id: 22, name: 'Romance' },
  { id: 24, name: 'Sci-Fi' },
  { id: 36, name: 'Slice of Life' },
  { id: 30, name: 'Sports' },
  { id: 37, name: 'Supernatural' },
  { id: 41, name: 'Suspense' },
  { id: 9, name: 'Ecchi' },
  { id: 49, name: 'Erotica' },
  { id: 12, name: 'Hentai' },
  { id: 50, name: 'Adult Cast' },
  { id: 51, name: 'Anthropomorphic' },
  { id: 52, name: 'CGDCT' },
  { id: 53, name: 'Childcare' },
  { id: 54, name: 'Combat Sports' },
  { id: 81, name: 'Crossdressing' },
  { id: 55, name: 'Delinquents' },
  { id: 39, name: 'Detective' },
  { id: 56, name: 'Educational' },
  { id: 57, name: 'Gag Humor' },
  { id: 58, name: 'Gore' },
  { id: 35, name: 'Harem' },
  { id: 59, name: 'High Stakes Game' },
  { id: 13, name: 'Historical' },
  { id: 60, name: 'Idols (Female)' },
  { id: 61, name: 'Idols (Male)' },
  { id: 62, name: 'Isekai' },
  { id: 63, name: 'Iyashikei' },
  { id: 64, name: 'Love Polygon' },
  { id: 66, name: 'Mahou Shoujo' },
  { id: 17, name: 'Martial Arts' },
  { id: 18, name: 'Mecha' },
  { id: 67, name: 'Medical' },
  { id: 38, name: 'Military' },
  { id: 19, name: 'Music' },
  { id: 6, name: 'Mythology' },
  { id: 68, name: 'Organized Crime' },
  { id: 69, name: 'Otaku Culture' },
  { id: 20, name: 'Parody' },
  { id: 70, name: 'Performing Arts' },
  { id: 71, name: 'Pets' },
  { id: 40, name: 'Psychological' },
  { id: 3, name: 'Racing' },
  { id: 72, name: 'Reincarnation' },
  { id: 73, name: 'Reverse Harem' },
  { id: 21, name: 'Samurai' },
  { id: 23, name: 'School' },
  { id: 74, name: 'Showbiz' },
  { id: 29, name: 'Space' },
  { id: 75, name: 'Strategy Game' },
  { id: 31, name: 'Super Power' },
  { id: 76, name: 'Survival' },
  { id: 77, name: 'Team Sports' },
  { id: 78, name: 'Time Travel' },
  { id: 32, name: 'Vampire' },
  { id: 79, name: 'Video Game' },
  { id: 80, name: 'Villainess' },
  { id: 48, name: 'Workplace' },
  { id: 15, name: 'Kids' },
  { id: 42, name: 'Seinen' },
  { id: 25, name: 'Shoujo' },
  { id: 27, name: 'Shounen' },
  { id: 43, name: 'Josei' },
];

export const MAL_SEASONS = ['winter', 'spring', 'summer', 'fall'] as const;
