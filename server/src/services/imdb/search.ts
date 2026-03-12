import { imdbFetch } from './client.ts';
import { config } from '../../config.ts';

import type { ImdbSearchResult, ImdbSuggestionsResult, ImdbBasicSearchResult } from './types.ts';

export async function search(
  query: string,
  types?: string[],
  limit: number = 100
): Promise<ImdbSearchResult> {
  const ttl = Math.floor(config.imdbApi.cacheTtlSearch / 2);
  const params: Record<string, string | number | string[] | undefined> = {
    query,
    limit,
  };
  if (types?.length) params.types = types;
  params.sortBy = 'POPULARITY';
  params.sortOrder = 'DESC';
  const data = (await imdbFetch('/api/imdb/search/advanced', params, ttl)) as ImdbSearchResult;
  return data;
}

export async function getSuggestions(query: string): Promise<ImdbSuggestionsResult> {
  const ttl = 3600;
  const data = (await imdbFetch(
    '/api/imdb/search/suggestions',
    { query },
    ttl
  )) as ImdbSuggestionsResult;
  return data;
}

export async function basicSearch(
  query: string,
  type?: 'NAME' | 'COMPANY' | 'TV' | 'MOVIE' | 'INTEREST',
  limit: number = 10
): Promise<ImdbBasicSearchResult> {
  const ttl = 3600;
  const params: Record<string, string | number | undefined> = { query, limit };
  if (type) params.type = type;
  const data = (await imdbFetch('/api/imdb/search', params, ttl)) as ImdbBasicSearchResult;
  return data;
}
