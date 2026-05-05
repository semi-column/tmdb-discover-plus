export interface KitsuAnimeAttributes {
  canonicalTitle: string;
  titles: { en?: string; en_us?: string; en_jp?: string; ja_jp?: string };
  abbreviatedTitles?: string[];
  synopsis: string | null;
  subtype: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  episodeCount: number | null;
  episodeLength: number | null;
  ageRating: string | null;
  ageRatingGuide: string | null;
  averageRating: string | null;
  userCount: number | null;
  favoritesCount: number | null;
  popularityRank: number | null;
  ratingRank: number | null;
  posterImage: {
    tiny?: string;
    small?: string;
    medium?: string;
    large?: string;
    original?: string;
  } | null;
  coverImage: { tiny?: string; small?: string; large?: string; original?: string } | null;
  nsfw: boolean;
}

export interface KitsuAnimeResource {
  id: string;
  type: 'anime';
  attributes: KitsuAnimeAttributes;
  relationships?: {
    categories?: { links?: { related?: string } };
    genres?: { links?: { related?: string } };
  };
}

export interface KitsuCategoryResource {
  id: string;
  type: 'categories';
  attributes: { title: string; slug: string };
}

export interface KitsuListResponse {
  data: KitsuAnimeResource[];
  included?: Array<
    KitsuCategoryResource | { id: string; type: string; attributes: Record<string, unknown> }
  >;
  meta?: { count?: number };
  links?: { first?: string; next?: string; last?: string };
}

export interface KitsuAnime {
  id: number;
  title: string;
  titles: { en?: string; en_jp?: string; ja_jp?: string };
  synopsis: string | null;
  subtype: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  episodeCount: number | null;
  averageRating: number | null;
  popularityRank: number | null;
  ratingRank: number | null;
  poster: string | null;
  cover: string | null;
  ageRating: string | null;
  nsfw: boolean;
  categories: string[];
}

export function kitsuResourceToAnime(
  resource: KitsuAnimeResource,
  categoryNames?: string[]
): KitsuAnime {
  const attr = resource.attributes;
  return {
    id: Number(resource.id),
    title: attr.canonicalTitle || attr.titles?.en_jp || attr.titles?.en || 'Unknown',
    titles: {
      en: attr.titles?.en || attr.titles?.en_us,
      en_jp: attr.titles?.en_jp,
      ja_jp: attr.titles?.ja_jp,
    },
    synopsis: attr.synopsis || null,
    subtype: attr.subtype || 'TV',
    status: attr.status || 'finished',
    startDate: attr.startDate || null,
    endDate: attr.endDate || null,
    episodeCount: attr.episodeCount || null,
    averageRating: attr.averageRating ? parseFloat(attr.averageRating) : null,
    popularityRank: attr.popularityRank || null,
    ratingRank: attr.ratingRank || null,
    poster:
      attr.posterImage?.large || attr.posterImage?.medium || attr.posterImage?.original || null,
    cover: attr.coverImage?.large || attr.coverImage?.original || null,
    ageRating: attr.ageRating || null,
    nsfw: attr.nsfw || false,
    categories: categoryNames || [],
  };
}

export const KITSU_SUBTYPES = [
  { value: 'TV', label: 'TV' },
  { value: 'movie', label: 'Movie' },
  { value: 'OVA', label: 'OVA' },
  { value: 'ONA', label: 'ONA' },
  { value: 'special', label: 'Special' },
  { value: 'music', label: 'Music' },
] as const;

export const KITSU_STATUSES = [
  { value: 'current', label: 'Currently Airing' },
  { value: 'finished', label: 'Finished' },
  { value: 'tba', label: 'TBA' },
  { value: 'unreleased', label: 'Unreleased' },
  { value: 'upcoming', label: 'Upcoming' },
] as const;

export const KITSU_AGE_RATINGS = [
  { value: 'G', label: 'G - All Ages' },
  { value: 'PG', label: 'PG - Children' },
  { value: 'R', label: 'R - 17+' },
] as const;

export const KITSU_SORT_OPTIONS = [
  { value: '-averageRating', label: 'Highest Rated' },
  { value: '-userCount', label: 'Most Popular' },
  { value: '-favoritesCount', label: 'Most Favorited' },
  { value: '-startDate', label: 'Newest' },
  { value: 'startDate', label: 'Oldest' },
  { value: '-episodeCount', label: 'Most Episodes' },
] as const;

export const KITSU_SEASONS = ['winter', 'spring', 'summer', 'fall'] as const;

export const KITSU_CATEGORIES: Array<{ id: number; slug: string; title: string }> = [
  { id: 1, slug: 'action', title: 'Action' },
  { id: 2, slug: 'adventure', title: 'Adventure' },
  { id: 3, slug: 'comedy', title: 'Comedy' },
  { id: 4, slug: 'drama', title: 'Drama' },
  { id: 5, slug: 'sci-fi', title: 'Sci-Fi' },
  { id: 6, slug: 'space', title: 'Space' },
  { id: 7, slug: 'mystery', title: 'Mystery' },
  { id: 8, slug: 'magic', title: 'Magic' },
  { id: 9, slug: 'supernatural', title: 'Supernatural' },
  { id: 10, slug: 'police', title: 'Police' },
  { id: 11, slug: 'fantasy', title: 'Fantasy' },
  { id: 12, slug: 'sports', title: 'Sports' },
  { id: 13, slug: 'romance', title: 'Romance' },
  { id: 14, slug: 'cars', title: 'Cars' },
  { id: 15, slug: 'slice-of-life', title: 'Slice of Life' },
  { id: 16, slug: 'racing', title: 'Racing' },
  { id: 17, slug: 'horror', title: 'Horror' },
  { id: 18, slug: 'psychological', title: 'Psychological' },
  { id: 19, slug: 'thriller', title: 'Thriller' },
  { id: 20, slug: 'martial-arts', title: 'Martial Arts' },
  { id: 21, slug: 'super-power', title: 'Super Power' },
  { id: 22, slug: 'school', title: 'School' },
  { id: 23, slug: 'ecchi', title: 'Ecchi' },
  { id: 24, slug: 'vampire', title: 'Vampire' },
  { id: 25, slug: 'historical', title: 'Historical' },
  { id: 26, slug: 'military', title: 'Military' },
  { id: 27, slug: 'dementia', title: 'Dementia' },
  { id: 28, slug: 'mecha', title: 'Mecha' },
  { id: 29, slug: 'demons', title: 'Demons' },
  { id: 30, slug: 'samurai', title: 'Samurai' },
  { id: 31, slug: 'harem', title: 'Harem' },
  { id: 32, slug: 'music', title: 'Music' },
  { id: 33, slug: 'game', title: 'Game' },
  { id: 34, slug: 'shounen', title: 'Shounen' },
  { id: 35, slug: 'shoujo', title: 'Shoujo' },
  { id: 36, slug: 'seinen', title: 'Seinen' },
  { id: 37, slug: 'josei', title: 'Josei' },
  { id: 38, slug: 'isekai', title: 'Isekai' },
  { id: 39, slug: 'kids', title: 'Kids' },
  { id: 40, slug: 'parody', title: 'Parody' },
];
