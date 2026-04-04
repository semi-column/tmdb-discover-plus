import { createLogger } from '../../utils/logger.ts';
import { anilistFetch } from './client.ts';
import { BROWSE_QUERY, SEARCH_QUERY } from './queries.ts';
import type { AnilistPageResponse, AnilistMedia } from './types.ts';
import type { AnilistCatalogFilters } from '../../types/config.ts';
import type { ContentType } from '../../types/common.ts';

const log = createLogger('anilist:discover');

function contentTypeToFormats(type: ContentType): string[] {
  return type === 'movie' ? ['MOVIE'] : ['TV', 'TV_SHORT', 'ONA'];
}

function buildVariables(
  filters: AnilistCatalogFilters,
  type: ContentType,
  page: number
): Record<string, unknown> {
  const vars: Record<string, unknown> = {
    page,
    perPage: 50,
    type: 'ANIME',
  };

  // Format: merge user-selected formats with content type defaults
  if (filters.format && filters.format.length > 0) {
    vars.format_in = filters.format;
  } else {
    vars.format_in = contentTypeToFormats(type);
  }

  // Sort
  if (filters.anilistSort || filters.sortBy) {
    vars.sort = [filters.anilistSort || filters.sortBy];
  } else {
    vars.sort = ['TRENDING_DESC'];
  }

  // Status
  if (filters.status && filters.status.length > 0) {
    vars.status_in = filters.status;
  }

  // Season
  if (filters.season) vars.season = filters.season;
  if (filters.seasonYear) vars.seasonYear = filters.seasonYear;

  // Genres
  if (filters.genres && filters.genres.length > 0) {
    vars.genre_in = filters.genres;
  }
  if (filters.excludeGenres && filters.excludeGenres.length > 0) {
    vars.genre_not_in = filters.excludeGenres;
  }

  // Tags
  if (filters.tags && filters.tags.length > 0) {
    vars.tag_in = filters.tags;
  }
  if (filters.excludeTags && filters.excludeTags.length > 0) {
    vars.tag_not_in = filters.excludeTags;
  }

  // Score
  if (filters.averageScoreMin != null && filters.averageScoreMin > 0) {
    vars.averageScore_greater = filters.averageScoreMin;
  }
  if (filters.averageScoreMax != null && filters.averageScoreMax < 100) {
    vars.averageScore_lesser = filters.averageScoreMax;
  }

  // Popularity
  if (filters.popularityMin != null && filters.popularityMin > 0) {
    vars.popularity_greater = filters.popularityMin;
  }

  // Episodes
  if (filters.episodesMin != null) vars.episodes_greater = filters.episodesMin;
  if (filters.episodesMax != null) vars.episodes_lesser = filters.episodesMax;

  // Duration
  if (filters.durationMin != null) vars.duration_greater = filters.durationMin;
  if (filters.durationMax != null) vars.duration_lesser = filters.durationMax;

  // Country
  if (filters.countryOfOrigin) vars.countryOfOrigin = filters.countryOfOrigin;

  // Source material
  if (filters.sourceMaterial && filters.sourceMaterial.length > 0) {
    vars.source_in = filters.sourceMaterial;
  }

  // Adult content
  if (filters.isAdult != null) vars.isAdult = filters.isAdult;

  return vars;
}

export async function browse(
  filters: AnilistCatalogFilters,
  type: ContentType,
  page: number
): Promise<{ media: AnilistMedia[]; hasNextPage: boolean; total: number }> {
  const variables = buildVariables(filters, type, page);
  log.debug('AniList browse', { type, page, sort: variables.sort });

  const response = await anilistFetch<AnilistPageResponse>(BROWSE_QUERY, variables);
  const pageData = response.data.Page;
  return {
    media: pageData.media,
    hasNextPage: pageData.pageInfo.hasNextPage,
    total: pageData.pageInfo.total,
  };
}

export async function search(
  query: string,
  type: ContentType,
  page: number
): Promise<{ media: AnilistMedia[]; hasNextPage: boolean; total: number }> {
  const variables: Record<string, unknown> = {
    search: query,
    page,
    perPage: 50,
    type: 'ANIME',
    format_in: contentTypeToFormats(type),
  };

  log.debug('AniList search', { query, type, page });

  const response = await anilistFetch<AnilistPageResponse>(SEARCH_QUERY, variables);
  const pageData = response.data.Page;
  return {
    media: pageData.media,
    hasNextPage: pageData.pageInfo.hasNextPage,
    total: pageData.pageInfo.total,
  };
}
