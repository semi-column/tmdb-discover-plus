import { createLogger } from '../../utils/logger.ts';
import { config } from '../../config.ts';
import { TIMEOUTS, CIRCUIT_BREAKER_DEFAULTS } from '../../constants.ts';

const log = createLogger('trakt:client');

const TRAKT_API_BASE = 'https://api.trakt.tv';
const TRAKT_API_ORIGIN = new URL(TRAKT_API_BASE).origin;
const MAX_CONCURRENT = 8;
const USER_AGENT = 'TMDB-Discover-Plus/2.9.2';

let activeCount = 0;
const waitQueue: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];

async function acquireSlot(): Promise<void> {
  if (activeCount < MAX_CONCURRENT) {
    activeCount++;
    return;
  }
  if (waitQueue.length >= 100) {
    throw new Error('Trakt request queue full');
  }
  return new Promise<void>((resolve, reject) => {
    waitQueue.push({ resolve, reject });
  });
}

function releaseSlot(): void {
  if (waitQueue.length > 0) {
    const next = waitQueue.shift()!;
    next.resolve();
  } else {
    activeCount--;
  }
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
    log.warn('circuit breaker opened for Trakt API');
  }
}

function recordSuccess(): void {
  circuitBreaker.failures = [];
  circuitBreaker.openedAt = 0;
}

export function getTraktClientId(userKey?: string): string {
  return userKey || config.traktApi.clientId;
}

function resolveTraktUrl(requestPath: string): string {
  if (!requestPath) throw new Error('Trakt path is required');

  if (requestPath.startsWith('http://') || requestPath.startsWith('https://')) {
    const parsed = new URL(requestPath);
    if (parsed.origin !== TRAKT_API_ORIGIN) {
      throw Object.assign(new Error('Disallowed Trakt URL origin'), { statusCode: 400 });
    }
    return parsed.toString();
  }

  if (!requestPath.startsWith('/') || requestPath.startsWith('//')) {
    throw Object.assign(new Error('Invalid Trakt API path'), { statusCode: 400 });
  }

  return `${TRAKT_API_BASE}${requestPath}`;
}

export async function traktFetch<T>(path: string, clientId?: string): Promise<T> {
  const key = getTraktClientId(clientId);
  if (!key) {
    throw Object.assign(new Error('Trakt Client ID not configured'), { statusCode: 503 });
  }

  if (isCircuitOpen()) {
    throw Object.assign(new Error('Trakt circuit breaker open'), { statusCode: 503 });
  }

  await acquireSlot();

  try {
    const url = resolveTraktUrl(path);
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(url, {
          headers: {
            'Content-Type': 'application/json',
            'Accept-Encoding': 'gzip, deflate',
            'trakt-api-version': '2',
            'trakt-api-key': key,
            'User-Agent': USER_AGENT,
          },
          signal: AbortSignal.timeout(TIMEOUTS.TRAKT_FETCH_MS),
        });

        if (response.status === 429) {
          const retryAfter = parseInt(response.headers.get('Retry-After') || '5', 10);
          log.warn('Trakt rate limited', { status: 429, attempt, retryAfter });
          await new Promise((r) => setTimeout(r, retryAfter * 1000));
          continue;
        }

        if (response.status === 503) {
          log.warn('Trakt service unavailable', { attempt });
          await new Promise((r) => setTimeout(r, 2000 * Math.pow(2, attempt)));
          continue;
        }

        if (!response.ok) {
          throw Object.assign(new Error(`Trakt API error: ${response.status}`), {
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
    throw lastError || new Error('Trakt API request failed');
  } finally {
    releaseSlot();
  }
}
