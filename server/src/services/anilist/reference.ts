import {
  ANILIST_GENRES,
  ANILIST_FORMATS,
  ANILIST_STATUSES,
  ANILIST_SEASONS,
  ANILIST_SORT_OPTIONS,
  ANILIST_SOURCE_MATERIALS,
  ANILIST_COUNTRIES,
  ANILIST_TAGS,
} from './types.ts';
import { anilistFetch } from './client.ts';
import { createLogger } from '../../utils/logger.ts';

const log = createLogger('anilist:reference');

interface AnilistTag {
  name: string;
  category: string;
  isAdult: boolean;
}

interface TagCollectionResponse {
  data: { MediaTagCollection: AnilistTag[] };
}

const TAG_COLLECTION_QUERY = `{ MediaTagCollection { name category isAdult } }`;

let cachedTags: { value: string; label: string; category: string }[] | null = null;
let cacheTime = 0;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function fetchTagCollection(): Promise<{ value: string; label: string; category: string }[]> {
  const now = Date.now();
  if (cachedTags && now - cacheTime < CACHE_TTL_MS) return cachedTags;

  try {
    const resp = await anilistFetch<TagCollectionResponse>(TAG_COLLECTION_QUERY);
    const tags = resp.data.MediaTagCollection.filter((t) => !t.isAdult)
      .map((t) => ({ value: t.name, label: t.name, category: t.category }))
      .sort((a, b) => a.label.localeCompare(b.label));
    cachedTags = tags;
    cacheTime = now;
    log.info(`Fetched ${tags.length} AniList tags from API`);
    return tags;
  } catch (err) {
    log.warn('Failed to fetch AniList tags, using fallback', { error: (err as Error).message });
    return ANILIST_TAGS.map((t) => ({ value: t, label: t, category: '' }));
  }
}

export function getGenres(): readonly string[] {
  return ANILIST_GENRES;
}

export function getTags(): readonly string[] {
  return ANILIST_TAGS;
}

export async function getTagsFromApi(): Promise<
  { value: string; label: string; category: string }[]
> {
  return fetchTagCollection();
}

export function getSortOptions(): readonly { value: string; label: string }[] {
  return ANILIST_SORT_OPTIONS;
}

export function getFormatOptions(): readonly { value: string; label: string }[] {
  return ANILIST_FORMATS;
}

export function getStatusOptions(): readonly { value: string; label: string }[] {
  return ANILIST_STATUSES;
}

export function getSeasonOptions(): readonly { value: string; label: string }[] {
  return ANILIST_SEASONS;
}

export function getSourceOptions(): readonly { value: string; label: string }[] {
  return ANILIST_SOURCE_MATERIALS;
}

export function getCountryOptions(): readonly { value: string; label: string }[] {
  return ANILIST_COUNTRIES;
}
