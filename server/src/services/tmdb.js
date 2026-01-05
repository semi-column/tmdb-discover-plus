import NodeCache from 'node-cache';
import fetch from 'node-fetch';
import https from 'node:https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { shuffleArray } from '../utils/helpers.js';
import { createLogger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = createLogger('tmdb');

// Allow disabling TLS verification via env var (for corporate proxies)
// WARNING: Only enable this if absolutely necessary, as it weakens security
const httpsAgent = new https.Agent({
  rejectUnauthorized: process.env.DISABLE_TLS_VERIFY !== 'true'
});

const cache = new NodeCache({ 
  stdTTL: 3600,  // 1 hour default TTL
  checkperiod: 600 // Check for expired keys every 10 min
});

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

// Genre mappings (will be populated from API)
let genreCache = { movie: null, tv: null };

// Load static fallback genre mapping from JSON
let staticGenreMap = { movie: {}, tv: {} };
  try {
    // Resolve path relative to this module so it works regardless of CWD
    const genresPath = path.join(__dirname, 'tmdb_genres.json');
    const raw = fs.readFileSync(genresPath, 'utf8');
    staticGenreMap = JSON.parse(raw);
  } catch (err) {
    log.warn('Could not load static TMDB genre mapping', { error: err.message });
  }

/**
 * Make a request to TMDB API
 */
async function tmdbFetch(endpoint, apiKey, params = {}) {
  const url = new URL(`${TMDB_BASE_URL}${endpoint}`);
  url.searchParams.set('api_key', apiKey);
  
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  });

  const cacheKey = url.toString();
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    // Optional debug logging of full TMDB request URL
    if (process.env.DEBUG_TMDB === '1') {
      log.debug('TMDB request', { url: url.toString() });
    }

    const response = await fetch(url.toString(), { agent: httpsAgent });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.status_message || `TMDB API error: ${response.status}`);
    }

    const data = await response.json();
    cache.set(cacheKey, data);
    return data;
  } catch (error) {
    log.error('TMDB fetch error', { error: error.message });
    throw error;
  }
}

/**
 * Get genre list for movies or TV
 */
export async function getGenres(apiKey, type = 'movie') {
  const mediaType = type === 'series' ? 'tv' : 'movie';
  
  if (genreCache[mediaType]) {
    return genreCache[mediaType];
  }

  const data = await tmdbFetch(`/genre/${mediaType}/list`, apiKey);
  genreCache[mediaType] = data.genres;
  return data.genres;
}

// Expose cached genres accessor for other modules (may be null if not yet fetched)
export function getCachedGenres(type = 'movie') {
  const mediaType = type === 'series' ? 'tv' : 'movie';
  return genreCache[mediaType] || null;
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
    originCountry,
    includeAdult = false,
    voteCountMin = 100,
    page = 1,
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

  // Genres: use pipe-separated list to request OR semantics from TMDB
  // (TMDB accepts comma for AND, pipe '|' for OR)
  if (genres.length > 0) {
    params.with_genres = genres.join('|');
  }
  if (excludeGenres.length > 0) {
    params.without_genres = excludeGenres.join(',');
  }

  // Year filters (legacy - uses date filters internally)
  if (mediaType === 'movie') {
    if (yearFrom && !releaseDateFrom) params['primary_release_date.gte'] = `${yearFrom}-01-01`;
    if (yearTo && !releaseDateTo) params['primary_release_date.lte'] = `${yearTo}-12-31`;
  } else {
    if (yearFrom && !airDateFrom) params['first_air_date.gte'] = `${yearFrom}-01-01`;
    if (yearTo && !airDateTo) params['first_air_date.lte'] = `${yearTo}-12-31`;
  }

  // Rating filters
  if (ratingMin) params['vote_average.gte'] = ratingMin;
  if (ratingMax) params['vote_average.lte'] = ratingMax;

  // Language filter
  if (language) params.with_original_language = language;

  // Origin country
  if (originCountry) params.with_origin_country = originCountry;

  // Runtime filters
  if (runtimeMin) params['with_runtime.gte'] = runtimeMin;
  if (runtimeMax) params['with_runtime.lte'] = runtimeMax;

  // Movie-specific filters
  if (mediaType === 'movie') {
    // Region for regional release dates
    if (region) params.region = region;
    
    // Release date filters
    if (releaseDateFrom) params['primary_release_date.gte'] = releaseDateFrom;
    if (releaseDateTo) params['primary_release_date.lte'] = releaseDateTo;
    
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
  if (withCast) params.with_cast = withCast;
  if (withCrew) params.with_crew = withCrew;
  if (withPeople) params.with_people = withPeople;

  // Company filter
  if (withCompanies) params.with_companies = withCompanies;
  if (excludeCompanies) params.without_companies = excludeCompanies;

  // Keyword filters
  if (withKeywords) params.with_keywords = withKeywords;
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

  return tmdbFetch(endpoint, apiKey, params);
}

/**
 * Fetch special lists (trending, now playing, upcoming, etc.)
 * These use dedicated TMDB endpoints instead of /discover
 */
export async function fetchSpecialList(apiKey, listType, type = 'movie', options = {}) {
  const { page = 1, language, region } = options;
  const mediaType = type === 'series' ? 'tv' : 'movie';
  
  const params = { page };
  if (language) params.language = language;
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
      // Random: fetch from a random page (1-500, TMDB's max)
      // We'll get total_pages first from a discover query, then pick random
      const discoverResult = await discover(apiKey, { type, page: 1, ...options });
      const maxPage = Math.min(discoverResult.total_pages || 1, 500);
      const randomPage = Math.floor(Math.random() * maxPage) + 1;
      const randomResult = await discover(apiKey, { type, page: randomPage, ...options });
      // Shuffle the results
      randomResult.results = shuffleArray(randomResult.results || []);
      return randomResult;
    default:
      // Fallback to discover
      return discover(apiKey, { type, page, ...options });
  }

  return tmdbFetch(endpoint, apiKey, params);
}

