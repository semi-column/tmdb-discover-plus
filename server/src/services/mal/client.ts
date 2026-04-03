import { createLogger } from '../../utils/logger.ts';
import { TIMEOUTS, CIRCUIT_BREAKER_DEFAULTS } from '../../constants.ts';

const log = createLogger('mal:client');

const JIKAN_API_BASE = process.env['JIKAN_API_BASE'] || 'https://api.jikan.moe/v4';
const MIN_INTERVAL_MS = 350; // ~3 req/s to respect Jikan rate limits

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
    log.warn('circuit breaker opened for Jikan API');
  }
}

function recordSuccess(): void {
  circuitBreaker.failures = [];
  circuitBreaker.openedAt = 0;
}

export async function jikanFetch<T>(path: string): Promise<T> {
  if (isCircuitOpen()) {
    throw Object.assign(new Error('Jikan circuit breaker open'), { statusCode: 503 });
  }

  await acquireSlot();

  const url = path.startsWith('http') ? path : `${JIKAN_API_BASE}${path}`;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(TIMEOUTS.MAL_FETCH_MS),
      });

      if (response.status === 429) {
        log.warn('Jikan rate limited', { attempt });
        await new Promise((r) => setTimeout(r, 2000 * Math.pow(2, attempt)));
        continue;
      }

      if (!response.ok) {
        throw Object.assign(new Error(`Jikan API error: ${response.status}`), {
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
  throw lastError || new Error('Jikan API request failed');
}
