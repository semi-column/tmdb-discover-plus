import fetch from 'node-fetch';
import { getCache } from '../cache/index.js';
import { createLogger } from '../../utils/logger.ts';
import { getImdbThrottle } from '../../infrastructure/imdbThrottle.ts';
import { recordImdbApiCall, isQuotaExceeded } from '../../infrastructure/imdbQuota.ts';
import { getMetrics } from '../../infrastructure/metrics.js';
import { config } from '../../config.ts';
import { getRequestId } from '../../utils/requestContext.ts';

import type { Logger } from '../../types/index.ts';

type ImdbFetchError = Error & { code?: string; statusCode?: number };

const log = createLogger('imdb:client') as Logger;

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
    log.warn('IMDb circuit breaker OPEN', { failures: CIRCUIT_BREAKER.failures.length });
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

export function getImdbCircuitBreakerState(): {
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

export function resetImdbCircuitBreaker(): void {
  CIRCUIT_BREAKER.failures = [];
  CIRCUIT_BREAKER.openedAt = 0;
}

export async function imdbFetch(
  endpoint: string,
  params: Record<string, string | number | boolean | string[] | undefined | null> = {},
  cacheTtl: number = 3600,
  retries: number = 3
): Promise<unknown> {
  const apiKey = config.imdbApi.apiKey;
  const apiHost = config.imdbApi.apiHost;
  const keyHeader = config.imdbApi.apiKeyHeader;
  const hostHeader = config.imdbApi.apiHostHeader;

  if (!apiKey) {
    throw new Error('IMDb API key not configured');
  }

  if (!apiHost) {
    throw new Error('IMDb API host not configured');
  }

  if (isQuotaExceeded()) {
    const err = new Error('IMDb API monthly quota exceeded') as ImdbFetchError;
    err.statusCode = 429;
    throw err;
  }

  const ep = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const url = new URL(`https://${apiHost}${ep}`);

  if (url.protocol !== 'https:') {
    throw new Error('Blocked non-HTTPS outbound request');
  }

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value)) {
      value.forEach((v) => url.searchParams.append(key, String(v)));
    } else {
      url.searchParams.set(key, String(value));
    }
  });

  const cacheKey = `imdb:${url.pathname}${url.search}`;
  const cache = getCache();
  const metrics = getMetrics();

  if (isCircuitOpen()) {
    const err = new Error('IMDb circuit breaker is open') as ImdbFetchError;
    err.statusCode = 503;
    throw err;
  }

  try {
    const cached = await cache.get(cacheKey);
    if (cached !== null && cached !== undefined) {
      return cached;
    }
  } catch (err) {
    log.warn('IMDb cache get failed', { error: (err as Error).message });
  }

  let lastError: ImdbFetchError | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const throttle = getImdbThrottle();
      await throttle.acquire();

      const abortController = new AbortController();
      const timeoutId = setTimeout(() => abortController.abort(), FETCH_TIMEOUT_MS);

      const fetchStart = Date.now();
      let response;
      try {
        response = await fetch(url.toString(), {
          signal: abortController.signal as any,
          headers: {
            [keyHeader]: apiKey,
            [hostHeader]: apiHost,
            Accept: 'application/json',
          },
        });
      } finally {
        clearTimeout(timeoutId);
      }
      const fetchDuration = Date.now() - fetchStart;

      recordImdbApiCall(ep);

      if (!response.ok) {
        metrics.trackProviderCall('imdb', fetchDuration, true);

        if (response.status >= 500 || response.status === 429) {
          if (response.status === 429) {
            const retryAfter = response.headers.get('Retry-After');
            if (retryAfter) {
              const waitMs = Math.min(parseInt(retryAfter) * 1000, 10000) || 1000;
              log.warn('IMDb 429 — respecting Retry-After', { retryAfter, waitMs });
              await new Promise((resolve) => setTimeout(resolve, waitMs));
            }
          }
          throw new Error(`IMDb API retryable error: ${response.status}`);
        }

        const errorBody = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        const statusMessage = typeof errorBody.message === 'string' ? errorBody.message : undefined;
        const err = new Error(
          statusMessage || `IMDb API error: ${response.status}`
        ) as ImdbFetchError;
        err.statusCode = response.status;
        throw err;
      }

      metrics.trackProviderCall('imdb', fetchDuration, false);
      const data: unknown = await response.json();
      recordCircuitSuccess();

      log.debug('IMDb API response', {
        endpoint: ep,
        durationMs: fetchDuration,
        requestId: getRequestId(),
      });

      try {
        await cache.set(cacheKey, data, cacheTtl);
      } catch (cacheErr) {
        log.warn('Failed to cache IMDb response', {
          key: cacheKey.substring(0, 80),
          error: (cacheErr as Error).message,
        });
      }

      return data;
    } catch (err) {
      const error = err as ImdbFetchError;
      lastError = error;
      const isNetworkError =
        error.code === 'ECONNREFUSED' ||
        error.code === 'ECONNRESET' ||
        error.code === 'ETIMEDOUT' ||
        error.message.includes('retryable error') ||
        error.name === 'FetchError';

      if (attempt < retries && isNetworkError) {
        const delay = 300 * Math.pow(2, attempt);
        log.warn(`IMDb request failed, retrying in ${delay}ms`, {
          attempt: attempt + 1,
          error: error.message,
        });
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      break;
    }
  }

  log.error('IMDb fetch error after retries', {
    error: lastError!.message,
    endpoint: ep.slice(0, 80),
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

  throw lastError;
}
