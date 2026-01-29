import fetch from 'node-fetch';
import https from 'node:https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getCache } from './cache/index.js';
import { shuffleArray } from '../utils/helpers.js';
import { createLogger } from '../utils/logger.js';
import { generatePosterUrl, generateBackdropUrl, isValidPosterConfig } from './posterService.js';

import { getRpdbRating } from './rpdb.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ...

const log = createLogger('tmdb');

const httpsAgent = new https.Agent({
  keepAlive: true,
  rejectUnauthorized: process.env.DISABLE_TLS_VERIFY !== 'true',
});

// Cache is initialized in index.js via initCache

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_WEBSITE_BASE_URL = 'https://www.themoviedb.org';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

const TMDB_API_URL = new URL(TMDB_BASE_URL);
const TMDB_API_ORIGIN = TMDB_API_URL.origin; // https://api.themoviedb.org
const TMDB_API_BASE_PATH = TMDB_API_URL.pathname.replace(/\/$/, ''); // /3

const TMDB_SITE_URL = new URL(TMDB_WEBSITE_BASE_URL);
const TMDB_SITE_ORIGIN = TMDB_SITE_URL.origin; // https://www.themoviedb.org

// Genre mappings (will be populated from API)
// Structure: { movie: { en: [...], it: [...] }, tv: { ... } }
let genreCache = { movie: {}, tv: {} };

let staticGenreMap = { movie: {}, tv: {} };
try {
  const genresPath = path.join(__dirname, 'tmdb_genres.json');
  const raw = fs.readFileSync(genresPath, 'utf8');
  staticGenreMap = JSON.parse(raw);
} catch (err) {
  log.warn('Could not load static TMDB genre mapping', { error: err.message });
}

function redactTmdbUrl(urlString) {
  if (typeof urlString !== 'string') return urlString;
  return urlString.replace(/([?&]api_key=)[^&\s]+/gi, '$1[REDACTED]');
}

function isProbablyAbsoluteUrl(input) {
  const s = String(input || '').trim();
  return /^([a-zA-Z][a-zA-Z0-9+.-]*:)?\/\//.test(s);
}

function normalizeEndpoint(endpoint) {
  const ep = String(endpoint || '').trim();
  if (!ep) throw new Error('Invalid TMDB endpoint: empty');
  // Prevent accidental absolute URLs like "https://..." or protocol-relative "//...".
  if (isProbablyAbsoluteUrl(ep)) throw new Error('Invalid TMDB endpoint: absolute URL not allowed');
  // Normalize to a leading slash.
  return ep.startsWith('/') ? ep : `/${ep}`;
}

function assertAllowedUrl(url, { origin, pathPrefix }) {
  if (!(url instanceof URL)) throw new Error('Invalid URL');
  if (url.protocol !== 'https:') throw new Error('Blocked non-HTTPS outbound request');
  if (url.username || url.password) throw new Error('Blocked URL with credentials');
  if (origin && url.origin !== origin)
    throw new Error(`Blocked outbound request to untrusted origin: ${url.origin}`);
  if (pathPrefix && !url.pathname.startsWith(pathPrefix)) {
    throw new Error(`Blocked outbound request to untrusted path: ${url.pathname}`);
  }
}

/**
 * Make a request to TMDB API with retries
 */
async function tmdbFetch(endpoint, apiKey, params = {}, retries = 3) {
  const ep = normalizeEndpoint(endpoint);
  const url = new URL(TMDB_API_ORIGIN);
  url.pathname = `${TMDB_API_BASE_PATH}${ep}`;

  // Defense-in-depth: ensure we only ever call TMDB API host and /3 path.
  assertAllowedUrl(url, { origin: TMDB_API_ORIGIN, pathPrefix: `${TMDB_API_BASE_PATH}/` });

  url.searchParams.set('api_key', apiKey);

  Object.entries(params).forEach(([key, value]) => {
    // Prevent callers from overriding api_key via params.
    if (key === 'api_key') return;
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  });

  const cacheKey = url.toString();
  const cache = getCache();

  try {
    const cached = await cache.get(cacheKey);
    if (cached) return cached;
  } catch (err) {
    log.warn('Cache get failed', { error: err.message });
  }

  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (process.env.DEBUG_TMDB === '1') {
        log.debug(`TMDB request (attempt ${attempt + 1})`, { url: redactTmdbUrl(url.toString()) });
      }

      const response = await fetch(url.toString(), { agent: httpsAgent });

      if (!response.ok) {
        // If 429 (Too Many Requests), we might want to respect Retry-After header,
        // but typically standard backoff is enough for loose rate limits.
        // For 5xx errors, we retry. For 4xx (except maybe 429), we generally don't retry.
        if (response.status >= 500 || response.status === 429) {
          throw new Error(`TMDB API retryable error: ${response.status}`);
        }

        const error = await response.json().catch(() => ({}));
        throw new Error(error.status_message || `TMDB API error: ${response.status}`);
      }

      const data = await response.json();

      try {
        await cache.set(cacheKey, data, 3600); // 1 hour TTL
      } catch (cacheErr) {
        // If cache is full or errors, just log it and proceed. Don't crash the request.
        log.warn('Failed to cache TMDB response', { key: cacheKey, error: cacheErr.message });
      }

      return data;
    } catch (error) {
      lastError = error;
      const isNetworkError =
        error.code === 'ECONNREFUSED' ||
        error.code === 'ECONNRESET' ||
        error.code === 'ETIMEDOUT' ||
        error.message.includes('retryable error') ||
        error.name === 'FetchError';

      if (attempt < retries && isNetworkError) {
        // Exponential backoff: 300ms, 600ms, 1200ms...
        const delay = 300 * Math.pow(2, attempt);
        log.warn(`TMDB request failed, retrying in ${delay}ms`, {
          attempt: attempt + 1,
          error: redactTmdbUrl(error.message),
        });
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      // If we're out of retries or it's not a retryable error, break.
      break;
    }
  }

  log.error('TMDB fetch error after retries', { error: redactTmdbUrl(lastError.message) });
  throw lastError;
}



function normalizeLoose(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ') // keep boundaries
    .trim();
}

function matchesLoose(haystack, needle) {
  const h = normalizeLoose(haystack);
  const n = normalizeLoose(needle);
  if (!n) return false;
  return h.includes(n);
}

async function tmdbWebsiteFetchJson(endpoint, params = {}) {
  const ep = normalizeEndpoint(endpoint);
  const url = new URL(TMDB_SITE_ORIGIN);
  url.pathname = ep;

  // Defense-in-depth: only call TMDB website host.
  assertAllowedUrl(url, { origin: TMDB_SITE_ORIGIN });

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  });

  const cacheKey = `tmdb_site:${url.toString()}`;
  const cache = getCache();

  try {
    const cached = await cache.get(cacheKey);
    if (cached) return cached;
  } catch (e) {
    /* ignore get error */
  }

  const response = await fetch(url.toString(), {
    agent: httpsAgent,
    headers: {
      Accept: 'application/json, text/plain, */*',
      'X-Requested-With': 'XMLHttpRequest',
      // Lightweight UA to avoid some overly aggressive bot blocks.
      'User-Agent': 'tmdb-discover-plus/2.x',
    },
  });

  if (!response.ok) {
    throw new Error(`TMDB website search error: ${response.status}`);
  }

  const text = await response.text();
  const trimmed = text.trim();
  const data = trimmed ? JSON.parse(trimmed) : null;

  try {
    await cache.set(cacheKey, data, 3600);
  } catch (err) {
    log.warn('Failed to cache TMDB website response', { key: cacheKey, error: err.message });
  }

  return data;
}

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
 * Get available languages
 */
