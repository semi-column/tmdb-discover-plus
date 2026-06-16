import { createLogger } from '../../utils/logger.ts';
import { anilistFetch } from './client.ts';
import { BROWSE_QUERY, MEDIA_FIELDS, SEARCH_QUERY, STUDIO_SEARCH_QUERY } from './queries.ts';
import type { AnilistPageResponse, AnilistMedia } from './types.ts';
import type { AnilistCatalogFilters } from '../../types/config.ts';
import type { ContentType } from '../../types/common.ts';

const log = createLogger('anilist:discover');

interface BatchPageData {
  pageInfo: {
    total: number;
    perPage: number;
    currentPage: number;
    lastPage: number;
    hasNextPage: boolean;
  };
  media: AnilistMedia[];
}

interface BrowseBatchResponse {
  data: Record<string, BatchPageData>;
}

function contentTypeToFormats(type: ContentType): string[] {
  if (type === 'movie') return ['MOVIE'];
  if (type === 'anime') return ['TV', 'TV_SHORT', 'ONA', 'OVA', 'SPECIAL', 'MOVIE'];
  return ['TV', 'TV_SHORT', 'ONA'];
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

  // Adult content: when isAdult is true, omit the param so AniList returns all content;
  // when false or unset, explicitly exclude adult-only entries.
  if (filters.isAdult !== true) vars.isAdult = false;

  return vars;
}

function buildBrowseBatchQuery(pageCount: number): string {
  const clampedCount = Math.max(1, Math.min(pageCount, 5));
  const pageVarDefs = Array.from({ length: clampedCount }, (_, i) => `$page${i + 1}: Int!`).join(
    ', '
  );
  const sharedVarDefs = [
    '$perPage: Int',
    '$sort: [MediaSort]',
    '$type: MediaType',
    '$format_in: [MediaFormat]',
    '$status_in: [MediaStatus]',
    '$season: MediaSeason',
    '$seasonYear: Int',
    '$genre_in: [String]',
    '$genre_not_in: [String]',
    '$tag_in: [String]',
    '$tag_not_in: [String]',
    '$averageScore_greater: Int',
    '$averageScore_lesser: Int',
    '$popularity_greater: Int',
    '$episodes_greater: Int',
    '$episodes_lesser: Int',
    '$duration_greater: Int',
    '$duration_lesser: Int',
    '$countryOfOrigin: CountryCode',
    '$source_in: [MediaSource]',
    '$isAdult: Boolean',
    '$search: String',
  ].join(', ');

  const mediaArgs =
    'sort: $sort, type: $type, format_in: $format_in, status_in: $status_in, season: $season, seasonYear: $seasonYear, genre_in: $genre_in, genre_not_in: $genre_not_in, tag_in: $tag_in, tag_not_in: $tag_not_in, averageScore_greater: $averageScore_greater, averageScore_lesser: $averageScore_lesser, popularity_greater: $popularity_greater, episodes_greater: $episodes_greater, episodes_lesser: $episodes_lesser, duration_greater: $duration_greater, duration_lesser: $duration_lesser, countryOfOrigin: $countryOfOrigin, source_in: $source_in, isAdult: $isAdult, search: $search';

  const pageBlocks = Array.from({ length: clampedCount }, (_, i) => {
    const idx = i + 1;
    return `
      p${idx}: Page(page: $page${idx}, perPage: $perPage) {
        pageInfo { total perPage currentPage lastPage hasNextPage }
        media(${mediaArgs}) {
          ${MEDIA_FIELDS}
        }
      }
    `;
  }).join('\n');

  return `
    query (${pageVarDefs}, ${sharedVarDefs}) {
      ${pageBlocks}
    }
  `;
}

export async function browse(
  filters: AnilistCatalogFilters,
  type: ContentType,
  page: number
): Promise<{ media: AnilistMedia[]; hasNextPage: boolean }> {
  const studioIds = filters.studios && filters.studios.length > 0 ? new Set(filters.studios) : null;
  const variables = buildVariables(filters, type, page);
  log.debug('AniList browse', { type, page, sort: variables.sort });

  const response = await anilistFetch<AnilistPageResponse>(BROWSE_QUERY, variables);
  const pageData = response.data.Page;
  let media = pageData.media;

  if (studioIds) {
    media = media.filter((m) => m.studios?.nodes?.some((s) => studioIds.has(s.id)));
  }

  return {
    media,
    hasNextPage: pageData.pageInfo.hasNextPage,
  };
}

export async function browseBatch(
  filters: AnilistCatalogFilters,
  type: ContentType,
  pages: number[]
): Promise<Array<{ page: number; media: AnilistMedia[]; hasNextPage: boolean; total: number }>> {
  const selectedPages = pages.slice(0, 5).filter((p) => Number.isFinite(p) && p > 0);
  if (selectedPages.length === 0) return [];

  const studioIds = filters.studios && filters.studios.length > 0 ? new Set(filters.studios) : null;

  const variables = buildVariables(filters, type, selectedPages[0]);
  const batchQuery = buildBrowseBatchQuery(selectedPages.length);
  const batchVariables: Record<string, unknown> = { ...variables };
  delete batchVariables.page;

  selectedPages.forEach((pageNumber, index) => {
    batchVariables[`page${index + 1}`] = pageNumber;
  });

  log.debug('AniList browse batch', { type, pages: selectedPages, sort: variables.sort });

  const response = await anilistFetch<BrowseBatchResponse>(batchQuery, batchVariables);

  return selectedPages.map((requestedPage, index) => {
    const key = `p${index + 1}`;
    const pageData = response.data[key];
    const fallbackPage: BatchPageData = {
      pageInfo: {
        total: 0,
        perPage: 0,
        currentPage: requestedPage,
        lastPage: requestedPage,
        hasNextPage: false,
      },
      media: [],
    };
    const resolved = pageData || fallbackPage;

    let media = resolved.media || [];
    if (studioIds) {
      media = media.filter((m) => m.studios?.nodes?.some((s) => studioIds.has(s.id)));
    }

    return {
      page: requestedPage,
      media,
      hasNextPage: resolved.pageInfo.hasNextPage,
      total: resolved.pageInfo.total,
    };
  });
}

export async function search(
  query: string,
  type: ContentType,
  page: number
): Promise<{ media: AnilistMedia[]; hasNextPage: boolean }> {
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
  };
}

interface StudioSearchResponse {
  data: {
    Page: {
      pageInfo: { total: number; hasNextPage: boolean };
      studios: Array<{ id: number; name: string; isAnimationStudio: boolean; siteUrl: string }>;
    };
  };
}

export async function searchStudios(
  query: string
): Promise<Array<{ id: number; name: string; isAnimationStudio: boolean }>> {
  log.debug('AniList studio search', { query });
  const response = await anilistFetch<StudioSearchResponse>(STUDIO_SEARCH_QUERY, {
    search: query,
    page: 1,
    perPage: 20,
  });
  return response.data.Page.studios;
}
