import { tmdbFetch } from './client.js';
import { TMDB_IMAGE_BASE } from './constants.js';

/**
 * Search for movies or TV shows
 */
export async function search(apiKey, query, type = 'movie', page = 1) {
  const mediaType = type === 'series' ? 'tv' : 'movie';
  const params = { query, page };
  const maybeOptions = arguments.length >= 5 ? arguments[4] : undefined;
  const displayLanguage = maybeOptions?.displayLanguage;
  const language = maybeOptions?.language;
  const languageParam = displayLanguage || language;
  if (languageParam) params.language = languageParam;
  return tmdbFetch(`/search/${mediaType}`, apiKey, params);
}

/**
 * Search for a person (actor, director, etc.)
 */
export async function searchPerson(apiKey, query) {
  const data = await tmdbFetch('/search/person', apiKey, { query });
  return (
    data.results?.slice(0, 10).map((person) => ({
      id: person.id,
      name: person.name,
      profilePath: person.profile_path ? `${TMDB_IMAGE_BASE}/w185${person.profile_path}` : null,
      knownFor: person.known_for_department,
    })) || []
  );
}

/**
 * Search for a company
 */
export async function searchCompany(apiKey, query) {
  const data = await tmdbFetch('/search/company', apiKey, { query });
  return (
    data.results?.slice(0, 10).map((company) => ({
      id: company.id,
      name: company.name,
      logoPath: company.logo_path ? `${TMDB_IMAGE_BASE}/w185${company.logo_path}` : null,
    })) || []
  );
}

/**
 * Search for keywords
 */
export async function searchKeyword(apiKey, query) {
  const data = await tmdbFetch('/search/keyword', apiKey, { query });
  return (
    data.results?.slice(0, 10).map((keyword) => ({
      id: keyword.id,
      name: keyword.name,
    })) || []
  );
}