export async function getLanguages(apiKey) {
  const cacheKey = 'tmdb_languages';
  const cache = getCache();

  try {
    const cached = await cache.get(cacheKey);
    if (cached) return cached;
  } catch (e) {
    /* ignore */
  }

  const data = await tmdbFetch('/configuration/languages', apiKey);
  const sorted = data.sort((a, b) => a.english_name.localeCompare(b.english_name));

  try {
    await cache.set(cacheKey, sorted, 86400 * 7); // 7 days
  } catch (e) {
    /* ignore */
  }

  return sorted;
}

/**
 * Get available countries
 */
export async function getCountries(apiKey) {
  const cacheKey = 'tmdb_countries';
  const cache = getCache();

  try {
    const cached = await cache.get(cacheKey);
    if (cached) return cached;
  } catch (e) {
    /* ignore */
  }

  const data = await tmdbFetch('/configuration/countries', apiKey);
  const sorted = data.sort((a, b) => a.english_name.localeCompare(b.english_name));

  try {
    await cache.set(cacheKey, sorted, 86400 * 7); // 7 days
  } catch (e) {
    /* ignore */
  }

  return sorted;
}

/**
 * Get certifications (age ratings)
 */
export async function getCertifications(apiKey, type = 'movie') {
  const mediaType = type === 'series' ? 'tv' : 'movie';
  const cacheKey = `tmdb_certifications_${mediaType}`;
  const cache = getCache();

  try {
    const cached = await cache.get(cacheKey);
    if (cached) return cached;
  } catch (e) {
    /* ignore */
  }

  const data = await tmdbFetch(`/certification/${mediaType}/list`, apiKey);
  const certs = data.certifications || {};

  try {
    await cache.set(cacheKey, certs, 86400 * 7); // 7 days
  } catch (e) {
    /* ignore */
  }

  return certs;
}

/**
 * Get watch provider regions
 */
export async function getWatchRegions(apiKey) {
  const cacheKey = 'tmdb_watch_regions';
  const cache = getCache();

  try {
    const cached = await cache.get(cacheKey);
    if (cached) return cached;
  } catch (e) {
    /* ignore */
  }

  const data = await tmdbFetch('/watch/providers/regions', apiKey);
  const results = data.results || [];
  const sorted = results.sort((a, b) => a.english_name.localeCompare(b.english_name));

  try {
    await cache.set(cacheKey, sorted, 86400 * 7); // 7 days
  } catch (e) {
    /* ignore */
  }

  return sorted;
}

/**
 * Get watch providers for a region
 */
export async function getWatchProviders(apiKey, type = 'movie', region = 'US') {
  const mediaType = type === 'series' ? 'tv' : 'movie';
  const cacheKey = `tmdb_watch_providers_${mediaType}_${region}`;
  const cache = getCache();

  try {
    const cached = await cache.get(cacheKey);
    if (cached) return cached;
  } catch (e) {
    /* ignore */
  }

  const params = { watch_region: region };
  const data = await tmdbFetch(`/watch/providers/${mediaType}`, apiKey, params);
  const results = data.results || [];
  const sorted = results.sort((a, b) => a.provider_name.localeCompare(b.provider_name));

  try {
    await cache.set(cacheKey, sorted, 86400); // 24 hours
  } catch (e) {
    /* ignore */
  }

  return sorted;
}

/**
 * Get genre list for movies or TV
 */
export async function getGenres(apiKey, type = 'movie', language = 'en') {
  const mediaType = type === 'series' ? 'tv' : 'movie';
  const lang = language || 'en';

  if (genreCache[mediaType]?.[lang]) {
    return genreCache[mediaType][lang];
  }

  // If cache structure is not initialized (legacy format handling)
  if (!genreCache[mediaType]) genreCache[mediaType] = {};

  const params = {};
  if (lang !== 'en') params.language = lang;

  const data = await tmdbFetch(`/genre/${mediaType}/list`, apiKey, params);

  if (!genreCache[mediaType]) genreCache[mediaType] = {};
  genreCache[mediaType][lang] = data.genres;

  return data.genres;
}

// Expose cached genres accessor for other modules (may be null if not yet fetched)
export function getCachedGenres(type = 'movie', language = 'en') {
  const mediaType = type === 'series' ? 'tv' : 'movie';
  const lang = language || 'en';
  return genreCache[mediaType]?.[lang] || null;
}

/**
 * Discover movies or TV shows with filters
 */
