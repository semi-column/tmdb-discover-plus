import { imdbFetch } from './client.ts';
import { config } from '../../config.ts';
import {
  IMDB_GENRES,
  IMDB_KEYWORDS,
  IMDB_AWARDS,
  IMDB_SORT_OPTIONS,
  IMDB_TITLE_TYPES,
  IMDB_PRESET_CATALOGS,
} from './types.ts';

export async function getGenres(): Promise<string[]> {
  if (!config.imdbApi.enabled) return [...IMDB_GENRES];
  const ttl = config.imdbApi.cacheTtlReference;
  try {
    const data = (await imdbFetch('/api/imdb/genres', {}, ttl)) as string[];
    return Array.isArray(data) ? data : [...IMDB_GENRES];
  } catch {
    return [...IMDB_GENRES];
  }
}

export async function getTitleTypes(): Promise<string[]> {
  if (!config.imdbApi.enabled) return IMDB_TITLE_TYPES.map((t) => t.value);
  const ttl = config.imdbApi.cacheTtlReference;
  try {
    const data = (await imdbFetch('/api/imdb/title-types', {}, ttl)) as string[];
    return Array.isArray(data) ? data : IMDB_TITLE_TYPES.map((t) => t.value);
  } catch {
    return IMDB_TITLE_TYPES.map((t) => t.value);
  }
}

export function getKeywords(): string[] {
  return [...IMDB_KEYWORDS];
}

export function getAwards(): { won: string[]; nominated: string[] } {
  return { won: [...IMDB_AWARDS], nominated: [...IMDB_AWARDS] };
}

export function getSortOptions(): Array<{ value: string; label: string }> {
  return [...IMDB_SORT_OPTIONS];
}

export function getTitleTypeOptions(): Array<{ value: string; label: string }> {
  return [...IMDB_TITLE_TYPES];
}

export function getPresetCatalogs(): typeof IMDB_PRESET_CATALOGS {
  return IMDB_PRESET_CATALOGS;
}
