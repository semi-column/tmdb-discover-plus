import { tmdbFetch } from './client.js';
import { TMDB_IMAGE_BASE } from './constants.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('tmdb:search');

/**
 * Search for movies or TV shows
 */
export async function search(apiKey, query, type = 'movie', page = 1) {
  const mediaType = type === 'series' ? 'tv' : 'movie';
  const params = { query, page };
  const maybeOptions = arguments.length >= 5 ? arguments[4] : undefined;
  const displayLanguage = maybeOptions?.displayLanguage;
  const language = maybeOptions?.language;
  const includeAdult = maybeOptions?.includeAdult;
  const languageParam = displayLanguage || language;
  if (languageParam) params.language = languageParam;
  if (includeAdult !== undefined) params.include_adult = includeAdult;
  return tmdbFetch(`/search/${mediaType}`, apiKey, params);
}

/**
 * Search for a person (actor, director, etc.) — used by configure UI
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
 * Get a person's movie or TV credits (filmography)
 */
async function getPersonCredits(apiKey, personId, type = 'movie', language) {
  const mediaType = type === 'series' ? 'tv' : 'movie';
  const params = {};
  if (language) params.language = language;
  return tmdbFetch(`/person/${personId}/${mediaType}_credits`, apiKey, params);
}

/**
 * Check if a query looks like it could be a person name (not a movie title with symbols)
 */
function looksLikePersonQuery(query) {
  // Skip person search for queries with special characters typical of titles
  return !/[:()\[\]?!$#@&]/.test(query) && !/^\d+$/.test(query.trim());
}

/**
 * Validate that a person result is relevant enough to include their filmography
 */
function isValidPersonMatch(person, query) {
  if (!person) return false;
  if (person.popularity < 1.0) return false;

  // Name matching: check if query words appear in the person's name
  const queryWords = query.toLowerCase().split(/\s+/).filter(Boolean);
  const personName = person.name.toLowerCase();
  const nameWords = personName.split(/\s+/);

  // All query words must appear in name or vice-versa
  const allQueryWordsMatch = queryWords.every((w) => personName.includes(w));
  const allNameWordsMatch = nameWords.every((w) => query.toLowerCase().includes(w));

  return allQueryWordsMatch || allNameWordsMatch;
}

/**
 * Comprehensive search: runs title search + person search in parallel,
 * merges person filmography with title results, and deduplicates.
 *
 * Inspired by aiometadata's performTmdbSearch approach.
 */
export async function comprehensiveSearch(apiKey, query, type = 'movie', page = 1, options = {}) {
  const { displayLanguage, language, includeAdult } = options;
  const languageParam = displayLanguage || language;
  const mediaType = type === 'series' ? 'tv' : 'movie';

  // Build title search params
  const titleParams = { query, page };
  if (languageParam) titleParams.language = languageParam;
  if (includeAdult !== undefined) titleParams.include_adult = includeAdult;

  // Run title search + person search in parallel
  const shouldSearchPerson = page === 1 && looksLikePersonQuery(query);

  const [titleResult, personResult] = await Promise.all([
    tmdbFetch(`/search/${mediaType}`, apiKey, titleParams),
    shouldSearchPerson
      ? tmdbFetch('/search/person', apiKey, {
          query,
          ...(languageParam ? { language: languageParam } : {}),
        }).catch((err) => {
          log.warn('Person search failed, continuing with title results', { error: err.message });
          return { results: [] };
        })
      : Promise.resolve({ results: [] }),
  ]);

  const titleItems = titleResult?.results || [];

  // Also fetch page 2 of title results for broader coverage (only on first page)
  let titlePage2Items = [];
  if (page === 1 && titleItems.length >= 20) {
    try {
      const page2 = await tmdbFetch(`/search/${mediaType}`, apiKey, { ...titleParams, page: 2 });
      titlePage2Items = page2?.results || [];
    } catch {
      // Not critical — page 1 is enough
    }
  }

  // Process person results — find the best matching person
  let personCredits = [];
  const persons = personResult?.results || [];

  if (persons.length > 0) {
    const bestPerson = persons.find((p) => isValidPersonMatch(p, query));

    if (bestPerson) {
      log.debug('Valid person match found', {
        name: bestPerson.name,
        id: bestPerson.id,
        popularity: bestPerson.popularity,
      });

      try {
        const credits = await getPersonCredits(apiKey, bestPerson.id, type, languageParam);
        const castCredits = credits?.cast || [];
        const crewCredits = credits?.crew || [];

        // Combine cast + crew (director/writer roles), sort by popularity
        const allCredits = [...castCredits, ...crewCredits];
        allCredits.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
        personCredits = allCredits;

        log.debug('Person credits fetched', {
          person: bestPerson.name,
          creditCount: personCredits.length,
        });
      } catch (err) {
        log.warn('Failed to fetch person credits', { personId: bestPerson.id, error: err.message });
      }
    }
  }

  // Merge and deduplicate: title results first, then person credits
  const seen = new Set();
  const merged = [];

  for (const item of titleItems) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      merged.push(item);
    }
  }

  for (const item of personCredits) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      merged.push(item);
    }
  }

  for (const item of titlePage2Items) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      merged.push(item);
    }
  }

  return {
    results: merged,
    total_results: merged.length,
    page: page,
  };
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