export async function discover(apiKey, options = {}) {
  const {
    type = 'movie',
    genres = [],
    excludeGenres = [],
    yearFrom,
    yearTo,
    ratingMin,
    ratingMax,
    sortBy = 'popularity.desc',
    language,
    displayLanguage,
    originCountry,
    includeAdult = false,
    voteCountMin = 0,
    page = 1,
    genreMatchMode = 'any', // 'any' (OR) or 'all' (AND)
    randomize = false,
    // Movie-specific
    releaseDateFrom,
    releaseDateTo,
    releaseTypes = [],
    releaseType, // singular (new)
    certification,
    certifications = [], // multiple (new)
    certificationCountry,
    runtimeMin,
    runtimeMax,
    withCast,
    withCrew,
    withPeople,
    withCompanies,
    withKeywords,
    excludeKeywords,
    excludeCompanies,
    region, // For regional release date filtering (movies)
    // TV-specific
    airDateFrom,
    airDateTo,
    firstAirDateFrom, // When show first premiered
    firstAirDateTo,
    withNetworks,
    tvStatus,
    tvType,
    // Watch providers
    watchRegion,
    watchProviders = [],
    watchMonetizationTypes = [],
    watchMonetizationType, // singular (new)
  } = options;

  const mediaType = type === 'series' ? 'tv' : 'movie';
  const endpoint = `/discover/${mediaType}`;

  const params = {
    sort_by: sortBy,
    page,
    include_adult: includeAdult,
    'vote_count.gte': voteCountMin,
  };

  // Genres: use pipe-separated list for OR, comma for AND
  // TMDB accepts comma (,) for AND logic, pipe (|) for OR logic
  // Default to OR (pipe) for backward compatibility unless explicitly set to 'all'
  if (genres.length > 0) {
    const separator = genreMatchMode === 'all' ? ',' : '|';
    params.with_genres = genres.join(separator);
  }
  if (excludeGenres.length > 0) {
    params.without_genres = excludeGenres.join(',');
  }

  // Year filters (legacy - uses date filters internally)
  // When region is set, use release_date to filter by regional release (TMDB behavior)
  // Without region, use primary_release_date to filter by global release
  if (mediaType === 'movie') {
    const dateKey = region ? 'release_date' : 'primary_release_date';
    if (yearFrom && !releaseDateFrom) params[`${dateKey}.gte`] = `${yearFrom}-01-01`;
    if (yearTo && !releaseDateTo) params[`${dateKey}.lte`] = `${yearTo}-12-31`;
  } else {
    if (yearFrom && !airDateFrom) params['first_air_date.gte'] = `${yearFrom}-01-01`;
    if (yearTo && !airDateTo) params['first_air_date.lte'] = `${yearTo}-12-31`;
  }

  // Rating filters
  if (ratingMin) params['vote_average.gte'] = ratingMin;
  if (ratingMax) params['vote_average.lte'] = ratingMax;

  // Original language filter
  if (language) params.with_original_language = language;

  // Display language (localize titles/overviews where available)
  if (displayLanguage) {
    params.language = displayLanguage;
    // Also request localized images, fallback to null (no text)
    params.include_image_language = `${displayLanguage},null`;
  }

  // Origin country
  // Origin country
  // TMDB supports pipe (|) for OR logic
  if (originCountry) {
    params.with_origin_country = Array.isArray(originCountry)
      ? originCountry.join('|')
      : String(originCountry).replace(/,/g, '|');
  }

  // Runtime filters
  if (runtimeMin) params['with_runtime.gte'] = runtimeMin;
  if (runtimeMax) params['with_runtime.lte'] = runtimeMax;

  // Movie-specific filters
  if (mediaType === 'movie') {
    // Region for regional release dates
    if (region) params.region = region;

    // Release date filters
    // When region is set, use release_date to filter by regional release
    // Without region, use primary_release_date to filter by global/original release
    const dateKey = region ? 'release_date' : 'primary_release_date';
    if (releaseDateFrom) params[`${dateKey}.gte`] = releaseDateFrom;
    if (releaseDateTo) params[`${dateKey}.lte`] = releaseDateTo;

    // Release type filter (1=Premiere, 2=Limited, 3=Theatrical, 4=Digital, 5=Physical, 6=TV)
    if (releaseType) {
      params.with_release_type = releaseType;
    } else if (releaseTypes.length > 0) {
      params.with_release_type = releaseTypes.join('|');
    }

    // Certification (age rating) - supports multiple values with pipe separator
    if (certifications.length > 0) {
      params.certification = certifications.join('|');
      params.certification_country = certificationCountry || 'US';
    } else if (certification) {
      params.certification = certification;
      params.certification_country = certificationCountry || 'US';
    }
  }

  // TV-specific filters
  if (mediaType === 'tv') {
    // Air date filters (when episodes air)
    if (airDateFrom) params['air_date.gte'] = airDateFrom;
    if (airDateTo) params['air_date.lte'] = airDateTo;

    // First air date filters (when show premiered) - separate from episode air dates
    if (firstAirDateFrom) params['first_air_date.gte'] = firstAirDateFrom;
    if (firstAirDateTo) params['first_air_date.lte'] = firstAirDateTo;

    // Networks
    if (withNetworks) params.with_networks = withNetworks;

    // Status (0=Returning, 1=Planned, 2=Pilot, 3=Ended, 4=Cancelled, 5=Production)
    if (tvStatus) params.with_status = tvStatus;

    // Type (0=Documentary, 1=News, 2=Miniseries, 3=Reality, 4=Scripted, 5=Talk, 6=Video)
    if (tvType) params.with_type = tvType;
  }

  // People filters (cast, crew, or any person)
  // TMDB uses pipe (|) for OR logic
  if (withCast) params.with_cast = String(withCast).replace(/,/g, '|');
  if (withCrew) params.with_crew = String(withCrew).replace(/,/g, '|');
  if (withPeople) params.with_people = String(withPeople).replace(/,/g, '|');

  // Company filter
  if (withCompanies) params.with_companies = String(withCompanies).replace(/,/g, '|');
  if (excludeCompanies) params.without_companies = excludeCompanies;

  // Keyword filters
  if (withKeywords) {
    // TMDB uses pipe (|) for OR, comma (,) for AND. Default to OR.
    params.with_keywords = String(withKeywords).replace(/,/g, '|');
  }
  if (excludeKeywords) params.without_keywords = excludeKeywords;

  // Watch provider filters
  if (watchRegion && watchProviders.length > 0) {
    params.watch_region = watchRegion;
    params.with_watch_providers = watchProviders.join('|');
  }
  // Watch monetization type
  if (watchMonetizationType) {
    params.with_watch_monetization_types = watchMonetizationType;
  } else if (watchMonetizationTypes.length > 0) {
    params.with_watch_monetization_types = watchMonetizationTypes.join('|');
  }

  if (randomize) {
    const discoverResult = await tmdbFetch(endpoint, apiKey, { ...params, page: 1 });
    const maxPage = Math.min(discoverResult.total_pages || 1, 500);
    const randomPage = Math.floor(Math.random() * maxPage) + 1;

    const result = await tmdbFetch(endpoint, apiKey, { ...params, page: randomPage });
    if (result?.results) {
      result.results = shuffleArray(result.results);
    }
    return result;
  }

  return tmdbFetch(endpoint, apiKey, params);
}

/**
 * Fetch special lists (trending, now playing, upcoming, etc.)
 * These use dedicated TMDB endpoints instead of /discover
 */
export async function fetchSpecialList(apiKey, listType, type = 'movie', options = {}) {
  const { page = 1, language, displayLanguage, region } = options;
  const mediaType = type === 'series' ? 'tv' : 'movie';

  const params = { page };
  const languageParam = displayLanguage || language;
  if (languageParam) params.language = languageParam;
  if (region) params.region = region;

  let endpoint;

  switch (listType) {
    case 'trending_day':
      endpoint = `/trending/${mediaType}/day`;
      break;
    case 'trending_week':
      endpoint = `/trending/${mediaType}/week`;
      break;
    case 'now_playing':
      // Movies only
      endpoint = '/movie/now_playing';
      break;
    case 'upcoming':
      // Movies only
      endpoint = '/movie/upcoming';
      break;
    case 'airing_today':
      // TV only
      endpoint = '/tv/airing_today';
      break;
    case 'on_the_air':
      // TV only
      endpoint = '/tv/on_the_air';
      break;
    case 'top_rated':
      endpoint = `/${mediaType}/top_rated`;
      break;
    case 'popular':
      endpoint = `/${mediaType}/popular`;
      break;
    case 'random':
      return discover(apiKey, { type, page, ...options, randomize: true });
    default:
      break;
  }

  if (options.randomize) {
    const discoverResult = await tmdbFetch(endpoint, apiKey, { ...params, page: 1 });
    const maxPage = Math.min(discoverResult.total_pages || 1, 500);
    const randomPage = Math.floor(Math.random() * maxPage) + 1;

    const result = await tmdbFetch(endpoint, apiKey, { ...params, page: randomPage });
    if (result?.results) {
      result.results = shuffleArray(result.results);
    }
    return result;
  }

  return tmdbFetch(endpoint, apiKey, params);
}

