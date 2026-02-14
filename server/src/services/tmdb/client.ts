import fetch from 'node-fetch';
import { getCache } from '../cache/index.js';
import { CachedError, classifyError } from '../cache/CacheWrapper.js';
import { createLogger } from '../../utils/logger.ts';
import { getTmdbThrottle } from '../../infrastructure/tmdbThrottle.js';
import { getMetrics } from '../../infrastructure/metrics.js';
import { config } from '../../config.ts';
import { getRequestId } from '../../utils/requestContext.ts';
import { httpsAgent, TMDB_API_ORIGIN, TMDB_API_BASE_PATH, TMDB_SITE_ORIGIN } from './constants.ts';

import type { ApiKeyValidationResult, CacheErrorType, Logger } from '../../types/index.ts';

type TmdbFetchError = Error & { code?: string; statusCode?: number };

type TmdbApiParams = Record<string, string | number | boolean | undefined | null>;

const log = createLogger('tmdb:client') as Logger;

const FETCH_TIMEOUT_MS = 10_000;

const CIRCUIT_BREAKER = {
  threshold: 10,
  windowMs: 60_000,
  cooldownMs: 30_000,
  failures: [] as number[],
  openedAt: 0,
};

function recordCircuitFailure(): void {
  const now = Date.now();
  CIRCUIT_BREAKER.failures.push(now);
  CIRCUIT_BREAKER.failures = CIRCUIT_BREAKER.failures.filter(
    (ts) => now - ts < CIRCUIT_BREAKER.windowMs
  );
  if (CIRCUIT_BREAKER.failures.length >= CIRCUIT_BREAKER.threshold) {
    CIRCUIT_BREAKER.openedAt = now;
    log.warn('TMDB circuit breaker OPEN', { failures: CIRCUIT_BREAKER.failures.length });
  }
}

function recordCircuitSuccess(): void {
  CIRCUIT_BREAKER.failures = [];
  CIRCUIT_BREAKER.openedAt = 0;
}

function isCircuitOpen(): boolean {
  if (!CIRCUIT_BREAKER.openedAt) return false;
  if (Date.now() - CIRCUIT_BREAKER.openedAt > CIRCUIT_BREAKER.cooldownMs) {
    CIRCUIT_BREAKER.openedAt = 0;
    return false;
  }
  return true;
}

export function getCircuitBreakerState(): {
  state: 'closed' | 'open';
  recentFailures: number;
  openedAt: number;
} {
  return {
    state: isCircuitOpen() ? 'open' : 'closed',
    recentFailures: CIRCUIT_BREAKER.failures.length,
    openedAt: CIRCUIT_BREAKER.openedAt,
  };
}

export function resetCircuitBreaker(): void {
  CIRCUIT_BREAKER.failures = [];
  CIRCUIT_BREAKER.openedAt = 0;
}

export function redactTmdbUrl(urlString: string): string {
  if (typeof urlString !== 'string') return urlString;
  return urlString.replace(/([?&]api_key=)[^&\s]+/gi, '$1[REDACTED]');
}

export function isProbablyAbsoluteUrl(input: string): boolean {
  const s = String(input || '').trim();
  return /^([a-zA-Z][a-zA-Z0-9+.-]*:)?\/\//.test(s);
}

export function normalizeEndpoint(endpoint: string): string {
  const ep = String(endpoint || '').trim();
  if (!ep) throw new Error('Invalid TMDB endpoint: empty');
  if (isProbablyAbsoluteUrl(ep)) throw new Error('Invalid TMDB endpoint: absolute URL not allowed');
  return ep.startsWith('/') ? ep : `/${ep}`;
}

export function assertAllowedUrl(
  url: URL,
  { origin, pathPrefix }: { origin?: string; pathPrefix?: string }
): void {
  if (!(url instanceof URL)) throw new Error('Invalid URL');
  if (url.protocol !== 'https:') throw new Error('Blocked non-HTTPS outbound request');
  if (url.username || url.password) throw new Error('Blocked URL with credentials');
  if (origin && url.origin !== origin)
    throw new Error(`Blocked outbound request to untrusted origin: ${url.origin}`);
  if (pathPrefix && !url.pathname.startsWith(pathPrefix)) {
    throw new Error(`Blocked outbound request to untrusted path: ${url.pathname}`);
  }
}

