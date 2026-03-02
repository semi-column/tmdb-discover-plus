import {
  SYSTEM_PROMPT,
  AI_CATALOG_SCHEMA,
  buildUserPrompt,
  MOVIE_GENRES,
  TV_GENRES,
} from '../data/aiPrompt';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_MODEL = 'gemini-3-flash-preview';
const GENERATION_TIMEOUT = 30000;

const VALID_MOVIE_GENRE_IDS = Object.keys(MOVIE_GENRES).map(Number);
const VALID_TV_GENRE_IDS = Object.keys(TV_GENRES).map(Number);

const VALID_MOVIE_SORT = [
  'popularity.desc',
  'popularity.asc',
  'vote_average.desc',
  'vote_average.asc',
  'vote_count.desc',
  'vote_count.asc',
  'primary_release_date.desc',
  'primary_release_date.asc',
  'release_date.desc',
  'release_date.asc',
  'revenue.desc',
  'revenue.asc',
  'original_title.asc',
  'original_title.desc',
  'title.asc',
  'title.desc',
];

const VALID_TV_SORT = [
  'popularity.desc',
  'popularity.asc',
  'vote_average.desc',
  'vote_average.asc',
  'vote_count.desc',
  'vote_count.asc',
  'first_air_date.desc',
  'first_air_date.asc',
  'original_name.asc',
  'original_name.desc',
  'name.asc',
  'name.desc',
];

const VALID_LIST_TYPES = {
  movie: [
    'discover',
    'trending_day',
    'trending_week',
    'now_playing',
    'upcoming',
    'top_rated',
    'popular',
  ],
  series: [
    'discover',
    'trending_day',
    'trending_week',
    'airing_today',
    'on_the_air',
    'top_rated',
    'popular',
  ],
};

const VALID_MONETIZATION = ['flatrate', 'free', 'ads', 'rent', 'buy'];

const VALID_DATE_PRESETS = [
  'last_30_days',
  'last_90_days',
  'last_180_days',
  'last_365_days',
  'next_30_days',
  'next_90_days',
  'era_2020s',
  'era_2010s',
  'era_2000s',
  'era_1990s',
  'era_1980s',
];

const TMDB_FILTER_KEYS = new Set([
  'listType',
  'sortBy',
  'genres',
  'excludeGenres',
  'genreMatchMode',
  'yearFrom',
  'yearTo',
  'ratingMin',
  'ratingMax',
  'voteCountMin',
  'runtimeMin',
  'runtimeMax',
  'language',
  'countries',
  'datePreset',
  'releaseDateFrom',
  'releaseDateTo',
  'releaseTypes',
  'certifications',
  'certificationCountry',
  'tvStatus',
  'tvType',
  'watchMonetizationTypes',
  'watchProviders',
  'watchRegion',
  'withPeople',
  'withCompanies',
  'withKeywords',
  'excludeKeywords',
  'excludeCompanies',
  'withNetworks',
  'region',
  'randomize',
  'includeAdult',
  'imdbOnly',
  'releasedOnly',
  'includeVideo',
  'discoverOnly',
]);

const IMDB_FILTER_KEYS = new Set([
  'listType',
  'sortBy',
  'sortOrder',
  'genres',
  'imdbRatingMin',
  'totalVotesMin',
  'keywords',
  'imdbCountries',
  'languages',
  'yearFrom',
  'yearTo',
  'includeAdult',
]);

const MOVIE_ONLY_KEYS = new Set([
  'releaseTypes',
  'certifications',
  'certificationCountry',
  'region',
]);
const SERIES_ONLY_KEYS = new Set(['tvStatus', 'tvType', 'withNetworks']);

function clamp(value, min, max) {
  if (typeof value !== 'number' || isNaN(value)) return undefined;
  return Math.max(min, Math.min(max, value));
}