/**
 * Get external IDs (including IMDB) for a movie or TV show
 */
export async function getExternalIds(apiKey, tmdbId, type = 'movie') {
  const mediaType = type === 'series' ? 'tv' : 'movie';
  const cacheKey = `external_ids_${mediaType}_${tmdbId}`;
  const cache = getCache();

  try {
    const cached = await cache.get(cacheKey);
    if (cached) return cached;
  } catch (e) {
    /* ignore */
  }

  try {
    const data = await tmdbFetch(`/${mediaType}/${tmdbId}/external_ids`, apiKey);
    try {
      await cache.set(cacheKey, data, 604800); // Cache for 7 days
    } catch (e) {
      /* ignore cache errors */
    }
    return data;
  } catch (error) {
    return null;
  }
}

/**
 * Enrich a list of TMDB items with their IMDb IDs.
 * Use concurrency (Promise.all) to fetch efficiently.
 * Relies on getExternalIds which handles caching.
 */
export async function enrichItemsWithImdbIds(apiKey, items, type = 'movie') {
  if (!items || !Array.isArray(items) || items.length === 0) return items;

  // Process in parallel
  // This might fire up to 20 requests at once.
  // Trusted TMDB keys usually handle this fine.
  await Promise.all(
    items.map(async (item) => {
      // If already has known ID, skip
      if (item.imdb_id) return;

      const ids = await getExternalIds(apiKey, item.id, type);
      if (ids?.imdb_id) {
        item.imdb_id = ids.imdb_id;
      }
    })
  );

  return items;
}

/**
 * Get detailed info for a movie or TV show
 */
export async function getDetails(apiKey, tmdbId, type = 'movie') {
  const mediaType = type === 'series' ? 'tv' : 'movie';
  // Allow localization via TMDB `language` parameter.
  // eslint-disable-next-line prefer-rest-params
  const maybeOptions = arguments.length >= 4 ? arguments[3] : undefined;
  const languageParam = maybeOptions?.displayLanguage || maybeOptions?.language;

  // Build params for the request
  const params = {
    append_to_response: 'external_ids,credits,videos,release_dates,content_ratings,images',
  };

  if (languageParam) {
    params.language = languageParam;

    // Include videos in target language + English fallback
    params.include_video_language = `${languageParam},en,null`;
  } else {
    // Default to English videos if no language specified
    params.include_video_language = 'en,null';
  }

  return tmdbFetch(`/${mediaType}/${tmdbId}`, apiKey, params);
}

/**
 * Get season details including episodes
 * @param {string} apiKey - TMDB API key
 * @param {number} tmdbId - TMDB TV show ID
 * @param {number} seasonNumber - Season number
 * @param {Object} options - Optional parameters
 * @returns {Object} Season details with episodes
 */
export async function getSeasonDetails(apiKey, tmdbId, seasonNumber, options = {}) {
  const languageParam = options?.displayLanguage || options?.language;
  const cacheKey = `season_${tmdbId}_${seasonNumber}_${languageParam || 'en'}`;
  const cache = getCache();

  try {
    const cached = await cache.get(cacheKey);
    if (cached) return cached;
  } catch (e) {
    /* ignore */
  }

  const params = {};
  if (languageParam) params.language = languageParam;

  try {
    const data = await tmdbFetch(`/tv/${tmdbId}/season/${seasonNumber}`, apiKey, params);
    try {
      await cache.set(cacheKey, data, 86400); // Cache for 24 hours
    } catch (e) {
      /* ignore cache errors */
    }
    return data;
  } catch (error) {
    log.warn('Failed to fetch season details', { tmdbId, seasonNumber, error: error.message });
    return null;
  }
}

/**
 * Get all episodes for a TV series
 * @param {string} apiKey - TMDB API key
 * @param {number} tmdbId - TMDB TV show ID
 * @param {Object} details - TV show details (must include seasons array)
 * @param {Object} options - Optional parameters
 * @returns {Array} Array of Stremio Video objects
 */
export async function getSeriesEpisodes(apiKey, tmdbId, details, options = {}) {
  if (!details?.seasons || !Array.isArray(details.seasons)) {
    return [];
  }

  const imdbId = details?.external_ids?.imdb_id || null;
  const videos = [];

  // Filter out specials (season 0) and get regular seasons
  const regularSeasons = details.seasons.filter((s) => s.season_number > 0);

  // Fetch all seasons in parallel (with reasonable limit)
  const seasonPromises = regularSeasons.slice(0, 50).map(async (season) => {
    const seasonData = await getSeasonDetails(apiKey, tmdbId, season.season_number, options);
    if (!seasonData?.episodes) return [];

    return seasonData.episodes.map((ep) => {
      // Build episode ID: prefer IMDb format for Cinemeta/stream compatibility
      const episodeId = imdbId
        ? `${imdbId}:${ep.season_number}:${ep.episode_number}`
        : `tmdb:${tmdbId}:${ep.season_number}:${ep.episode_number}`;

      return {
        id: episodeId,
        season: ep.season_number,
        episode: ep.episode_number,
        title: ep.name || `Episode ${ep.episode_number}`,
        released: ep.air_date ? new Date(ep.air_date).toISOString() : undefined,
        overview: ep.overview || undefined,
        thumbnail: ep.still_path ? `${TMDB_IMAGE_BASE}/w500${ep.still_path}` : undefined,
        runtime: formatRuntime(ep.runtime),
      };
    });
  });

  const seasonResults = await Promise.all(seasonPromises);

  // Flatten and sort by season/episode
  for (const episodes of seasonResults) {
    videos.push(...episodes);
  }

  videos.sort((a, b) => {
    if (a.season !== b.season) return a.season - b.season;
    return a.episode - b.episode;
  });

  return videos;
}

/**
 * Format minutes into "2h47min" or "58min"
 * @param {number|null} minutes
 * @returns {string|undefined}
 */
export function formatRuntime(minutes) {
  if (!minutes) return undefined;
  if (minutes < 60) return `${minutes}min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h${m}min` : `${h}h`;
}

/**
 * Generate a Stremio-style slug
 * @param {string} type
 * @param {string} title
 * @param {string} id
 * @returns {string}
 */
export function generateSlug(type, title, id) {
  const safeTitle = (title || '').toLowerCase().replace(/ /g, '-');
  return `${type}/${safeTitle}-${id}`;
}

/**
 * Convert TMDB details to a full Stremio Meta Object.
 * @param {Object} details - TMDB details object
 * @param {string} type - Content type ('movie' or 'series')
 * @param {string|null} requestedId - The ID originally requested by Stremio
 * @param {Object|null} posterOptions - Optional poster service config { apiKey, service }
 * @param {Array|null} videos - Optional array of Video objects for series episodes
 * @returns {Object} Stremio meta object
 */
