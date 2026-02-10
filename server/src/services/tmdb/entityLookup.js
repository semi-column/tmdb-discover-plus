import { tmdbFetch, tmdbWebsiteFetchJson, matchesLoose } from './client.js';
import { TMDB_IMAGE_BASE } from './constants.js';

/**
 * Get a person by TMDB ID
 */
export async function getPersonById(apiKey, id) {
  if (!apiKey || !id) return null;
  try {
    const data = await tmdbFetch(`/person/${id}`, apiKey);
    return {
      id: data.id,
      name: data.name,
      profilePath: data.profile_path ? `${TMDB_IMAGE_BASE}/w185${data.profile_path}` : null,
    };
  } catch (err) {
    return null;
  }
}

/**
 * Get a company by TMDB ID
 */
export async function getCompanyById(apiKey, id) {
  if (!apiKey || !id) return null;
  try {
    const data = await tmdbFetch(`/company/${id}`, apiKey);
    return {
      id: data.id,
      name: data.name,
      logoPath: data.logo_path ? `${TMDB_IMAGE_BASE}/w185${data.logo_path}` : null,
    };
  } catch (err) {
    return null;
  }
}

/**
 * Get a keyword by TMDB ID
 */
export async function getKeywordById(apiKey, id) {
  if (!apiKey || !id) return null;
  try {
    const data = await tmdbFetch(`/keyword/${id}`, apiKey);
    return {
      id: data.id,
      name: data.name,
    };
  } catch (err) {
    return null;
  }
}

/**
 * Get a network by TMDB ID
 */
export async function getNetworkById(apiKey, id) {
  if (!apiKey || !id) return null;
  try {
    const data = await tmdbFetch(`/network/${id}`, apiKey);
    return {
      id: data.id,
      name: data.name,
      logoPath: data.logo_path ? `${TMDB_IMAGE_BASE}/w185${data.logo_path}` : null,
    };
  } catch (err) {
    return null;
  }
}

// ── Network search via TMDB website ─────────────────────────────────────────

async function getNetworksViaWebsite(query) {
  const q = String(query || '').trim();
  if (!q) return [];

  const data = await tmdbWebsiteFetchJson('/search/remote/tv_network', {
    language: 'en',
    query: q,
    value: q,
    include_adult: 'false',
  });

  const results = Array.isArray(data?.results) ? data.results : [];
  const filtered = results
    .filter((r) => r?.id && r?.name && matchesLoose(r.name, q))
    .slice(0, 20)
    .map((r) => ({
      id: r.id,
      name: r.name,
      logoPath: r.logo_path ? `${TMDB_IMAGE_BASE}/w185${r.logo_path}` : null,
    }));

  // De-dupe by id
  const byId = new Map();
  for (const n of filtered) {
    const key = String(n.id);
    if (!byId.has(key)) byId.set(key, n);
  }
  return Array.from(byId.values());
}

/**
 * Get TV networks list
 */
export async function getNetworks(apiKey, query) {
  const q = String(query || '').trim();
  if (!apiKey || !q) return [];
  return getNetworksViaWebsite(q);
}