/**
 * Get external IDs (including IMDB) for a movie or TV show
 */
export async function getExternalIds(apiKey, tmdbId, type = 'movie') {
  const mediaType = type === 'series' ? 'tv' : 'movie';
  const cacheKey = `external_ids_${mediaType}_${tmdbId}`;
  
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const data = await tmdbFetch(`/${mediaType}/${tmdbId}/external_ids`, apiKey);
    cache.set(cacheKey, data, 86400); // Cache for 24 hours
    return data;
  } catch (error) {
    return null;
  }
}

/**
 * Get detailed info for a movie or TV show
 */
export async function getDetails(apiKey, tmdbId, type = 'movie') {
  const mediaType = type === 'series' ? 'tv' : 'movie';
  return tmdbFetch(`/${mediaType}/${tmdbId}`, apiKey, {
    append_to_response: 'external_ids,credits'
  });
}

/**
 * Search for movies or TV shows
 */
export async function search(apiKey, query, type = 'movie', page = 1) {
  const mediaType = type === 'series' ? 'tv' : 'movie';
  return tmdbFetch(`/search/${mediaType}`, apiKey, { query, page });
}

/**
 * Convert TMDB result to Stremio meta preview format
 */
export function toStremioMeta(item, type, imdbId = null) {
  const isMovie = type === 'movie';
  const title = isMovie ? item.title : item.name;
  const releaseDate = isMovie ? item.release_date : item.first_air_date;
  const year = releaseDate ? releaseDate.split('-')[0] : '';

  // Map TMDB genre_ids (if present) to human-readable names using cached API results first,
  // falling back to the static JSON mapping.
  const mappedGenres = [];
  const ids = item.genre_ids || item.genres?.map(g => g.id) || [];
  const mediaKey = isMovie ? 'movie' : 'tv';

  // Try cached genre list first
  const cachedList = genreCache[mediaKey];
  const staticList = staticGenreMap[mediaKey] || {};

  ids.forEach(id => {
    const key = String(id);
    let name = null;
    if (cachedList) {
      const hit = cachedList.find(g => String(g.id) === key);
      if (hit) name = hit.name;
    }
    if (!name && staticList[key]) name = staticList[key];
    if (name) mappedGenres.push(name);
  });

  return {
    id: imdbId || `tmdb:${item.id}`,
    type: type === 'series' ? 'series' : 'movie',
    name: title,
    poster: item.poster_path 
      ? `${TMDB_IMAGE_BASE}/w500${item.poster_path}` 
      : null,
    posterShape: 'poster',
    background: item.backdrop_path 
      ? `${TMDB_IMAGE_BASE}/w1280${item.backdrop_path}` 
      : null,
    description: item.overview || '',
    releaseInfo: year,
    imdbRating: item.vote_average ? item.vote_average.toFixed(1) : null,
    genres: mappedGenres,
  };
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
 * Get available languages
 */
export async function getLanguages(apiKey) {
  const data = await tmdbFetch('/configuration/languages', apiKey);
  return data.filter(lang => lang.iso_639_1).map(lang => ({
    code: lang.iso_639_1,
    name: lang.english_name,
    nativeName: lang.name
  }));
}

/**
 * Get available countries
 */
export async function getCountries(apiKey) {
  const data = await tmdbFetch('/configuration/countries', apiKey);
  return data.map(country => ({
    code: country.iso_3166_1,
    name: country.english_name,
    nativeName: country.native_name
  }));
}

/**
 * Get movie certifications (age ratings)
 */
export async function getCertifications(apiKey, type = 'movie') {
  const endpoint = type === 'series' ? '/certification/tv/list' : '/certification/movie/list';
  const data = await tmdbFetch(endpoint, apiKey);
  return data.certifications;
}

/**
 * Get watch providers for a region
 */
export async function getWatchProviders(apiKey, type = 'movie', region = 'US') {
  const mediaType = type === 'series' ? 'tv' : 'movie';
  const data = await tmdbFetch(`/watch/providers/${mediaType}`, apiKey, { watch_region: region });
  return data.results || [];
}

/**
 * Get available watch regions
 */
export async function getWatchRegions(apiKey) {
  const data = await tmdbFetch('/watch/providers/regions', apiKey);
  return data.results || [];
}

/**
 * Search for a person (actor, director, etc.)
 */
export async function searchPerson(apiKey, query) {
  const data = await tmdbFetch('/search/person', apiKey, { query });
  return data.results?.slice(0, 10).map(person => ({
    id: person.id,
    name: person.name,
    profilePath: person.profile_path ? `${TMDB_IMAGE_BASE}/w185${person.profile_path}` : null,
    knownFor: person.known_for_department
  })) || [];
}

/**
 * Search for a company
 */
export async function searchCompany(apiKey, query) {
  const data = await tmdbFetch('/search/company', apiKey, { query });
  return data.results?.slice(0, 10).map(company => ({
    id: company.id,
    name: company.name,
    logoPath: company.logo_path ? `${TMDB_IMAGE_BASE}/w185${company.logo_path}` : null
  })) || [];
}

/**
 * Search for keywords
 */
export async function searchKeyword(apiKey, query) {
  const data = await tmdbFetch('/search/keyword', apiKey, { query });
  return data.results?.slice(0, 10).map(keyword => ({
    id: keyword.id,
    name: keyword.name
  })) || [];
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
 * Get TV networks list
 */
export async function getNetworks(apiKey, query) {
  // TMDB doesn't have a networks list endpoint, so we search
  const data = await tmdbFetch('/search/company', apiKey, { query });
  // Filter to only include broadcasting networks (heuristic)
  return data.results?.slice(0, 10).map(network => ({
    id: network.id,
    name: network.name,
    logoPath: network.logo_path ? `${TMDB_IMAGE_BASE}/w185${network.logo_path}` : null
  })) || [];
}

/**
 * Special list types (non-discover endpoints)
 * These use dedicated TMDB endpoints instead of /discover
 */
export const LIST_TYPES = {
  movie: [
    { value: 'discover', label: '🔍 Custom Discover', description: 'Use filters below' },
    { value: 'trending_day', label: '🔥 Trending Today', description: 'Movies trending today' },
    { value: 'trending_week', label: '📈 Trending This Week', description: 'Movies trending this week' },
    { value: 'now_playing', label: '🎬 Now Playing', description: 'Currently in theaters' },
    { value: 'upcoming', label: '📅 Upcoming', description: 'Coming soon to theaters' },
    { value: 'top_rated', label: '⭐ Top Rated', description: 'All-time highest rated' },
    { value: 'popular', label: '🌟 Popular', description: 'Currently popular movies' },
  ],
  series: [
    { value: 'discover', label: '🔍 Custom Discover', description: 'Use filters below' },
    { value: 'trending_day', label: '🔥 Trending Today', description: 'TV shows trending today' },
    { value: 'trending_week', label: '📈 Trending This Week', description: 'TV shows trending this week' },
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
    { value: 'trending_week', label: '📈 Trending This Week', description: 'Movies trending this week' },
    { value: 'now_playing', label: '🎬 Now Playing', description: 'Currently in theaters' },
    { value: 'upcoming', label: '📅 Upcoming', description: 'Coming soon to theaters' },
    { value: 'top_rated', label: '⭐ Top Rated', description: 'All-time highest rated' },
    { value: 'popular', label: '🌟 Popular', description: 'Currently popular movies' },
  ],
  series: [
    { value: 'trending_day', label: '🔥 Trending Today', description: 'TV shows trending today' },
    { value: 'trending_week', label: '📈 Trending This Week', description: 'TV shows trending this week' },
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
    // Random
    { value: 'random', label: '🎲 Random Shuffle' },
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
    // Random
    { value: 'random', label: '🎲 Random Shuffle' },
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