export async function toStremioFullMeta(
  details,
  type,
  imdbId = null,
  requestedId = null,
  posterOptions = null,
  videos = null,
  targetLanguage = null
) {
  if (!details) return {};
  const isMovie = type === 'movie';
  const title = isMovie ? details.title : details.name;
  const releaseDate = isMovie ? details.release_date : details.first_air_date;
  const year = releaseDate ? String(releaseDate).split('-')[0] : '';

  const genres = Array.isArray(details.genres)
    ? details.genres.map((g) => g?.name).filter(Boolean)
    : [];

  // Credits (best-effort; Stremio warns these may be deprecated but still supported)
  const credits = details.credits || {};
  const cast = Array.isArray(credits.cast)
    ? credits.cast
      .slice(0, 20)
      .map((p) => p?.name)
      .filter(Boolean)
    : [];

  const crew = Array.isArray(credits.crew) ? credits.crew : [];
  const directors = crew
    .filter((p) => p?.job === 'Director')
    .map((p) => p?.name)
    .filter(Boolean);

  // Runtime: movie.runtime (minutes) or tv.episode_run_time (array)
  let runtimeMin = null;
  if (isMovie && typeof details.runtime === 'number') runtimeMin = details.runtime;
  if (!isMovie && Array.isArray(details.episode_run_time) && details.episode_run_time.length > 0) {
    const first = details.episode_run_time.find((v) => typeof v === 'number');
    if (typeof first === 'number') runtimeMin = first;
  }

  const effectiveImdbId = imdbId || details?.external_ids?.imdb_id || null;
  const status = details.status || null;

  // Age Rating / Certification
  let certification = null;
  if (isMovie && details.release_dates?.results) {
    const usInfo = details.release_dates.results.find((r) => r.iso_3166_1 === 'US');
    if (usInfo?.release_dates?.length > 0) {
      // Find optimal rating (theatrical preferred)
      const rated = usInfo.release_dates.find((d) => d.certification) || usInfo.release_dates[0];
      if (rated?.certification) certification = rated.certification;
    }
  } else if (!isMovie && details.content_ratings?.results) {
    const usInfo = details.content_ratings.results.find((r) => r.iso_3166_1 === 'US');
    if (usInfo?.rating) certification = usInfo.rating;
  }

  // Format Release Info (Year + Rating)
  let releaseInfo = year;
  if (
    !isMovie &&
    (status === 'Returning Series' || status === 'In Production' || !details.last_air_date)
  ) {
    releaseInfo = `${year}-`;
  }

  if (certification) {
    releaseInfo = releaseInfo ? `${releaseInfo} • ${certification}` : certification;
  } else if (status && isMovie) {
    // For series we usually prefer the year range or year- format
    releaseInfo = releaseInfo ? `${releaseInfo} • ${status}` : status;
  }

  // Trailer
  let trailer = null;
  if (details.videos?.results?.length > 0) {
    const allVideos = details.videos.results.filter((v) => v.site === 'YouTube');

    // Prioritize: 
    // 1. Language match + Trailer
    // 2. Language match + Teaser/Clip
    // 3. English + Trailer
    // 4. Any Trailer

    const lang = targetLanguage || 'en';

    const trailerVideo =
      allVideos.find(v => v.iso_639_1 === lang && v.type === 'Trailer') ||
      allVideos.find(v => v.iso_639_1 === lang) ||
      allVideos.find(v => v.iso_639_1 === 'en' && v.type === 'Trailer') ||
      allVideos.find(v => v.type === 'Trailer') ||
      allVideos[0];

    if (trailerVideo) {
      trailer = `yt:${trailerVideo.key}`;
    }
  }

  // Links
  const links = [];

  // Try to get real IMDb rating if configured
  let displayRating =
    typeof details.vote_average === 'number' ? details.vote_average.toFixed(1) : null;
  const rpdbKey =
    posterOptions?.service === 'rpdb' && posterOptions.apiKey
      ? posterOptions.apiKey
      : process.env.RPDB_API_KEY;

  // Make sure we have an IMDb ID before trying
  let actualImdbRating = null;
  if (effectiveImdbId && rpdbKey) {
    try {
      const realRating = await getRpdbRating(rpdbKey, effectiveImdbId);
      if (realRating && realRating !== 'N/A') {
        displayRating = realRating;
        actualImdbRating = realRating;
      }
    } catch (e) { }
  }

  if (effectiveImdbId) {
    links.push({
      name: displayRating || 'IMDb',
      category: 'imdb',
      url: `https://www.imdb.com/title/${effectiveImdbId}/`,
    });
  }

  // Genre Links
  genres.forEach((genre) => {
    links.push({
      name: genre,
      category: 'Genres',
      url: `stremio:///search?search=${encodeURIComponent(genre)}`,
    });
  });

  // Cast Links
  cast.slice(0, 5).forEach((name) => {
    links.push({
      name: name,
      category: 'Cast',
      url: `stremio:///search?search=${encodeURIComponent(name)}`,
    });
  });

  // Director Links
  directors.forEach((name) => {
    links.push({
      name: name,
      category: 'Directors',
      url: `stremio:///search?search=${encodeURIComponent(name)}`,
    });
  });

  // Crew strings
  const writers = crew.filter((p) => ['Writer', 'Screenplay', 'Author'].includes(p.job));
  const writerNames = writers.map((p) => p.name);
  const writerString = writerNames.join(', ');
  const directorString = directors.join(', ');

  // Writer Links
  writerNames.forEach((name) => {
    links.push({
      name: name,
      category: 'Writers',
      url: `stremio:///search?search=${encodeURIComponent(name)}`,
    });
  });

  // Share Link
  const slugTitle = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  links.push({
    name: title,
    category: 'share',
    url: `https://www.strem.io/s/${type}/${slugTitle}-${details.id}`,
  });

  // Trailer Streams
  const trailerStreams = [];
  if (details.videos?.results) {
    details.videos.results
      .filter((v) => v.site === 'YouTube' && v.type === 'Trailer')
      .forEach((v) => {
        trailerStreams.push({
          title: v.name,
          ytId: v.key,
          lang: v.iso_639_1 || 'en',
        });
      });
  }

  // app_extras
  const app_extras = {
    cast: Array.isArray(credits.cast)
      ? credits.cast.slice(0, 15).map((p) => ({
        name: p.name,
        character: p.character,
        photo: p.profile_path ? `${TMDB_IMAGE_BASE}/w276_and_h350_face${p.profile_path}` : null,
      }))
      : [],
    directors: crew
      .filter((p) => p.job === 'Director')
      .map((p) => ({
        name: p.name,
        photo: p.profile_path ? `${TMDB_IMAGE_BASE}/w185${p.profile_path}` : null,
      })),
    writers: writers.map((p) => ({
      name: p.name,
      photo: p.profile_path ? `${TMDB_IMAGE_BASE}/w185${p.profile_path}` : null,
    })),
    seasonPosters: Array.isArray(details.seasons)
      ? details.seasons
        .map((s) => (s.poster_path ? `${TMDB_IMAGE_BASE}/w500${s.poster_path}` : null))
        .filter(Boolean)
      : [],
    releaseDates: details.release_dates || details.content_ratings || null,
    certification: certification,
  };

  /* behaviorHints */
  const behaviorHints = {
    defaultVideoId: isMovie ? effectiveImdbId || `tmdb:${details.id}` : null,
    hasScheduledVideos: !isMovie && (status === 'Returning Series' || status === 'In Production'),
  };

  // Generate poster URL (use poster service if configured, fallback to TMDB)
  let poster = details.poster_path ? `${TMDB_IMAGE_BASE}/w500${details.poster_path}` : null;
  let background = details.backdrop_path
    ? `${TMDB_IMAGE_BASE}/w1280${details.backdrop_path}`
    : null;

  if (isValidPosterConfig(posterOptions)) {
    const enhancedPoster = generatePosterUrl({
      ...posterOptions,
      tmdbId: details.id,
      type,
      imdbId: effectiveImdbId,
    });
    if (enhancedPoster) poster = enhancedPoster;

    // Backgrounds: Always use TMDB original backdrops. RPDB backgrounds are often low res or broken.
    // const enhancedBackdrop = generateBackdropUrl({ ... });
    // if (enhancedBackdrop) background = enhancedBackdrop;
  }

  // Logo selection: Prioritize Target Lang > English > Null > Any
  // We need to resort because the API might have returned a mix
  let logo = null;
  if (details.images?.logos?.length > 0) {
    const logos = details.images.logos;
    const target = targetLanguage || 'en';

    const candidates = [
      logos.find(l => l.iso_639_1 === target),
      logos.find(l => l.iso_639_1 === 'en'),
      logos.find(l => l.iso_639_1 === null), // Textless/Logo-only
      logos[0] // Fallback to first available (e.g. original language)
    ];

    const best = candidates.find(Boolean);
    if (best) logo = best.file_path;
  }

  // Fallbacks for Poster/Backdrop if main path is missing
  if (!poster && details.images?.posters?.length > 0) {
    poster = `${TMDB_IMAGE_BASE}/w500${details.images.posters[0].file_path}`;
  }
  if (!background && details.images?.backdrops?.length > 0) {
    background = `${TMDB_IMAGE_BASE}/w1280${details.images.backdrops[0].file_path}`;
  }

  const responseId = requestedId || `tmdb:${details.id}`;

  const meta = {
    id: responseId,
    tmdbId: details.id,
    imdbId: effectiveImdbId,
    imdb_id: effectiveImdbId,
    type: type === 'series' ? 'series' : 'movie',
    name: title,
    slug: generateSlug(
      type === 'series' ? 'series' : 'movie',
      title,
      effectiveImdbId || `tmdb:${details.id}`
    ),
    poster,
    posterShape: 'poster',
    background,
    fanart: background, // Compatibility alias
    logo: logo ? `${TMDB_IMAGE_BASE}/w300${logo}` : undefined,
    description: details.overview || '',
    year: year || undefined,
    releaseInfo,
    // Use actual IMDB rating from RPDB if available, fallback to TMDB vote_average
    imdbRating:
      actualImdbRating ||
      (typeof details.vote_average === 'number' ? details.vote_average.toFixed(1) : null),
    genres,
    cast: cast.length > 0 ? cast : undefined,
    director: directorString || undefined,
    writer: writerString || undefined,
    runtime: formatRuntime(runtimeMin),
    language: details.original_language || undefined,
    country: Array.isArray(details.origin_country) ? details.origin_country.join(', ') : undefined,
    released: releaseDate ? new Date(releaseDate).toISOString() : undefined,
    links: links.length > 0 ? links : undefined,
    trailer: trailer || undefined,
    trailerStreams: trailerStreams.length > 0 ? trailerStreams : undefined,
    app_extras,
    behaviorHints,
    status: status || undefined,
  };

  // Add videos (episodes) for series
  if (!isMovie && Array.isArray(videos) && videos.length > 0) {
    meta.videos = videos;
  }

  return meta;
}

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
 * Convert TMDB result to Stremio meta preview format
 * @param {Object} item - TMDB item object
 * @param {string} type - Content type ('movie' or 'series')
 * @param {string|null} imdbId - IMDb ID if available
 * @param {Object|null} posterOptions - Optional poster service config { apiKey, service }
 * @param {Object|null} genreMap - Optional map of ID -> Name for localized genres
 * @returns {Object} Stremio meta preview object
 */


