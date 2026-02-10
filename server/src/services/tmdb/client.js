import fetch from 'node-fetch';
import { getCache } from '../cache/index.js';
import { CachedError, classifyError } from '../cache/CacheWrapper.js';
import { createLogger } from '../../utils/logger.js';
import { getTmdbThrottle } from '../tmdbThrottle.js';
import { getMetrics } from '../metrics.js';
import {
  httpsAgent,
  TMDB_API_ORIGIN,
  TMDB_API_BASE_PATH,
  TMDB_SITE_ORIGIN,
} from './constants.js';

const log = createLogger('tmdb:client');

// ── URL helpers ──────────────────────────────────────────────────────────────

export function redactTmdbUrl(urlString) {
  if (typeof urlString !== 'string') return urlString;
  return urlString.replace(/([?&]api_key=)[^&\s]+/gi, '$1[REDACTED]');
}

export function isProbablyAbsoluteUrl(input) {
  const s = String(input || '').trim();
  return /^([a-zA-Z][a-zA-Z0-9+.-]*:)?\/\//.test(s);
}

export function normalizeEndpoint(endpoint) {
  const ep = String(endpoint || '').trim();
  if (!ep) throw new Error('Invalid TMDB endpoint: empty');
  if (isProbablyAbsoluteUrl(ep)) throw new Error('Invalid TMDB endpoint: absolute URL not allowed');
  return ep.startsWith('/') ? ep : `/${ep}`;
}

export function assertAllowedUrl(url, { origin, pathPrefix }) {
  if (!(url instanceof URL)) throw new Error('Invalid URL');
  if (url.protocol !== 'https:') throw new Error('Blocked non-HTTPS outbound request');
  if (url.username || url.password) throw new Error('Blocked URL with credentials');
  if (origin && url.origin !== origin)
    throw new Error(`Blocked outbound request to untrusted origin: ${url.origin}`);
  if (pathPrefix && !url.pathname.startsWith(pathPrefix)) {
    throw new Error(`Blocked outbound request to untrusted path: ${url.pathname}`);
  }
}

// ── String matching helpers ──────────────────────────────────────────────────

export function normalizeLoose(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ') // keep boundaries
    .trim();
}

export function matchesLoose(haystack, needle) {
  const h = normalizeLoose(haystack);
  const n = normalizeLoose(needle);
  if (!n) return false;
  return h.includes(n);
}

// ── Core TMDB API fetcher ────────────────────────────────────────────────────

/**
 * Make a request to TMDB API with retries
 */
export async function tmdbFetch(endpoint, apiKey, params = {}, retries = 3) {
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
  const metrics = getMetrics();

  // Check cache — CacheWrapper handles self-healing, stale-while-revalidate,
  // and returns cached errors as { __errorType } markers
  try {
    const cached = await cache.get(cacheKey);
    if (cached !== null && cached !== undefined) {
      // Cached error — throw so caller sees it as a recent failure
      if (cached.__errorType) {
        throw new CachedError(cached.__errorType, cached.__errorMessage);
      }
      // Wrapped data from CacheWrapper
      if (cached.__cacheWrapper) return cached.data;
      // Legacy unwrapped data
      return cached;
    }
  } catch (err) {
    // Re-throw CachedErrors so callers can handle them
    if (err instanceof CachedError) throw err;
    log.warn('Cache get failed', { error: err.message });
  }

  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (process.env.DEBUG_TMDB === '1') {
        log.debug(`TMDB request (attempt ${attempt + 1})`, { url: redactTmdbUrl(url.toString()) });
      }

      // Outbound rate limiting — wait for token before calling TMDB
      const throttle = getTmdbThrottle();
      await throttle.acquire();

      const fetchStart = Date.now();
      const response = await fetch(url.toString(), { agent: httpsAgent });
      const fetchDuration = Date.now() - fetchStart;

      if (!response.ok) {
        metrics.trackProviderCall('tmdb', fetchDuration, true);

        if (response.status >= 500 || response.status === 429) {
          // Respect Retry-After header for 429s
          if (response.status === 429) {
            const retryAfter = response.headers.get('Retry-After');
            if (retryAfter) {
              const waitMs = Math.min(parseInt(retryAfter) * 1000, 10000) || 1000;
              log.warn('TMDB 429 — respecting Retry-After', { retryAfter, waitMs });
              await new Promise((resolve) => setTimeout(resolve, waitMs));
            }
          }
          throw new Error(`TMDB API retryable error: ${response.status}`);
        }

        const error = await response.json().catch(() => ({}));
        const err = new Error(error.status_message || `TMDB API error: ${response.status}`);
        err.statusCode = response.status;
        throw err;
      }

      metrics.trackProviderCall('tmdb', fetchDuration, false);
      const data = await response.json();

      try {
        await cache.set(cacheKey, data, 3600); // 1 hour TTL
      } catch (cacheErr) {
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

  // Cache the error with type-specific TTL to prevent thundering herd
  const errorType = classifyError(lastError, lastError.statusCode);
  try {
    await cache.setError(cacheKey, errorType, lastError.message);
    metrics.trackError(errorType);
  } catch {
    /* best effort */
  }

  throw lastError;
}

// ── TMDB Website JSON fetcher ────────────────────────────────────────────────

export async function tmdbWebsiteFetchJson(endpoint, params = {}) {
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

// ── API key validation ───────────────────────────────────────────────────────

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
