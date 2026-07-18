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
import { LOCAL_CACHE_TTLS } from '../../cacheTtls.ts';

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
let cachedTagsAdult: { value: string; label: string; category: string }[] | null = null;
let cacheTime = 0;
let cacheTimeAdult = 0;
const CACHE_TTL_MS = LOCAL_CACHE_TTLS.ANILIST_TAGS;

async function fetchTagCollection(
  includeAdult?: boolean
): Promise<{ value: string; label: string; category: string }[]> {
  const now = Date.now();
  if (includeAdult) {
    if (cachedTagsAdult && now - cacheTimeAdult < CACHE_TTL_MS) return cachedTagsAdult;
  } else {
    if (cachedTags && now - cacheTime < CACHE_TTL_MS) return cachedTags;
  }

  try {
    const resp = await anilistFetch<TagCollectionResponse>(TAG_COLLECTION_QUERY);
    const allTags = resp.data.MediaTagCollection.map((t) => ({
      value: t.name,
      label: t.name,
      category: t.category,
      isAdult: t.isAdult,
    }));

    const sfwTags = allTags
      .filter((t) => !t.isAdult)
      .map(({ value, label, category }) => ({ value, label, category }))
      .sort((a, b) => a.label.localeCompare(b.label));
    cachedTags = sfwTags;
    cacheTime = now;

    const allMapped = allTags
      .map(({ value, label, category }) => ({ value, label, category }))
      .sort((a, b) => a.label.localeCompare(b.label));
    cachedTagsAdult = allMapped;
    cacheTimeAdult = now;

    log.info(`Fetched ${allMapped.length} AniList tags from API (${sfwTags.length} SFW)`);
    return includeAdult ? allMapped : sfwTags;
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

export async function getTagsFromApi(
  includeAdult?: boolean
): Promise<{ value: string; label: string; category: string }[]> {
  return fetchTagCollection(includeAdult);
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
