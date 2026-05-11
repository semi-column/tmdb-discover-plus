import { imdbFetch } from './client.ts';
import { config } from '../../config.ts';

import type { ImdbPoster, ImdbTitle } from './types.ts';

interface ImdbEpisodesBySeasonParams {
  season: number;
  limit?: number;
  endCursor?: string;
}

interface ImdbEpisodeEdge {
  node?: {
    id?: string;
    titleText?: { text?: string };
    plot?: { plotText?: { plainText?: string } };
    releaseDate?: { year?: number; month?: number | null; day?: number | null };
    runtime?: { seconds?: number };
    primaryImage?: { url?: string };
  };
  position?: number;
}

export interface ImdbEpisodesBySeasonResponse {
  title?: {
    episodes?: {
      episodes?: {
        edges?: ImdbEpisodeEdge[];
        pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
        total?: number;
      };
    };
  };
}

function sanitizeImdbTitleId(imdbId: string): string {
  const sanitizedId = imdbId.replace(/[^a-zA-Z0-9]/g, '');
  if (!/^tt\d+$/.test(sanitizedId)) {
    throw new Error('Invalid IMDb title ID format');
  }
  return sanitizedId;
}

export async function getTitle(imdbId: string): Promise<ImdbTitle> {
  const sanitizedId = sanitizeImdbTitleId(imdbId);
  const ttl = config.imdbApi.cacheTtlDetail;
  const data = (await imdbFetch(`/api/imdb/${sanitizedId}`, {}, ttl)) as ImdbTitle;
  return data;
}

export async function getPoster(imdbId: string): Promise<ImdbPoster> {
  const sanitizedId = sanitizeImdbTitleId(imdbId);
  const ttl = config.imdbApi.cacheTtlDetail;
  const data = (await imdbFetch(`/api/imdb/${sanitizedId}/poster`, {}, ttl)) as ImdbPoster;
  return data;
}

export async function getEpisodesBySeason(
  imdbId: string,
  params: ImdbEpisodesBySeasonParams
): Promise<ImdbEpisodesBySeasonResponse> {
  const sanitizedId = sanitizeImdbTitleId(imdbId);

  const ttl = config.imdbApi.cacheTtlDetail;
  const data = (await imdbFetch(
    `/api/imdb/${sanitizedId}/episodes`,
    {
      season: params.season,
      limit: params.limit,
      endCursor: params.endCursor,
    },
    ttl
  )) as ImdbEpisodesBySeasonResponse;

  return data;
}
