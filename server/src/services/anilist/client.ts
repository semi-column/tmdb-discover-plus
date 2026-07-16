import { createLogger } from '../../utils/logger.ts';
import { TIMEOUTS } from '../../constants.ts';
import { createCircuitBreaker } from '../common/circuitBreaker.ts';
import { fetchWithRetry } from '../common/fetchWithRetry.ts';

const log = createLogger('anilist:client');

const ANILIST_API_URL = 'https://graphql.anilist.co';

// Rate limiting: AniList allows 30 req/min (degraded from 90)
const MIN_INTERVAL_MS = 2100; // ~28 req/min to stay safely under 30
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
      reject(new Error('AniList request queue full'));
      return;
    }
    requestQueue.push({ resolve, reject });
    processQueue();
  });
}

// Circuit breaker
const circuitBreaker = createCircuitBreaker({
  onOpen: () => log.warn('circuit breaker opened for AniList API'),
});

export async function anilistFetch<T>(
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  if (circuitBreaker.isOpen()) {
    throw Object.assign(new Error('AniList circuit breaker open'), { statusCode: 503 });
  }

  await acquireSlot();

  try {
    const data = await fetchWithRetry<T>(
      ANILIST_API_URL,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query, variables }),
      },
      {
        providerName: 'AniList',
        timeoutMs: TIMEOUTS.ANILIST_FETCH_MS,
        includeResponseBodyInError: true,
        onRateLimited: (response, attempt) => {
          const retryAfter = parseInt(response.headers.get('retry-after') || '60', 10);
          log.warn('AniList rate limited', { retryAfter, attempt });
        },
        getRetryDelayMs: (response) => {
          const retryAfter = parseInt(response.headers.get('retry-after') || '60', 10);
          return Math.min(retryAfter * 1000, 65_000);
        },
      }
    );
    circuitBreaker.recordSuccess();
    return data;
  } catch (err) {
    circuitBreaker.recordFailure();
    throw err;
  }
}
