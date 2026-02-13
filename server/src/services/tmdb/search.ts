import { tmdbFetch } from './client.ts';
import { TMDB_IMAGE_BASE } from './constants.ts';
import { createLogger } from '../../utils/logger.ts';

import type {
  ContentType,
  Logger,
  PersonSearchResult,
  CompanySearchResult,
  KeywordSearchResult,
  ComprehensiveSearchOptions,
  ComprehensiveSearchResponse,
  TmdbPersonResult,
  TmdbPersonCredit,
} from '../../types/index.ts';

const log = createLogger('tmdb:search') as Logger;

export async function search(
  apiKey: string,
  query: string,
  type: ContentType = 'movie',
  page: number = 1,
  options?: { displayLanguage?: string; language?: string; includeAdult?: boolean },
): Promise<unknown> {
  const mediaType = type === 'series' ? 'tv' : 'movie';
  const params: Record<string, string | number | boolean | undefined> = { query, page };
  const displayLanguage = options?.displayLanguage;
  const language = options?.language;
  const includeAdult = options?.includeAdult;
  const languageParam = displayLanguage || language;
  if (languageParam) params.language = languageParam;
  if (includeAdult !== undefined) params.include_adult = includeAdult;
  return tmdbFetch(`/search/${mediaType}`, apiKey, params);
}

export async function searchPerson(
  apiKey: string,
  query: string,
): Promise<PersonSearchResult[]> {
  const data = (await tmdbFetch('/search/person', apiKey, { query })) as {
    results?: TmdbPersonResult[];
  };
  return (
    data.results?.slice(0, 10).map((person) => ({
      id: person.id,
      name: person.name,
      profilePath: person.profile_path ? `${TMDB_IMAGE_BASE}/w185${person.profile_path}` : null,
      knownFor: person.known_for_department,
    })) || []
  );
}

async function getPersonCredits(
  apiKey: string,
  personId: number,
  type: ContentType = 'movie',
  language?: string,
): Promise<{ cast?: TmdbPersonCredit[]; crew?: TmdbPersonCredit[] }> {
  const mediaType = type === 'series' ? 'tv' : 'movie';
  const params: Record<string, string | undefined> = {};
  if (language) params.language = language;
  return (await tmdbFetch(`/person/${personId}/${mediaType}_credits`, apiKey, params)) as {
    cast?: TmdbPersonCredit[];
    crew?: TmdbPersonCredit[];
  };
}

function looksLikePersonQuery(query: string): boolean {
  return !/[:()\[\]?!$#@&]/.test(query) && !/^\d+$/.test(query.trim());
}

function removeDiacritics(str: string): string {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function isValidPersonMatch(person: TmdbPersonResult | undefined, query: string): boolean {
  if (!person) return false;
  if (person.popularity < 1.0) return false;

  const normQuery = removeDiacritics(query.toLowerCase());
  const normName = removeDiacritics(person.name.toLowerCase());
  const queryWords = normQuery.split(/\s+/).filter(Boolean);
  const nameWords = normName.split(/\s+/);

  const allQueryWordsMatch = queryWords.every((w) => normName.includes(w));
  const allNameWordsMatch = nameWords.every((w) => normQuery.includes(w));

  return allQueryWordsMatch || allNameWordsMatch;
}

export async function comprehensiveSearch(
  apiKey: string,
  query: string,
  type: ContentType = 'movie',
  page: number = 1,
  options: ComprehensiveSearchOptions = {},
): Promise<ComprehensiveSearchResponse> {
  const { displayLanguage, language, includeAdult } = options;
  const languageParam = displayLanguage || language;
  const mediaType = type === 'series' ? 'tv' : 'movie';

  const titleParams: Record<string, string | number | boolean | undefined> = { query, page };
  if (languageParam) titleParams.language = languageParam;
  if (includeAdult !== undefined) titleParams.include_adult = includeAdult;

  const shouldSearchPerson = page === 1 && looksLikePersonQuery(query);

  const [titleResult, personResult] = await Promise.all([
    tmdbFetch(`/search/${mediaType}`, apiKey, titleParams) as Promise<{
      results?: Array<{ id: number; [key: string]: unknown }>;
    }>,
    shouldSearchPerson
      ? (
          tmdbFetch('/search/person', apiKey, {
            query,
            ...(languageParam ? { language: languageParam } : {}),
          }) as Promise<{ results?: TmdbPersonResult[] }>
        ).catch((err: Error) => {
          log.warn('Person search failed, continuing with title results', { error: err.message });
          return { results: [] as TmdbPersonResult[] };
        })
      : Promise.resolve({ results: [] as TmdbPersonResult[] }),
  ]);

  const titleItems = titleResult?.results || [];

  const topMatch = titleItems[0] as { id: number; title?: string; name?: string; popularity?: number; [key: string]: unknown } | undefined;
  if (
    page === 1 &&
    topMatch &&
    (topMatch.popularity ?? 0) > 50 &&
    removeDiacritics((topMatch.title || topMatch.name || '').toLowerCase()) ===
      removeDiacritics(query.toLowerCase())
  ) {
    return {
      results: titleItems as unknown as ComprehensiveSearchResponse['results'],
      total_results: titleItems.length,
      page: 1,
    };
  }

  let titlePage2Items: Array<{ id: number; [key: string]: unknown }> = [];
  if (page === 1 && titleItems.length >= 20) {
    try {
      const page2 = (await tmdbFetch(`/search/${mediaType}`, apiKey, {
        ...titleParams,
        page: 2,
      })) as { results?: Array<{ id: number; [key: string]: unknown }> };
      titlePage2Items = page2?.results || [];
    } catch {
      /* not critical */
    }
  }

  let personCredits: TmdbPersonCredit[] = [];
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

        const allCredits = [...castCredits, ...crewCredits];
        allCredits.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
        personCredits = allCredits;

        log.debug('Person credits fetched', {
          person: bestPerson.name,
          creditCount: personCredits.length,
        });
      } catch (err) {
        log.warn('Failed to fetch person credits', {
          personId: bestPerson.id,
          error: (err as Error).message,
        });
      }
    }
  }

  const seen = new Set<number>();
  const merged: Array<{ id: number; [key: string]: unknown }> = [];

  for (const item of titleItems) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      merged.push(item);
    }
  }

  for (const item of personCredits) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      merged.push(item as unknown as { id: number; [key: string]: unknown });
    }
  }

  for (const item of titlePage2Items) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      merged.push(item);
    }
  }

  return {
    results: merged as unknown as ComprehensiveSearchResponse['results'],
    total_results: merged.length,
    page: page,
  };
}

export async function searchCompany(
  apiKey: string,
  query: string,
): Promise<CompanySearchResult[]> {
  const data = (await tmdbFetch('/search/company', apiKey, { query })) as {
    results?: Array<{ id: number; name: string; logo_path: string | null }>;
  };
  return (
    data.results?.slice(0, 10).map((company) => ({
      id: company.id,
      name: company.name,
      logoPath: company.logo_path ? `${TMDB_IMAGE_BASE}/w185${company.logo_path}` : null,
    })) || []
  );
}

export async function searchKeyword(
  apiKey: string,
  query: string,
): Promise<KeywordSearchResult[]> {
  const data = (await tmdbFetch('/search/keyword', apiKey, { query })) as {
    results?: Array<{ id: number; name: string }>;
  };
  return (
    data.results?.slice(0, 10).map((keyword) => ({
      id: keyword.id,
      name: keyword.name,
    })) || []
  );
}