export function sanitizeAIResponse(response) {
  if (!response || typeof response !== 'object') {
    throw new Error('AI returned an empty or invalid response');
  }

  const { name, type, source, filters, entitiesToResolve } = response;

  if (!type || !['movie', 'series'].includes(type)) {
    throw new Error(`Invalid content type: "${type}". Must be "movie" or "series".`);
  }

  const sanitizedSource = ['tmdb', 'imdb'].includes(source) ? source : 'tmdb';
  const sanitizedName =
    typeof name === 'string' ? name.slice(0, 50).trim() || 'AI Catalog' : 'AI Catalog';

  if (!filters || typeof filters !== 'object') {
    throw new Error('AI response missing filters object');
  }

  const allowedKeys = sanitizedSource === 'imdb' ? IMDB_FILTER_KEYS : TMDB_FILTER_KEYS;
  const sanitizedFilters = {};

  for (const [key, value] of Object.entries(filters)) {
    if (!allowedKeys.has(key)) continue;
    if (type === 'movie' && SERIES_ONLY_KEYS.has(key)) continue;
    if (type === 'series' && MOVIE_ONLY_KEYS.has(key)) continue;
    if (value === undefined || value === null) continue;
    sanitizedFilters[key] = value;
  }

  if (sanitizedSource === 'tmdb') {
    const validGenreIds = type === 'movie' ? VALID_MOVIE_GENRE_IDS : VALID_TV_GENRE_IDS;

    if (Array.isArray(sanitizedFilters.genres)) {
      sanitizedFilters.genres = sanitizedFilters.genres.filter((id) => validGenreIds.includes(id));
      if (sanitizedFilters.genres.length === 0) delete sanitizedFilters.genres;
    }

    if (Array.isArray(sanitizedFilters.excludeGenres)) {
      sanitizedFilters.excludeGenres = sanitizedFilters.excludeGenres.filter((id) =>
        validGenreIds.includes(id)
      );
      if (sanitizedFilters.excludeGenres.length === 0) delete sanitizedFilters.excludeGenres;
    }

    const validSort = type === 'movie' ? VALID_MOVIE_SORT : VALID_TV_SORT;
    if (sanitizedFilters.sortBy && !validSort.includes(sanitizedFilters.sortBy)) {
      delete sanitizedFilters.sortBy;
    }

    const validListTypes = VALID_LIST_TYPES[type];
    if (sanitizedFilters.listType && !validListTypes.includes(sanitizedFilters.listType)) {
      sanitizedFilters.listType = 'discover';
    }
    sanitizedFilters.listType = 'discover';

    if (Array.isArray(sanitizedFilters.releaseTypes)) {
      sanitizedFilters.releaseTypes = sanitizedFilters.releaseTypes.filter((v) => v >= 1 && v <= 6);
      if (sanitizedFilters.releaseTypes.length === 0) delete sanitizedFilters.releaseTypes;
    }

    if (sanitizedFilters.releaseTypes?.length > 0 && !sanitizedFilters.region) {
      delete sanitizedFilters.releaseTypes;
    }

    if (
      sanitizedFilters.genreMatchMode &&
      !['any', 'all'].includes(sanitizedFilters.genreMatchMode)
    ) {
      delete sanitizedFilters.genreMatchMode;
    }

    if (sanitizedFilters.datePreset && !VALID_DATE_PRESETS.includes(sanitizedFilters.datePreset)) {
      delete sanitizedFilters.datePreset;
    }

    // Strip null values from filters (model outputs null for unused nullable fields)
    for (const [key, value] of Object.entries(sanitizedFilters)) {
      if (value === null || value === undefined) delete sanitizedFilters[key];
    }

    // Convert decade year ranges to era presets (e.g., 2010-2019 → era_2010s)
    if (
      !sanitizedFilters.datePreset &&
      sanitizedFilters.yearFrom !== undefined &&
      sanitizedFilters.yearTo !== undefined
    ) {
      const DECADE_MAP = {
        '1980-1989': 'era_1980s',
        '1990-1999': 'era_1990s',
        '2000-2009': 'era_2000s',
        '2010-2019': 'era_2010s',
        '2020-2029': 'era_2020s',
      };
      const rangeKey = `${sanitizedFilters.yearFrom}-${sanitizedFilters.yearTo}`;
      if (DECADE_MAP[rangeKey]) {
        sanitizedFilters.datePreset = DECADE_MAP[rangeKey];
        delete sanitizedFilters.yearFrom;
        delete sanitizedFilters.yearTo;
      }
    }

    // Strip yearFrom/yearTo when sorting by release date — sorting alone handles recency
    const sortByDate =
      sanitizedFilters.sortBy === 'primary_release_date.desc' ||
      sanitizedFilters.sortBy === 'first_air_date.desc';
    if (sortByDate && sanitizedFilters.yearFrom !== undefined && !sanitizedFilters.datePreset) {
      const currentYear = new Date().getFullYear();
      const span = (sanitizedFilters.yearTo || currentYear) - sanitizedFilters.yearFrom;
      // If the range is small (≤3 years) and includes the current year, it's likely an
      // AI-invented "recent" range — remove it since the sort already handles recency
      if (span <= 3 && (sanitizedFilters.yearTo || currentYear) >= currentYear - 1) {
        delete sanitizedFilters.yearFrom;
        delete sanitizedFilters.yearTo;
      }
    }

    // Strip voteCountMin unless sorting by vote_average (it's only useful there)
    if (
      sanitizedFilters.voteCountMin !== undefined &&
      sanitizedFilters.sortBy &&
      !sanitizedFilters.sortBy.startsWith('vote_average')
    ) {
      delete sanitizedFilters.voteCountMin;
    }

    if (Array.isArray(sanitizedFilters.watchMonetizationTypes)) {
      sanitizedFilters.watchMonetizationTypes = sanitizedFilters.watchMonetizationTypes.filter(
        (v) => VALID_MONETIZATION.includes(v)
      );
      if (sanitizedFilters.watchMonetizationTypes.length === 0)
        delete sanitizedFilters.watchMonetizationTypes;
    }

    sanitizedFilters.ratingMin = clamp(sanitizedFilters.ratingMin, 0, 10);
    sanitizedFilters.ratingMax = clamp(sanitizedFilters.ratingMax, 0, 10);
    sanitizedFilters.voteCountMin = clamp(sanitizedFilters.voteCountMin, 0, 10000);
    sanitizedFilters.runtimeMin = clamp(sanitizedFilters.runtimeMin, 0, 400);
    sanitizedFilters.runtimeMax = clamp(sanitizedFilters.runtimeMax, 0, 400);
    sanitizedFilters.yearFrom = clamp(sanitizedFilters.yearFrom, 1900, 2030);
    sanitizedFilters.yearTo = clamp(sanitizedFilters.yearTo, 1900, 2030);

    // Strip yearFrom/yearTo at boundary values (AI hallucination from schema defaults)
    if (sanitizedFilters.yearFrom !== undefined && sanitizedFilters.yearFrom <= 1900) {
      delete sanitizedFilters.yearFrom;
    }
    if (sanitizedFilters.yearTo !== undefined && sanitizedFilters.yearTo <= 1900) {
      delete sanitizedFilters.yearTo;
    }
    // Strip zero-value numeric filters (model outputting 0 as "empty")
    for (const numKey of ['ratingMin', 'ratingMax', 'voteCountMin', 'runtimeMin', 'runtimeMax']) {
      if (sanitizedFilters[numKey] === 0) delete sanitizedFilters[numKey];
    }

    for (const [key, value] of Object.entries(sanitizedFilters)) {
      if (value === undefined || value === null) delete sanitizedFilters[key];
    }
  }

  if (sanitizedSource === 'imdb') {
    // Strip nulls first (from nullable schema)
    for (const [key, value] of Object.entries(sanitizedFilters)) {
      if (value === null || value === undefined) delete sanitizedFilters[key];
    }

    sanitizedFilters.imdbRatingMin = clamp(sanitizedFilters.imdbRatingMin, 0, 10);
    sanitizedFilters.totalVotesMin = clamp(sanitizedFilters.totalVotesMin, 0, 1000000);
    sanitizedFilters.yearFrom = clamp(sanitizedFilters.yearFrom, 1900, 2030);
    sanitizedFilters.yearTo = clamp(sanitizedFilters.yearTo, 1900, 2030);

    if (sanitizedFilters.sortOrder && !['ASC', 'DESC'].includes(sanitizedFilters.sortOrder)) {
      delete sanitizedFilters.sortOrder;
    }

    for (const [key, value] of Object.entries(sanitizedFilters)) {
      if (value === undefined) delete sanitizedFilters[key];
    }
  }

  const result = {
    name: sanitizedName,
    type,
    source: sanitizedSource,
    filters: sanitizedFilters,
  };

  if (entitiesToResolve && typeof entitiesToResolve === 'object') {
    const sanitizedEntities = {};
    for (const [key, value] of Object.entries(entitiesToResolve)) {
      if (Array.isArray(value) && value.length > 0) {
        sanitizedEntities[key] = value
          .filter((v) => typeof v === 'string' && v.trim())
          .map((v) => v.trim());
      }
    }
    if (Object.keys(sanitizedEntities).length > 0) {
      result.entitiesToResolve = sanitizedEntities;
    }
  }

  return result;
}