/**
 * Convert TMDB result to Stremio meta preview format
 * @param {Object} item - TMDB item object
 * @param {string} type - Content type ('movie' or 'series')
 * @param {string|null} imdbId - IMDb ID if available
 * @param {Object|null} posterOptions - Optional poster service config { apiKey, service }
 * @param {Object|null} genreMap - Optional map of ID -> Name for localized genres
 * @returns {Object} Stremio meta preview object
 */
export function toStremioMeta(item, type, imdbId = null, posterOptions = null, genreMap = null) {
  const isMovie = type === 'movie';
  const title = isMovie ? item.title : item.name;
  const releaseDate = isMovie ? item.release_date : item.first_air_date;
  const year = releaseDate ? releaseDate.split('-')[0] : '';

  const mappedGenres = [];
  const ids = item.genre_ids || item.genres?.map((g) => g.id) || [];
  const mediaKey = isMovie ? 'movie' : 'tv';

  const cachedList = genreCache[mediaKey]?.['en']; // Default fallback
  const staticList = staticGenreMap[mediaKey] || {};

  ids.forEach((id) => {
    const key = String(id);
    let name = null;

    // 1. Try provided localized map first
    if (genreMap && genreMap[key]) {
      name = genreMap[key];
    }

    // 2. Try cached English list
    if (!name && cachedList) {
      const hit = cachedList.find((g) => String(g.id) === key);
      if (hit) name = hit.name;
    }

    // 3. Try static fallback
    if (!name && staticList[key]) name = staticList[key];

    if (name) mappedGenres.push(name);
  });

  // Generate poster URL (use poster service if configured, fallback to TMDB)
  let poster = item.poster_path ? `${TMDB_IMAGE_BASE}/w500${item.poster_path}` : null;
  let background = item.backdrop_path ? `${TMDB_IMAGE_BASE}/w1280${item.backdrop_path}` : null;

  if (isValidPosterConfig(posterOptions)) {
    const enhancedPoster = generatePosterUrl({
      ...posterOptions,
      tmdbId: item.id,
      type,
      imdbId,
    });
    if (enhancedPoster) poster = enhancedPoster;

    // Backgrounds: Always use TMDB original backdrops.
    // const enhancedBackdrop = generateBackdropUrl({ ... });
    // if (enhancedBackdrop) background = enhancedBackdrop;
  }

  const effectiveImdbId = imdbId || item.imdb_id || null;
  const primaryId = effectiveImdbId || `tmdb:${item.id}`;

  const meta = {
    id: primaryId,
    tmdbId: item.id,
    imdbId: effectiveImdbId,
    imdb_id: effectiveImdbId, // Some addons/clients expect this format
    type: type === 'series' ? 'series' : 'movie',
    name: title,
    poster,
    posterShape: 'poster',
    background,
    fanart: background, // Compatibility alias
    description: item.overview || '',
    releaseInfo: year,
    imdbRating: typeof item.vote_average === 'number' ? item.vote_average.toFixed(1) : null,
    genres: mappedGenres,
    behaviorHints: {},
  };

  return meta;
}

