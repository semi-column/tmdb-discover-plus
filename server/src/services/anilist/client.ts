import { createLogger } from '../../utils/logger.ts';
import { TIMEOUTS, CIRCUIT_BREAKER_DEFAULTS } from '../../constants.ts';

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
const circuitBreaker = {
  failures: [] as number[],
  openedAt: 0,
  threshold: CIRCUIT_BREAKER_DEFAULTS.THRESHOLD,
  windowMs: CIRCUIT_BREAKER_DEFAULTS.WINDOW_MS,
  cooldownMs: CIRCUIT_BREAKER_DEFAULTS.COOLDOWN_MS,
};

function isCircuitOpen(): boolean {
  if (!circuitBreaker.openedAt) return false;
  return Date.now() - circuitBreaker.openedAt < circuitBreaker.cooldownMs;
}

function recordFailure(): void {
  const now = Date.now();
  circuitBreaker.failures = circuitBreaker.failures.filter(
    (t) => now - t < circuitBreaker.windowMs
  );
  circuitBreaker.failures.push(now);
  if (circuitBreaker.failures.length >= circuitBreaker.threshold) {
    circuitBreaker.openedAt = now;
    log.warn('circuit breaker opened for AniList API');
  }
}

function recordSuccess(): void {
  circuitBreaker.failures = [];
  circuitBreaker.openedAt = 0;
}

export async function anilistFetch<T>(
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  if (isCircuitOpen()) {
    throw Object.assign(new Error('AniList circuit breaker open'), { statusCode: 503 });
  }

  await acquireSlot();

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(ANILIST_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(TIMEOUTS.ANILIST_FETCH_MS),
      });

      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('retry-after') || '60', 10);
        log.warn('AniList rate limited', { retryAfter, attempt });
        await new Promise((r) => setTimeout(r, Math.min(retryAfter * 1000, 65_000)));
        continue;
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw Object.assign(new Error(`AniList API error: ${response.status} ${body}`), {
          statusCode: response.status,
        });
      }

      const data = (await response.json()) as T;
      recordSuccess();
      return data;
    } catch (err) {
      lastError = err as Error;
      if ((err as { statusCode?: number }).statusCode === 429) continue;
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 300 * Math.pow(2, attempt)));
      }
    }
  }

  recordFailure();
  throw lastError || new Error('AniList API request failed');
}
