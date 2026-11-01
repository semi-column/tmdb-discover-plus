import { tmdbFetch } from './client.ts';
import { TMDB_IMAGE_BASE } from './constants.ts';
import { createLogger } from '../../utils/logger.ts';
import { logSwallowedError } from '../../utils/helpers.ts';
import { DISPLAY } from '../../constants.ts';
import { throwIfRequestAborted } from '../../utils/requestContext.ts';

import type {
  ContentType,
  Logger,
  PersonSearchResult,
  CompanySearchResult,
  KeywordSearchResult,
  CollectionSearchResult,
  ComprehensiveSearchOptions,
  ComprehensiveSearchResponse,
  TmdbPersonResult,
  TmdbPersonCredit,
  TmdbResult,
} from '../../types/index.ts';

const log = createLogger('tmdb:search') as Logger;

export async function search(
  apiKey: string,
  query: string,
  type: ContentType = 'movie',
  page: number = 1,
  options?: { displayLanguage?: string; language?: string; includeAdult?: boolean }
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

export async function searchPerson(apiKey: string, query: string): Promise<PersonSearchResult[]> {
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
  language?: string
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
  options: ComprehensiveSearchOptions = {}
): Promise<ComprehensiveSearchResponse> {
  throwIfRequestAborted();
  page = Math.max(1, Math.floor(page));
  const { displayLanguage, language, includeAdult } = options;
  const languageParam = displayLanguage || language;
  const mediaType = type === 'series' ? 'tv' : 'movie';

  const titleParams: Record<string, string | number | boolean | undefined> = { query, page: 1 };
  if (languageParam) titleParams.language = languageParam;
  if (includeAdult !== undefined) titleParams.include_adult = includeAdult;

  const shouldSearchPerson = looksLikePersonQuery(query);

  const [titleResult, personResult] = await Promise.all([
    tmdbFetch(`/search/${mediaType}`, apiKey, titleParams) as Promise<{
      results?: Array<{ id: number; [key: string]: unknown }>;
      total_pages?: number;
      total_results?: number;
    }>,
    shouldSearchPerson
      ? (
          tmdbFetch('/search/person', apiKey, {
            query,
            ...(languageParam ? { language: languageParam } : {}),
          }) as Promise<{ results?: TmdbPersonResult[] }>
        ).catch((err: Error) => {
          throwIfRequestAborted();
          log.warn('Person search failed, continuing with title results', { error: err });
          return { results: [] as TmdbPersonResult[] };
        })
      : Promise.resolve({ results: [] as TmdbPersonResult[] }),
  ]);

  const titleItems = titleResult?.results || [];

  const topMatch = titleItems[0] as
    | { id: number; title?: string; name?: string; popularity?: number; [key: string]: unknown }
    | undefined;
  if (
    topMatch &&
    (topMatch.popularity ?? 0) > 50 &&
    removeDiacritics((topMatch.title || topMatch.name || '').toLowerCase()) ===
      removeDiacritics(query.toLowerCase())
  ) {
    const result =
      page === 1
        ? titleResult
        : ((await search(apiKey, query, type, page, options)) as typeof titleResult);
    return {
      results: (result.results || []) as unknown as TmdbResult[],
      total_results: result.total_results ?? result.results?.length ?? 0,
      page,
    };
  }

  let titlePage2Items: Array<{ id: number; [key: string]: unknown }> = [];
  if (titleItems.length >= DISPLAY.TMDB_PAGE_SIZE) {
    try {
      const page2 = (await tmdbFetch(`/search/${mediaType}`, apiKey, {
        ...titleParams,
        page: 2,
      })) as { results?: Array<{ id: number; [key: string]: unknown }> };
      titlePage2Items = page2?.results || [];
    } catch (err) {
      throwIfRequestAborted();
      logSwallowedError('tmdb-search:page2-fetch', err);
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
        throwIfRequestAborted();
        log.warn('Failed to fetch person credits', {
          personId: bestPerson.id,
          error: err,
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

  const start = (page - 1) * DISPLAY.TMDB_PAGE_SIZE;
  const end = start + DISPLAY.TMDB_PAGE_SIZE;
  // Keep the title/filmography ordering stable across skip pages. Only hydrate
  // the requested page in the addon, not an entire person's career at once.
  let titlePage = 3;
  let moreTitles = titlePage2Items.length >= DISPLAY.TMDB_PAGE_SIZE;
  while (merged.length < end && moreTitles && titlePage <= (titleResult.total_pages ?? Infinity)) {
    throwIfRequestAborted();
    const next = (await search(apiKey, query, type, titlePage++, options)) as typeof titleResult;
    const items = next.results || [];
    moreTitles = items.length >= DISPLAY.TMDB_PAGE_SIZE;
    for (const item of items) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        merged.push(item);
      }
    }
  }
  throwIfRequestAborted();
  return {
    results: merged.slice(start, end) as unknown as TmdbResult[],
    total_results: merged.length,
    page: page,
  };
}

export async function searchCompany(apiKey: string, query: string): Promise<CompanySearchResult[]> {
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

export async function searchKeyword(apiKey: string, query: string): Promise<KeywordSearchResult[]> {
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

export async function searchCollection(
  apiKey: string,
  query: string,
  page: number = 1,
  language?: string
): Promise<{
  page: number;
  total_pages: number;
  total_results: number;
  results: CollectionSearchResult[];
}> {
  const params: Record<string, string | number | undefined> = { query, page };
  if (language) params.language = language;

  const data = (await tmdbFetch('/search/collection', apiKey, params)) as {
    page?: number;
    total_pages?: number;
    total_results?: number;
    results?: Array<{
      id: number;
      name: string;
      poster_path: string | null;
      backdrop_path: string | null;
    }>;
  };

  return {
    page: data.page || 1,
    total_pages: data.total_pages || 0,
    total_results: data.total_results || 0,
    results:
      data.results?.map((collection) => ({
        id: collection.id,
        name: collection.name,
        posterPath: collection.poster_path
          ? `${TMDB_IMAGE_BASE}/w185${collection.poster_path}`
          : null,
        backdropPath: collection.backdrop_path
          ? `${TMDB_IMAGE_BASE}/w780${collection.backdrop_path}`
          : null,
      })) || [],
  };
}
