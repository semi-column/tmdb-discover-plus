import {
  SIMKL_LIST_TYPES,
  SIMKL_TRENDING_PERIODS,
  SIMKL_BEST_FILTERS,
  SIMKL_ANIME_TYPES,
  SIMKL_SORT_OPTIONS,
  SIMKL_GENRES,
} from './types.ts';

export function getGenres(): readonly string[] {
  return SIMKL_GENRES;
}

export function getSortOptions(): readonly { value: string; label: string }[] {
  return SIMKL_SORT_OPTIONS;
}

export function getListTypes(): readonly { value: string; label: string }[] {
  return SIMKL_LIST_TYPES;
}

export function getTrendingPeriods(): readonly { value: string; label: string }[] {
  return SIMKL_TRENDING_PERIODS;
}

export function getBestFilters(): readonly { value: string; label: string }[] {
  return SIMKL_BEST_FILTERS;
}

export function getAnimeTypes(): readonly { value: string; label: string }[] {
  return SIMKL_ANIME_TYPES;
}
