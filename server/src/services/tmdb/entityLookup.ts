import { tmdbFetch, tmdbWebsiteFetchJson, matchesLoose } from './client.ts';
import { TMDB_IMAGE_BASE } from './constants.ts';
import type {
  PersonSearchResult,
  CompanySearchResult,
  KeywordSearchResult,
  NetworkSearchResult,
} from '../../types/index.ts';

interface TmdbEntityResponse {
  id: number;
  name: string;
  profile_path?: string | null;
  logo_path?: string | null;
}

interface TmdbNetworkSearchResponse {
  results?: Array<{ id: number; name: string; logo_path?: string | null }>;
}

export async function getPersonById(
  apiKey: string,
  id: number | string
): Promise<PersonSearchResult | null> {
  if (!apiKey || !id) return null;
  try {
    const data = (await tmdbFetch(`/person/${id}`, apiKey)) as TmdbEntityResponse;
    return {
      id: data.id,
      name: data.name,
      profilePath: data.profile_path ? `${TMDB_IMAGE_BASE}/w185${data.profile_path}` : null,
    };
  } catch {
    return null;
  }
}

export async function getCompanyById(
  apiKey: string,
  id: number | string
): Promise<CompanySearchResult | null> {
  if (!apiKey || !id) return null;
  try {
    const data = (await tmdbFetch(`/company/${id}`, apiKey)) as TmdbEntityResponse;
    return {
      id: data.id,
      name: data.name,
      logoPath: data.logo_path ? `${TMDB_IMAGE_BASE}/w185${data.logo_path}` : null,
    };
  } catch {
    return null;
  }
}

export async function getKeywordById(
  apiKey: string,
  id: number | string
): Promise<KeywordSearchResult | null> {
  if (!apiKey || !id) return null;
  try {
    const data = (await tmdbFetch(`/keyword/${id}`, apiKey)) as TmdbEntityResponse;
    return {
      id: data.id,
      name: data.name,
    };
  } catch {
    return null;
  }
}

export async function getNetworkById(
  apiKey: string,
  id: number | string
): Promise<NetworkSearchResult | null> {
  if (!apiKey || !id) return null;
  try {
    const data = (await tmdbFetch(`/network/${id}`, apiKey)) as TmdbEntityResponse;
    return {
      id: data.id,
      name: data.name,
      logoPath: data.logo_path ? `${TMDB_IMAGE_BASE}/w185${data.logo_path}` : null,
    };
  } catch {
    return null;
  }
}

async function getNetworksViaWebsite(query: string): Promise<NetworkSearchResult[]> {
  const q = String(query || '').trim();
  if (!q) return [];

  const data = (await tmdbWebsiteFetchJson('/search/remote/tv_network', {
    language: 'en',
    query: q,
    value: q,
    include_adult: 'false',
  })) as TmdbNetworkSearchResponse | null;

  const results = Array.isArray(data?.results) ? data.results : [];
  const filtered = results
    .filter((r) => r?.id && r?.name && matchesLoose(r.name, q))
    .slice(0, 20)
    .map((r) => ({
      id: r.id,
      name: r.name,
      logoPath: r.logo_path ? `${TMDB_IMAGE_BASE}/w185${r.logo_path}` : null,
    }));
  const byId = new Map<string, NetworkSearchResult>();
  for (const n of filtered) {
    const key = String(n.id);
    if (!byId.has(key)) byId.set(key, n);
  }
  return Array.from(byId.values());
}

export async function getNetworks(query: string): Promise<NetworkSearchResult[]> {
  const q = String(query || '').trim();
  if (!q) return [];
  return getNetworksViaWebsite(q);
}
