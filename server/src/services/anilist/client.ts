import { createLogger } from '../../utils/logger.ts';
import { TIMEOUTS } from '../../constants.ts';
import { createCircuitBreaker } from '../common/circuitBreaker.ts';
import { fetchWithRetry } from '../common/fetchWithRetry.ts';
import { getRequestRemainingMs } from '../../utils/requestContext.ts';

const log = createLogger('anilist:client');

const ANILIST_API_URL = 'https://graphql.anilist.co';
const ANILIST_API_ORIGIN = new URL(ANILIST_API_URL).origin;

// Rate limiting: AniList allows 30 req/min (degraded from 90)
const MIN_INTERVAL_MS = 2100; // ~28 req/min to stay safely under 30
const MAX_PAUSE_MS = 65_000;
let lastRequestTime = 0;
// ponytail: per-process pause; multiple instances behind one IP still share AniList's limit.
let pausedUntil = 0;
const requestQueue: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];
let processingQueue = false;

function parseRetryAfterMs(value: string | null, now: number): number {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? 0 : Math.max(0, date - now);
}

/** Pauses the whole queue when AniList says to back off (429 or no remaining quota). */
function noteRateLimitHeaders(headers: Headers, status: number): void {
  const now = Date.now();
  let waitMs = parseRetryAfterMs(headers.get('retry-after'), now);
  if (!waitMs && (status === 429 || headers.get('x-ratelimit-remaining') === '0')) {
    const resetSeconds = Number(headers.get('x-ratelimit-reset'));
    waitMs = resetSeconds > 0 ? resetSeconds * 1000 - now : 60_000;
  }
  if (waitMs > 0) pausedUntil = Math.max(pausedUntil, now + Math.min(waitMs, MAX_PAUSE_MS));
}

const anilistFetchImplementation: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  noteRateLimitHeaders(response.headers, response.status);
  return response;
};

async function processQueue(): Promise<void> {
  if (processingQueue) return;
  processingQueue = true;
  while (requestQueue.length > 0) {
    // Re-check after sleeping: a 429 may extend the pause meanwhile.
    let waitMs: number;
    while ((waitMs = Math.max(lastRequestTime + MIN_INTERVAL_MS, pausedUntil) - Date.now()) > 0) {
      await new Promise((r) => setTimeout(r, waitMs));
    }
    lastRequestTime = Date.now();
    const item = requestQueue.shift();
    item?.resolve();
  }
  processingQueue = false;
}

async function acquireSlot(): Promise<void> {
  return new Promise((resolve, reject) => {
    // Waiting out the pause past the parent request's timeout only turns a 429 into a 504.
    if (pausedUntil - Date.now() >= getRequestRemainingMs(TIMEOUTS.REQUEST_MS)) {
      reject(
        Object.assign(new Error('AniList API rate limited'), {
          statusCode: 429,
          rateLimitExhausted: true,
        })
      );
      return;
    }
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
        allowedOrigins: [ANILIST_API_ORIGIN],
        includeResponseBodyInError: true,
        fetchImplementation: anilistFetchImplementation,
        onRateLimited: (_response, attempt) => {
          log.warn('AniList rate limited', { pauseMs: pausedUntil - Date.now(), attempt });
        },
        getRetryDelayMs: () => Math.max(pausedUntil - Date.now(), MIN_INTERVAL_MS),
      }
    );
    circuitBreaker.recordSuccess();
    return data;
  } catch (err) {
    circuitBreaker.recordFailure();
    throw err;
  }
}
