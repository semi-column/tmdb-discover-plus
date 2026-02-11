import { getCache } from '../cache/index.js';
import { tmdbFetch } from './client.js';

const REGIONAL_LANGUAGE_VARIANTS = [
  { iso_639_1: 'pt-BR', english_name: 'Portuguese (Brazil)', name: 'Português (Brasil)' },
  { iso_639_1: 'pt-PT', english_name: 'Portuguese (Portugal)', name: 'Português (Portugal)' },
  { iso_639_1: 'zh-CN', english_name: 'Chinese (Simplified)', name: '简体中文' },
  { iso_639_1: 'zh-TW', english_name: 'Chinese (Traditional)', name: '繁體中文' },
  { iso_639_1: 'zh-HK', english_name: 'Chinese (Hong Kong)', name: '香港中文' },
  { iso_639_1: 'es-MX', english_name: 'Spanish (Mexico)', name: 'Español (México)' },
  { iso_639_1: 'es-ES', english_name: 'Spanish (Spain)', name: 'Español (España)' },
  { iso_639_1: 'fr-CA', english_name: 'French (Canada)', name: 'Français (Canada)' },
  { iso_639_1: 'fr-FR', english_name: 'French (France)', name: 'Français (France)' },
  { iso_639_1: 'en-US', english_name: 'English (US)', name: 'English (US)' },
  { iso_639_1: 'en-GB', english_name: 'English (UK)', name: 'English (UK)' },
  { iso_639_1: 'de-DE', english_name: 'German (Germany)', name: 'Deutsch (Deutschland)' },
  { iso_639_1: 'de-AT', english_name: 'German (Austria)', name: 'Deutsch (Österreich)' },
  { iso_639_1: 'it-IT', english_name: 'Italian (Italy)', name: 'Italiano (Italia)' },
];

const REPLACED_BASE_CODES = new Set(['pt', 'zh', 'es', 'fr', 'en', 'de', 'it']);

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
  const filtered = data.filter((lang) => !REPLACED_BASE_CODES.has(lang.iso_639_1));
  const combined = [...filtered, ...REGIONAL_LANGUAGE_VARIANTS];
  const sorted = combined.sort((a, b) => a.english_name.localeCompare(b.english_name));

  if (sorted.length > 0) {
    try {
      await cache.set(cacheKey, sorted, 86400 * 7);
    } catch (e) {
      /* ignore */
    }
  }

  return sorted;
}

/**
 * Get languages valid for the "Original Language" discover filter.
 * TMDB's with_original_language only accepts base ISO 639-1 codes (e.g. "en", "pt"),
 * NOT regional variants like "en-GB" or "pt-BR".
 */
export async function getOriginalLanguages(apiKey) {
  const cacheKey = 'tmdb_original_languages';
  const cache = getCache();

  try {
    const cached = await cache.get(cacheKey);
    if (cached) return cached;
  } catch (e) {
    /* ignore */
  }

  const data = await tmdbFetch('/configuration/languages', apiKey);
  const sorted = data
    .filter((lang) => lang.iso_639_1 && lang.english_name && !lang.iso_639_1.includes('-'))
    .sort((a, b) => a.english_name.localeCompare(b.english_name));

  if (sorted.length > 0) {
    try {
      await cache.set(cacheKey, sorted, 86400 * 7);
    } catch (e) {
      /* ignore */
    }
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

  if (sorted.length > 0) {
    try {
      await cache.set(cacheKey, sorted, 86400 * 7); // 7 days
    } catch (e) {
      /* ignore */
    }
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

  if (Object.keys(certs).length > 0) {
    try {
      await cache.set(cacheKey, certs, 86400 * 7); // 7 days
    } catch (e) {
      /* ignore */
    }
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

  if (sorted.length > 0) {
    try {
      await cache.set(cacheKey, sorted, 86400 * 7); // 7 days
    } catch (e) {
      /* ignore */
    }
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

  if (sorted.length > 0) {
    try {
      await cache.set(cacheKey, sorted, 86400); // 24 hours
    } catch (e) {
      /* ignore */
    }
  }

  return sorted;
}