export async function validateGeminiKey(apiKey) {
  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    return { valid: false, error: 'API key is empty' };
  }

  try {
    const res = await fetch(`${GEMINI_BASE}/models?key=${encodeURIComponent(apiKey.trim())}`);

    if (res.ok) return { valid: true };

    if (res.status === 400) return { valid: false, error: 'Invalid API key format' };
    if (res.status === 403) return { valid: false, error: 'API key is invalid or revoked' };

    return { valid: false, error: `Validation failed (HTTP ${res.status})` };
  } catch {
    return { valid: false, error: 'Could not connect to Gemini. Check your internet connection.' };
  }
}

export async function generateCatalog(apiKey, userMessage, existingCatalog) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GENERATION_TIMEOUT);

  try {
    const res = await fetch(
      `${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey.trim())}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ parts: [{ text: buildUserPrompt(userMessage, existingCatalog) }] }],
          generationConfig: {
            response_mime_type: 'application/json',
            response_json_schema: AI_CATALOG_SCHEMA,
          },
        }),
      }
    );

    if (!res.ok) {
      if (res.status === 429) throw new Error('Rate limited — please wait a moment and try again.');
      if (res.status === 401 || res.status === 403)
        throw new Error('Your Gemini API key is invalid or expired. Please check it in Settings.');
      if (res.status >= 500)
        throw new Error('Gemini is experiencing issues. Please try again later.');
      throw new Error(`Gemini request failed (HTTP ${res.status})`);
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) throw new Error('AI generated an unexpected response. Try rephrasing your request.');

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('AI generated an unexpected response. Try rephrasing your request.');
    }

    return sanitizeAIResponse(parsed);
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Request timed out. Please try again.');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
