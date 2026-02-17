import { getCache } from '../cache/index.ts';
import { tmdbFetch } from './client.ts';
import { createLogger } from '../../utils/logger.ts';
import type {
  TmdbLanguage,
  TmdbCountry,
  TmdbCertificationMap,
  TmdbWatchRegion,
  TmdbWatchProvider,
} from '../../types/index.ts';

const log = createLogger('tmdb:configuration');

const REGIONAL_LANGUAGE_VARIANTS: TmdbLanguage[] = [
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

export async function getLanguages(apiKey: string): Promise<TmdbLanguage[]> {
  const cacheKey = 'tmdb_languages_v2';
  const cache = getCache();

  try {
    const cached = (await cache.get(cacheKey)) as TmdbLanguage[] | null;
    if (cached) return cached;
  } catch (e) {
    log.debug('Cache get failed', { key: cacheKey, error: (e as Error).message });
  }

  const data = (await tmdbFetch('/configuration/languages', apiKey)) as TmdbLanguage[];
  const filtered = data.filter((lang) => !REPLACED_BASE_CODES.has(lang.iso_639_1));
  const combined = [...filtered, ...REGIONAL_LANGUAGE_VARIANTS];
  const sorted = combined.sort((a, b) => a.english_name.localeCompare(b.english_name));

  if (sorted.length > 0) {
    try {
      await cache.set(cacheKey, sorted, 86400 * 7);
    } catch (e) {
      log.debug('Cache set failed', { key: cacheKey, error: (e as Error).message });
    }
  }

  return sorted;
}

export async function getOriginalLanguages(apiKey: string): Promise<TmdbLanguage[]> {
  const cacheKey = 'tmdb_original_languages_v2';
  const cache = getCache();

  try {
    const cached = (await cache.get(cacheKey)) as TmdbLanguage[] | null;
    if (cached) return cached;
  } catch (e) {
    log.debug('Cache get failed', { key: cacheKey, error: (e as Error).message });
  }

  const data = (await tmdbFetch('/configuration/languages', apiKey)) as TmdbLanguage[];
  const sorted = data
    .filter((lang) => lang.iso_639_1 && lang.english_name && !lang.iso_639_1.includes('-'))
    .sort((a, b) => a.english_name.localeCompare(b.english_name));

  if (sorted.length > 0) {
    try {
      await cache.set(cacheKey, sorted, 86400 * 7);
    } catch (e) {
      log.debug('Cache set failed', { key: cacheKey, error: (e as Error).message });
    }
  }

  return sorted;
}

export async function getCountries(apiKey: string): Promise<TmdbCountry[]> {
  const cacheKey = 'tmdb_countries_v2';
  const cache = getCache();

  try {
    const cached = (await cache.get(cacheKey)) as TmdbCountry[] | null;
    if (cached) return cached;
  } catch (e) {
    log.debug('Cache get failed', { key: cacheKey, error: (e as Error).message });
  }

  const data = (await tmdbFetch('/configuration/countries', apiKey)) as TmdbCountry[];
  const sorted = data.sort((a, b) => a.english_name.localeCompare(b.english_name));

  if (sorted.length > 0) {
    try {
      await cache.set(cacheKey, sorted, 86400 * 7);
    } catch (e) {
      log.debug('Cache set failed', { key: cacheKey, error: (e as Error).message });
    }
  }

  return sorted;
}

export async function getCertifications(
  apiKey: string,
  type: string = 'movie'
): Promise<TmdbCertificationMap> {
  const mediaType = type === 'series' ? 'tv' : 'movie';
  const cacheKey = `tmdb_certifications_${mediaType}_v2`;
  const cache = getCache();

  try {
    const cached = (await cache.get(cacheKey)) as TmdbCertificationMap | null;
    if (cached) return cached;
  } catch (e) {
    log.debug('Cache get failed', { key: cacheKey, error: (e as Error).message });
  }

  const data = (await tmdbFetch(`/certification/${mediaType}/list`, apiKey)) as {
    certifications?: TmdbCertificationMap;
  };
  const certs = data.certifications || {};

  if (Object.keys(certs).length > 0) {
    try {
      await cache.set(cacheKey, certs, 86400 * 7);
    } catch (e) {
      log.debug('Cache set failed', { key: cacheKey, error: (e as Error).message });
    }
  }

  return certs;
}

export async function getWatchRegions(apiKey: string): Promise<TmdbWatchRegion[]> {
  const cacheKey = 'tmdb_watch_regions_v2';
  const cache = getCache();

  try {
    const cached = (await cache.get(cacheKey)) as TmdbWatchRegion[] | null;
    if (cached) return cached;
  } catch (e) {
    log.debug('Cache get failed', { key: cacheKey, error: (e as Error).message });
  }

  const data = (await tmdbFetch('/watch/providers/regions', apiKey)) as {
    results?: TmdbWatchRegion[];
  };
  const results = data.results || [];
  const sorted = results.sort((a, b) => a.english_name.localeCompare(b.english_name));

  if (sorted.length > 0) {
    try {
      await cache.set(cacheKey, sorted, 86400 * 7);
    } catch (e) {
      log.debug('Cache set failed', { key: cacheKey, error: (e as Error).message });
    }
  }

  return sorted;
}

export async function getWatchProviders(
  apiKey: string,
  type: string = 'movie',
  region: string = 'US'
): Promise<TmdbWatchProvider[]> {
  const mediaType = type === 'series' ? 'tv' : 'movie';
  const cacheKey = `tmdb_watch_providers_${mediaType}_${region}`;
  const cache = getCache();

  try {
    const cached = (await cache.get(cacheKey)) as TmdbWatchProvider[] | null;
    if (cached) return cached;
  } catch (e) {
    log.debug('Cache get failed', { key: cacheKey, error: (e as Error).message });
  }

  const params = { watch_region: region };
  const data = (await tmdbFetch(`/watch/providers/${mediaType}`, apiKey, params)) as {
    results?: TmdbWatchProvider[];
  };
  const results = data.results || [];
  const sorted = results.sort((a, b) => a.provider_name.localeCompare(b.provider_name));

  if (sorted.length > 0) {
    try {
      await cache.set(cacheKey, sorted, 86400);
    } catch (e) {
      log.debug('Cache set failed', { key: cacheKey, error: (e as Error).message });
    }
  }

  return sorted;
}
