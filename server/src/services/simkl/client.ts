import { createLogger } from '../../utils/logger.ts';
import { config } from '../../config.ts';
import { TIMEOUTS, CIRCUIT_BREAKER_DEFAULTS } from '../../constants.ts';

const log = createLogger('simkl:client');

const SIMKL_API_BASE = 'https://api.simkl.com';
const SIMKL_CDN_BASE = 'https://data.simkl.in';
const MIN_INTERVAL_MS = 300;

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
      reject(new Error('Simkl request queue full'));
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
    log.warn('circuit breaker opened for Simkl API');
  }
}

function recordSuccess(): void {
  circuitBreaker.failures = [];
  circuitBreaker.openedAt = 0;
}

export function getSimklApiKey(userKey?: string): string {
  return userKey || config.simklApi.clientId;
}

export async function simklFetch<T>(path: string, apiKey?: string): Promise<T> {
  const key = getSimklApiKey(apiKey);
  if (!key) {
    throw Object.assign(new Error('Simkl API key not configured'), { statusCode: 503 });
  }

  if (isCircuitOpen()) {
    throw Object.assign(new Error('Simkl circuit breaker open'), { statusCode: 503 });
  }

  await acquireSlot();

  const url = path.startsWith('http') ? path : `${SIMKL_API_BASE}${path}`;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
          'simkl-api-key': key,
        },
        signal: AbortSignal.timeout(TIMEOUTS.SIMKL_FETCH_MS),
      });

      if (response.status === 429 || response.status === 503) {
        log.warn('Simkl rate limited', { status: response.status, attempt });
        await new Promise((r) => setTimeout(r, 2000 * Math.pow(2, attempt)));
        continue;
      }

      if (!response.ok) {
        throw Object.assign(new Error(`Simkl API error: ${response.status}`), {
          statusCode: response.status,
        });
      }

      const data = (await response.json()) as T;
      recordSuccess();
      return data;
    } catch (err) {
      lastError = err as Error;
      const code = (err as { statusCode?: number }).statusCode;
      if (code === 429 || code === 503) continue;
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 300 * Math.pow(2, attempt)));
      }
    }
  }

  recordFailure();
  throw lastError || new Error('Simkl API request failed');
}

export async function simklCdnFetch<T>(path: string): Promise<T> {
  const url = `${SIMKL_CDN_BASE}${path}`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'TMDBDiscoverPlus/1.0' },
    signal: AbortSignal.timeout(TIMEOUTS.SIMKL_FETCH_MS),
  });
  if (!response.ok) {
    throw Object.assign(new Error(`Simkl CDN error: ${response.status}`), {
      statusCode: response.status,
    });
  }
  return (await response.json()) as T;
}