/**
 * Find TMDB item by IMDb ID
 */
export async function findByImdbId(apiKey, imdbId, type = 'movie', options = {}) {
  const cacheKey = `find_${imdbId}`;
  const cache = getCache();

  try {
    const cached = await cache.get(cacheKey);
    if (cached) return cached;
  } catch (e) {
    /* ignore */
  }

  const params = { external_source: 'imdb_id' };
  if (options.language) params.language = options.language;

  try {
    const data = await tmdbFetch(`/find/${imdbId}`, apiKey, params);
    let result = null;

    if (type === 'movie' && data.movie_results?.length > 0) {
      result = data.movie_results[0];
    } else if ((type === 'series' || type === 'tv') && data.tv_results?.length > 0) {
      result = data.tv_results[0];
    }

    if (result) {
      const found = { tmdbId: result.id };
      try {
        await cache.set(cacheKey, found, 86400 * 7); // 7 days
      } catch (e) { }
      return found;
    }
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Validate TMDB API key
 */
export async function validateApiKey(apiKey) {
  try {
    await tmdbFetch('/configuration', apiKey);
    return { valid: true };
  } catch (error) {
    return { valid: false, error: error.message };
  }
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

/**
 * Get TV networks list
 */
export async function getNetworks(apiKey, query) {
  const q = String(query || '').trim();
  if (!apiKey || !q) return [];
  return getNetworksViaWebsite(q);
}

/**
 * Special list types (non-discover endpoints)
 * These use dedicated TMDB endpoints instead of /discover
 */
export const LIST_TYPES = {
  movie: [
    { value: 'discover', label: '🔍 Custom Discover', description: 'Use filters below' },
    { value: 'trending_day', label: '🔥 Trending Today', description: 'Movies trending today' },
    {
      value: 'trending_week',
      label: '📈 Trending This Week',
      description: 'Movies trending this week',
    },
    { value: 'now_playing', label: '🎬 Now Playing', description: 'Currently in theaters' },
    { value: 'upcoming', label: '📅 Upcoming', description: 'Coming soon to theaters' },
    { value: 'top_rated', label: '⭐ Top Rated', description: 'All-time highest rated' },
    { value: 'popular', label: '🌟 Popular', description: 'Currently popular movies' },
  ],
  series: [
    { value: 'discover', label: '🔍 Custom Discover', description: 'Use filters below' },
    { value: 'trending_day', label: '🔥 Trending Today', description: 'TV shows trending today' },
    {
      value: 'trending_week',
      label: '📈 Trending This Week',
      description: 'TV shows trending this week',
    },
    { value: 'airing_today', label: '📺 Airing Today', description: 'Episodes airing today' },
    { value: 'on_the_air', label: '📡 On The Air', description: 'Currently airing shows' },
    { value: 'top_rated', label: '⭐ Top Rated', description: 'All-time highest rated' },
    { value: 'popular', label: '🌟 Popular', description: 'Currently popular shows' },
  ],
};

// Pre-built catalog presets (excludes 'discover' which is the default)
export const PRESET_CATALOGS = {
  movie: [
    { value: 'trending_day', label: '🔥 Trending Today', description: 'Movies trending today' },
    {
      value: 'trending_week',
      label: '📈 Trending This Week',
      description: 'Movies trending this week',
    },
    { value: 'now_playing', label: '🎬 Now Playing', description: 'Currently in theaters' },
    { value: 'upcoming', label: '📅 Upcoming', description: 'Coming soon to theaters' },
    { value: 'top_rated', label: '⭐ Top Rated', description: 'All-time highest rated' },
    { value: 'popular', label: '🌟 Popular', description: 'Currently popular movies' },
  ],
  series: [
    { value: 'trending_day', label: '🔥 Trending Today', description: 'TV shows trending today' },
    {
      value: 'trending_week',
      label: '📈 Trending This Week',
      description: 'TV shows trending this week',
    },
    { value: 'airing_today', label: '📺 Airing Today', description: 'Episodes airing today' },
    { value: 'on_the_air', label: '📡 On The Air', description: 'Currently airing shows' },
    { value: 'top_rated', label: '⭐ Top Rated', description: 'All-time highest rated' },
    { value: 'popular', label: '🌟 Popular', description: 'Currently popular shows' },
  ],
};

/**
 * Sort options for discover - separated by content type
 * Movies and TV have different available sort options
 */
export const SORT_OPTIONS = {
  movie: [
    // Popularity
    { value: 'popularity.desc', label: 'Most Popular' },
    { value: 'popularity.asc', label: 'Least Popular' },
    // Ratings
    { value: 'vote_average.desc', label: 'Highest Rated' },
    { value: 'vote_average.asc', label: 'Lowest Rated' },
    { value: 'vote_count.desc', label: 'Most Votes' },
    { value: 'vote_count.asc', label: 'Least Votes' },
    // Release Date
    { value: 'primary_release_date.desc', label: 'Newest Releases' },
    { value: 'primary_release_date.asc', label: 'Oldest Releases' },
    { value: 'release_date.desc', label: 'Release Date (Newest)' },
    { value: 'release_date.asc', label: 'Release Date (Oldest)' },
    // Revenue
    { value: 'revenue.desc', label: 'Highest Revenue' },
    { value: 'revenue.asc', label: 'Lowest Revenue' },
    // Title
    { value: 'original_title.asc', label: 'Title A → Z' },
    { value: 'original_title.desc', label: 'Title Z → A' },
    { value: 'title.asc', label: 'Localized Title A → Z' },
    { value: 'title.desc', label: 'Localized Title Z → A' },
  ],
  series: [
    // Popularity
    { value: 'popularity.desc', label: 'Most Popular' },
    { value: 'popularity.asc', label: 'Least Popular' },
    // Ratings
    { value: 'vote_average.desc', label: 'Highest Rated' },
    { value: 'vote_average.asc', label: 'Lowest Rated' },
    { value: 'vote_count.desc', label: 'Most Votes' },
    { value: 'vote_count.asc', label: 'Least Votes' },
    // Air Date
    { value: 'first_air_date.desc', label: 'Newest First Aired' },
    { value: 'first_air_date.asc', label: 'Oldest First Aired' },
    // Name/Title
    { value: 'original_name.asc', label: 'Name A → Z' },
    { value: 'original_name.desc', label: 'Name Z → A' },
    { value: 'name.asc', label: 'Localized Name A → Z' },
    { value: 'name.desc', label: 'Localized Name Z → A' },
  ],
};

/**
 * Movie release types
 */
export const RELEASE_TYPES = [
  { value: 1, label: 'Premiere' },
  { value: 2, label: 'Limited Theatrical' },
  { value: 3, label: 'Theatrical' },
  { value: 4, label: 'Digital' },
  { value: 5, label: 'Physical' },
  { value: 6, label: 'TV' },
];

/**
 * TV show statuses
 */
export const TV_STATUSES = [
  { value: '0', label: 'Returning Series' },
  { value: '1', label: 'Planned' },
  { value: '2', label: 'In Production' },
  { value: '3', label: 'Ended' },
  { value: '4', label: 'Cancelled' },
  { value: '5', label: 'Pilot' },
];

/**
 * TV show types
 */
export const TV_TYPES = [
  { value: '0', label: 'Documentary' },
  { value: '1', label: 'News' },
  { value: '2', label: 'Miniseries' },
  { value: '3', label: 'Reality' },
  { value: '4', label: 'Scripted' },
  { value: '5', label: 'Talk Show' },
  { value: '6', label: 'Video' },
];

/**
 * Watch monetization types
 */
export const MONETIZATION_TYPES = [
  { value: 'flatrate', label: 'Subscription (Netflix, Prime, etc.)' },
  { value: 'free', label: 'Free' },
  { value: 'ads', label: 'Free with Ads' },
  { value: 'rent', label: 'Rent' },
  { value: 'buy', label: 'Buy' },
];

/**
 * Popular TV Networks (curated list with TMDB IDs)
 */
export const TV_NETWORKS = [
  // Streaming
  { id: 213, name: 'Netflix', logo: '/wwemzKWzjKYJFfCeiB57q3r4Bcm.png' },
  { id: 1024, name: 'Amazon', logo: '/ifhbNuuVnlwYy5oXA5VIb2YR8AZ.png' },
  { id: 2739, name: 'Disney+', logo: '/gJ8VX6JSu3ciXHuC2dDGAo2lvwM.png' },
  { id: 2552, name: 'Apple TV+', logo: '/4KAy34EHvRM25Ih8wb82AuGU7zJ.png' },
  { id: 453, name: 'Hulu', logo: '/pqUTCleNUiTLAVlelGxUgWn1ELh.png' },
  { id: 3186, name: 'HBO Max', logo: '/aAb3CiOzSlBLMuIOVSGIrPC0fLF.png' },
  { id: 49, name: 'HBO', logo: '/tuomPhY2UtuPTqqFnKMVHvSb724.png' },
  { id: 2697, name: 'Paramount+', logo: '/xbhHHa1YgtpwhC8lb1NQ3ACVcLd.png' },
  { id: 4330, name: 'Peacock', logo: '/qlqLhLJoOlBpO6OFbDjpP3CrH01.png' },
  { id: 3353, name: 'Discovery+', logo: '/yxhnqf5i8I00lJkqNNj5JuHHqZ1.png' },
  { id: 6703, name: 'Zee5', logo: '/l1NkV8Q1XPvDnKwLpRe9LNXjpEg.png' },
  { id: 3930, name: 'JioCinema', logo: '/l1NkV8Q1XPvDnKwLpRe9LNXjpEg.png' },
  { id: 232, name: 'SonyLIV', logo: '/l1NkV8Q1XPvDnKwLpRe9LNXjpEg.png' },
  { id: 3279, name: 'Voot', logo: '/l1NkV8Q1XPvDnKwLpRe9LNXjpEg.png' },
  { id: 119, name: 'Amazon Prime Video', logo: '/ifhbNuuVnlwYy5oXA5VIb2YR8AZ.png' },
  // US Broadcast
  { id: 6, name: 'NBC', logo: '/o3OedEP0f9mfZr33jz2BfXOUK5.png' },
  { id: 2, name: 'ABC', logo: '/ndAvF4JLsliGreX87jAc9GdjmJY.png' },
  { id: 16, name: 'CBS', logo: '/nm8d7P7MJNiBLdgIzUK0gkuEA4r.png' },
  { id: 19, name: 'FOX', logo: '/1DSpHrWyOORkL9N2QHX7Adt31mQ.png' },
  { id: 71, name: 'The CW', logo: '/ge9hzeaU7nMtQ4PjkFlc68dGAJ9.png' },
  // Cable US
  { id: 174, name: 'AMC', logo: '/alqLicR1ZMHMaZGP3xRQxn9S7Oc.png' },
  { id: 67, name: 'Showtime', logo: '/Allse9kbjiP6ExaQrnSpIhkurEi.png' },
  { id: 318, name: 'Starz', logo: '/8GJjw3HHsAJYwIWKIPBPfqMxlEa.png' },
  { id: 29, name: 'USA Network', logo: '/g1e0H0Ka97IG5SaIx6kgiKzLFXA.png' },
  { id: 34, name: 'FX', logo: '/aexGjtcs42DgRtZh7zOxayiry4J.png' },
  { id: 54, name: 'History', logo: '/kxCeDqSFZyUMJg6VN5LBJWmPqb7.png' },
  { id: 64, name: 'Discovery', logo: '/og0TiNsq4y3F1UJqJJ3bWpvVzxs.png' },
  { id: 43, name: 'National Geographic', logo: '/q8uLFDz0PFm41X8SxPvXk8ED1Cd.png' },
  // UK
  { id: 4, name: 'BBC One', logo: '/mVn7xESaTNmjBUyUtGNvDQd3CT1.png' },
  { id: 332, name: 'BBC Two', logo: '/gaKcBUdBcbH7NxwMbRmVdRCJxSG.png' },
  { id: 26, name: 'Channel 4', logo: '/6ooPjtXufjsoskdJqj6pxuvHEno.png' },
  { id: 9, name: 'ITV', logo: '/ixVMBbREzK5tNsZqMNYIJ6Llp9M.png' },
  { id: 493, name: 'Sky Atlantic', logo: '/q2bwTL9OOlvSY3Ll4xjd6ADdMRH.png' },
  // India
  { id: 231, name: 'Star Plus', logo: '/l1NkV8Q1XPvDnKwLpRe9LNXjpEg.png' },
  { id: 232, name: 'Sony Entertainment Television', logo: '/l1NkV8Q1XPvDnKwLpRe9LNXjpEg.png' },
  { id: 237, name: 'Colors', logo: '/l1NkV8Q1XPvDnKwLpRe9LNXjpEg.png' },
  { id: 234, name: 'Zee TV', logo: '/l1NkV8Q1XPvDnKwLpRe9LNXjpEg.png' },
  { id: 3279, name: 'Hotstar', logo: '/l1NkV8Q1XPvDnKwLpRe9LNXjpEg.png' },
  // Others
  { id: 1, name: 'Fuji TV', logo: '/l1NkV8Q1XPvDnKwLpRe9LNXjpEg.png' },
  { id: 173, name: 'AT-X', logo: '/l1NkV8Q1XPvDnKwLpRe9LNXjpEg.png' },
  { id: 98, name: 'TV Tokyo', logo: '/l1NkV8Q1XPvDnKwLpRe9LNXjpEg.png' },
  { id: 614, name: 'Crunchyroll', logo: '/l1NkV8Q1XPvDnKwLpRe9LNXjpEg.png' },
];
