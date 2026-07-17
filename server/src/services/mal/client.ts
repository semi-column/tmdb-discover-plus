import nodeFetch, { type RequestInit } from 'node-fetch';
import { createLogger } from '../../utils/logger.ts';
import { TIMEOUTS } from '../../constants.ts';
import { ADDON_VERSION } from '../../version.ts';
import { createCircuitBreaker } from '../common/circuitBreaker.ts';
import { fetchWithRetry } from '../common/fetchWithRetry.ts';

const log = createLogger('mal:client');

const JIKAN_API_BASE = process.env['JIKAN_API_BASE'] || 'https://api.jikan.moe/v4';
const JIKAN_API_ORIGIN = new URL(JIKAN_API_BASE).origin;
const MIN_INTERVAL_MS = 350; // ~3 req/s to respect Jikan rate limits
const JIKAN_HEADERS = {
  Accept: 'application/json',
  'User-Agent': `TMDB-Discover-Plus/${ADDON_VERSION} (+https://github.com/semi-column/tmdb-discover-plus)`,
} as const;

const jikanFetchImplementation: typeof fetch = (url, init) =>
  nodeFetch(String(url), init as unknown as RequestInit) as unknown as ReturnType<typeof fetch>;

let lastRequestTime = 0;
const requestQueue: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];
let processingQueue = false;

async function processQueue(): Promise<void> {
  if (processingQueue) return;
  processingQueue = true;
  while (requestQueue.length > 0) {
    const now = Date.now();
    const elapsed = now - lastRequestTime;
    if (elapsed < MIN_INTERVAL_MS) {
      await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - elapsed));
    }
    lastRequestTime = Date.now();
    const item = requestQueue.shift();
    item?.resolve();
  }
  processingQueue = false;
}

async function acquireSlot(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (requestQueue.length >= 100) {
      reject(new Error('Jikan request queue full'));
      return;
    }
    requestQueue.push({ resolve, reject });
    processQueue();
  });
}

const circuitBreaker = createCircuitBreaker({
  onOpen: () => log.warn('circuit breaker opened for Jikan API'),
});

function resolveJikanUrl(requestPath: string): string {
  if (!requestPath) throw new Error('Jikan path is required');

  if (requestPath.startsWith('http://') || requestPath.startsWith('https://')) {
    const parsed = new URL(requestPath);
    if (parsed.origin !== JIKAN_API_ORIGIN) {
      throw Object.assign(new Error('Disallowed Jikan URL origin'), { statusCode: 400 });
    }
    return parsed.toString();
  }

  if (!requestPath.startsWith('/') || requestPath.startsWith('//')) {
    throw Object.assign(new Error('Invalid Jikan API path'), { statusCode: 400 });
  }

  return `${JIKAN_API_BASE}${requestPath}`;
}

export async function jikanFetch<T>(path: string): Promise<T> {
  if (circuitBreaker.isOpen()) {
    throw Object.assign(new Error('Jikan circuit breaker open'), { statusCode: 503 });
  }

  await acquireSlot();

  const url = resolveJikanUrl(path);

  try {
    const data = await fetchWithRetry<T>(
      url,
      { headers: JIKAN_HEADERS },
      {
        providerName: 'Jikan',
        timeoutMs: TIMEOUTS.MAL_FETCH_MS,
        fetchImplementation: jikanFetchImplementation,
        onRateLimited: (_response, attempt) => log.warn('Jikan rate limited', { attempt }),
        getRetryDelayMs: (_response, attempt) => 2000 * Math.pow(2, attempt),
      }
    );
    circuitBreaker.recordSuccess();
    return data;
  } catch (err) {
    circuitBreaker.recordFailure();
    throw err;
  }
}
