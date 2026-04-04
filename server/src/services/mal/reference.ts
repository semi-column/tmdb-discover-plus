import {
  MAL_RANKING_TYPES,
  MAL_SORT_OPTIONS,
  MAL_ORDER_BY_OPTIONS,
  MAL_MEDIA_TYPES,
  MAL_STATUSES,
  MAL_RATINGS,
  MAL_GENRES,
  MAL_SEASONS,
} from './types.ts';

export function getGenres(): Array<{ id: number; name: string }> {
  return MAL_GENRES;
}

export function getRankingTypes(): readonly { value: string; label: string }[] {
  return MAL_RANKING_TYPES;
}

export function getSortOptions(): readonly { value: string; label: string }[] {
  return MAL_SORT_OPTIONS;
}

export function getOrderByOptions(): readonly { value: string; label: string }[] {
  return MAL_ORDER_BY_OPTIONS;
}

export function getMediaTypes(): readonly { value: string; label: string }[] {
  return MAL_MEDIA_TYPES;
}

export function getStatuses(): readonly { value: string; label: string }[] {
  return MAL_STATUSES;
}

export function getRatings(): readonly { value: string; label: string }[] {
  return MAL_RATINGS;
}

export function getSeasons(): readonly string[] {
  return MAL_SEASONS;
}