export function normalizeLoose(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function matchesLoose(haystack: string, needle: string): boolean {
  const h = normalizeLoose(haystack);
  const n = normalizeLoose(needle);
  if (!n) return false;
  return h.includes(n);
}

export async function tmdbFetch(
  endpoint: string,
  apiKey: string,
  params: TmdbApiParams = {},
  retries: number = 3
): Promise<unknown> {
  const ep = normalizeEndpoint(endpoint);
  const url = new URL(TMDB_API_ORIGIN);
  url.pathname = `${TMDB_API_BASE_PATH}${ep}`;

  assertAllowedUrl(url, { origin: TMDB_API_ORIGIN, pathPrefix: `${TMDB_API_BASE_PATH}/` });

  url.searchParams.set('api_key', apiKey);

  Object.entries(params).forEach(([key, value]) => {
    if (key === 'api_key') return;
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });

  const cacheKey = url.toString();
  const cache = getCache();
  const metrics = getMetrics();

  if (isCircuitOpen()) {
    const err = new Error('TMDB circuit breaker is open') as TmdbFetchError;
    err.statusCode = 503;
    throw err;
  }

  try {
    const cached = (await cache.getEntry(cacheKey)) as Record<string, unknown> | null;
    if (cached !== null && cached !== undefined) {
      if (cached.__errorType) {
        throw new CachedError(
          cached.__errorType as CacheErrorType,
          cached.__errorMessage as string
        );
      }
      if (cached.__cacheWrapper) return cached.data;
      return cached;
    }
  } catch (err) {
    if (err instanceof CachedError) throw err;
    const cacheErr = err as Error;
    log.warn('Cache get failed', { error: cacheErr.message });
  }

  let lastError: TmdbFetchError | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (config.tmdb.debug) {
        log.debug(`TMDB request (attempt ${attempt + 1})`, { url: redactTmdbUrl(url.toString()) });
      }

      const throttle = getTmdbThrottle();
      await throttle.acquire();

      const abortController = new AbortController();
      const timeoutId = setTimeout(() => abortController.abort(), FETCH_TIMEOUT_MS);

      const fetchStart = Date.now();
      let response;
      try {
        response = await fetch(url.toString(), {
          agent: httpsAgent,
          signal: abortController.signal as any,
        });
      } finally {
        clearTimeout(timeoutId);
      }
      const fetchDuration = Date.now() - fetchStart;

      if (!response.ok) {
        metrics.trackProviderCall('tmdb', fetchDuration, true);

        if (response.status >= 500 || response.status === 429) {
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

        const errorBody = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        const statusMessage =
          typeof errorBody.status_message === 'string' ? errorBody.status_message : undefined;
        const err = new Error(
          statusMessage || `TMDB API error: ${response.status}`
        ) as TmdbFetchError;
        err.statusCode = response.status;
        throw err;
      }

      metrics.trackProviderCall('tmdb', fetchDuration, false);
      const data: unknown = await response.json();
      recordCircuitSuccess();

      try {
        await cache.set(cacheKey, data, 3600);
      } catch (cacheErr) {
        log.warn('Failed to cache TMDB response', {
          key: cacheKey,
          error: (cacheErr as Error).message,
        });
      }

      return data;
    } catch (err) {
      const error = err as TmdbFetchError;
      lastError = error;
      const isNetworkError =
        error.code === 'ECONNREFUSED' ||
        error.code === 'ECONNRESET' ||
        error.code === 'ETIMEDOUT' ||
        error.message.includes('retryable error') ||
        error.name === 'FetchError';

      if (attempt < retries && isNetworkError) {
        const delay = 300 * Math.pow(2, attempt);
        log.warn(`TMDB request failed, retrying in ${delay}ms`, {
          attempt: attempt + 1,
          error: redactTmdbUrl(error.message),
        });
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      break;
    }
  }

  log.error('TMDB fetch error after retries', {
    error: redactTmdbUrl(lastError!.message),
    endpoint: endpoint.slice(0, 80),
    statusCode: lastError!.statusCode,
    requestId: getRequestId(),
  });

  const shouldTrip =
    !lastError!.statusCode ||
    lastError!.statusCode >= 500 ||
    lastError!.statusCode === 429 ||
    ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT'].includes(lastError!.code || '');

  if (shouldTrip) {
    recordCircuitFailure();
  }

  const errorType = classifyError(lastError!, lastError!.statusCode) as CacheErrorType;
  try {
    await cache.setError(cacheKey, errorType, lastError!.message);
    metrics.trackError(errorType);
  } catch (e) {
    log.debug('Failed to cache error response', {
      cacheKey: cacheKey.slice(0, 60),
      error: (e as Error).message,
    });
  }

  throw lastError;
}

export async function tmdbWebsiteFetchJson(
  endpoint: string,
  params: TmdbApiParams = {}
): Promise<unknown> {
  const ep = normalizeEndpoint(endpoint);
  const url = new URL(TMDB_SITE_ORIGIN);
  url.pathname = ep;

  assertAllowedUrl(url, { origin: TMDB_SITE_ORIGIN });

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });

  const cacheKey = `tmdb_site:${url.toString()}`;
  const cache = getCache();

  try {
    const cached = await cache.get(cacheKey);
    if (cached) return cached;
  } catch {
    /* ignore get error */
  }

  const throttle = getTmdbThrottle();
  await throttle.acquire();

  const response = await fetch(url.toString(), {
    agent: httpsAgent,
    headers: {
      Accept: 'application/json, text/plain, */*',
      'X-Requested-With': 'XMLHttpRequest',
      'User-Agent': 'tmdb-discover-plus/2.x',
    },
  });

  if (!response.ok) {
    throw new Error(`TMDB website search error: ${response.status}`);
  }

  const text = await response.text();
  const trimmed = text.trim();
  const data: unknown = trimmed ? JSON.parse(trimmed) : null;

  try {
    await cache.set(cacheKey, data, 3600);
  } catch (err) {
    log.warn('Failed to cache TMDB website response', {
      key: cacheKey,
      error: (err as Error).message,
    });
  }

  return data;
}

export async function validateApiKey(apiKey: string): Promise<ApiKeyValidationResult> {
  try {
    await tmdbFetch('/configuration', apiKey);
    return { valid: true };
  } catch (error) {
    return { valid: false, error: (error as Error).message };
  }
}
