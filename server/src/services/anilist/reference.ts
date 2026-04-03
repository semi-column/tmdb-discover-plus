import {
  ANILIST_GENRES,
  ANILIST_FORMATS,
  ANILIST_STATUSES,
  ANILIST_SEASONS,
  ANILIST_SORT_OPTIONS,
  ANILIST_SOURCE_MATERIALS,
  ANILIST_COUNTRIES,
} from './types.ts';

export function getGenres(): readonly string[] {
  return ANILIST_GENRES;
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
