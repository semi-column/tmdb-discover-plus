export interface AnilistMedia {
  id: number;
  idMal?: number;
  title: {
    romaji?: string;
    english?: string;
    native?: string;
    userPreferred?: string;
  };
  type: string;
  format: string;
  status: string;
  description?: string;
  startDate?: { year?: number; month?: number; day?: number };
  endDate?: { year?: number; month?: number; day?: number };
  season?: string;
  seasonYear?: number;
  episodes?: number;
  duration?: number;
  countryOfOrigin?: string;
  source?: string;
  coverImage?: {
    extraLarge?: string;
    large?: string;
    medium?: string;
    color?: string;
  };
  bannerImage?: string;
  genres?: string[];
  tags?: Array<{ id: number; name: string; rank: number; category?: string; isAdult?: boolean }>;
  averageScore?: number;
  meanScore?: number;
  popularity?: number;
  trending?: number;
  favourites?: number;
  isAdult?: boolean;
  studios?: {
    nodes?: Array<{ id: number; name: string; isAnimationStudio?: boolean }>;
  };
  nextAiringEpisode?: {
    airingAt: number;
    episode: number;
    timeUntilAiring: number;
  };
  externalLinks?: Array<{ url?: string; site: string; type?: string }>;
  trailer?: { id?: string; site?: string; thumbnail?: string };
  siteUrl?: string;
}

export interface AnilistPageInfo {
  total: number;
  perPage: number;
  currentPage: number;
  lastPage: number;
  hasNextPage: boolean;
}

export interface AnilistPageResponse {
  data: {
    Page: {
      pageInfo: AnilistPageInfo;
      media: AnilistMedia[];
    };
  };
}

export const ANILIST_GENRES = [
  'Action',
  'Adventure',
  'Comedy',
  'Drama',
  'Ecchi',
  'Fantasy',
  'Horror',
  'Mahou Shoujo',
  'Mecha',
  'Music',
  'Mystery',
  'Psychological',
  'Romance',
  'Sci-Fi',
  'Slice of Life',
  'Sports',
  'Supernatural',
  'Thriller',
] as const;

export const ANILIST_FORMATS = [
  { value: 'TV', label: 'TV' },
  { value: 'TV_SHORT', label: 'TV Short' },
  { value: 'MOVIE', label: 'Movie' },
  { value: 'SPECIAL', label: 'Special' },
  { value: 'OVA', label: 'OVA' },
  { value: 'ONA', label: 'ONA' },
  { value: 'MUSIC', label: 'Music' },
] as const;

export const ANILIST_STATUSES = [
  { value: 'FINISHED', label: 'Finished' },
  { value: 'RELEASING', label: 'Releasing' },
  { value: 'NOT_YET_RELEASED', label: 'Not Yet Released' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'HIATUS', label: 'Hiatus' },
] as const;

export const ANILIST_SEASONS = [
  { value: 'WINTER', label: 'Winter' },
  { value: 'SPRING', label: 'Spring' },
  { value: 'SUMMER', label: 'Summer' },
  { value: 'FALL', label: 'Fall' },
] as const;

export const ANILIST_SORT_OPTIONS = [
  { value: 'TRENDING_DESC', label: 'Trending' },
  { value: 'POPULARITY_DESC', label: 'Popular' },
  { value: 'SCORE_DESC', label: 'Top Rated' },
  { value: 'FAVOURITES_DESC', label: 'Most Favorited' },
  { value: 'START_DATE_DESC', label: 'Newest' },
  { value: 'START_DATE', label: 'Oldest' },
  { value: 'TITLE_ENGLISH', label: 'Title (A-Z)' },
  { value: 'TITLE_ENGLISH_DESC', label: 'Title (Z-A)' },
  { value: 'EPISODES_DESC', label: 'Most Episodes' },
  { value: 'UPDATED_AT_DESC', label: 'Recently Updated' },
] as const;

export const ANILIST_SOURCE_MATERIALS = [
  { value: 'ORIGINAL', label: 'Original' },
  { value: 'MANGA', label: 'Manga' },
  { value: 'LIGHT_NOVEL', label: 'Light Novel' },
  { value: 'VISUAL_NOVEL', label: 'Visual Novel' },
  { value: 'VIDEO_GAME', label: 'Video Game' },
  { value: 'NOVEL', label: 'Novel' },
  { value: 'WEB_NOVEL', label: 'Web Novel' },
  { value: 'DOUJINSHI', label: 'Doujinshi' },
  { value: 'ANIME', label: 'Anime' },
  { value: 'OTHER', label: 'Other' },
] as const;

export const ANILIST_COUNTRIES = [
  { value: 'JP', label: 'Japan' },
  { value: 'KR', label: 'South Korea' },
  { value: 'CN', label: 'China' },
  { value: 'TW', label: 'Taiwan' },
] as const;

export const ANILIST_TAGS = [
  'Isekai',
  'Reincarnation',
  'Time Skip',
  'Revenge',
  'Overpowered Main Character(s)',
  'Male Protagonist',
  'Female Protagonist',
  'Ensemble Cast',
  'Anti-Hero',
  'Villainess',
  'Amnesia',
  'Survival',
  'Gore',
  'Nudity',
  'Primarily Adult Cast',
  'Primarily Female Cast',
  'Primarily Male Cast',
  'Urban Fantasy',
  'Gods',
  'Demons',
  'Dungeon',
  'Harem',
  'Reverse Harem',
  'Love Triangle',
  'Tsundere',
  'Kuudere',
  'Yandere',
  'Tomboy',
  'Gender Bending',
  'Otaku Culture',
  'School Club',
  'Training',
  'Martial Arts',
  'Swordplay',
  'Battle Royale',
  'War',
  'Post-Apocalyptic',
  'Time Manipulation',
  'Aliens',
  'Cyberpunk',
  'Steampunk',
  'Virtual World',
  'Video Games',
  'Card Game',
  'Gambling',
  'Band',
  'Idol',
  'Cute Girls Doing Cute Things',
  'Animals',
  'Mythology',
  'Fairy Tale',
  'Drawing',
  'Cooking',
  'Agriculture',
  'Espionage',
  'Terrorism',
  'Pirates',
  'Samurai',
  'Ninja',
  'Vampire',
  'Zombie',
  'Ghost',
  'Witch',
  'Dragon',
  'Robot',
  'Mecha',
  'Space',
  'Dystopia',
  'Conspiracy',
  'Crime',
  'Detective',
  'Police',
  'Prison',
  'Delinquents',
  'Mafia',
  'Bullying',
  'Friendship',
  'Coming of Age',
  'Family Life',
  'Pets',
  'Skateboarding',
  'Swimming',
  'Tennis',
  'Basketball',
  'Football',
  'Baseball',
  'Boxing',
  'Archery',
] as const;
