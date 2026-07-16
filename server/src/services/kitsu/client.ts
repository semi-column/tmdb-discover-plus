import { createLogger } from '../../utils/logger.ts';
import { TIMEOUTS } from '../../constants.ts';
import { ADDON_VERSION } from '../../version.ts';
import { createCircuitBreaker } from '../common/circuitBreaker.ts';
import { fetchWithRetry } from '../common/fetchWithRetry.ts';

const log = createLogger('kitsu:client');

const KITSU_API_BASE = 'https://kitsu.io/api/edge';
const KITSU_API_ORIGIN = 'https://kitsu.io';
const MIN_INTERVAL_MS = 100;
const KITSU_HEADERS = {
  Accept: 'application/vnd.api+json',
  'Content-Type': 'application/vnd.api+json',
  'User-Agent': `TMDB-Discover-Plus/${ADDON_VERSION} (+https://github.com/semi-column/tmdb-discover-plus)`,
} as const;

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
      reject(new Error('Kitsu request queue full'));
      return;
    }
    requestQueue.push({ resolve, reject });
    processQueue();
  });
}

const circuitBreaker = createCircuitBreaker({
  onOpen: () => log.warn('circuit breaker opened for Kitsu API'),
});

function resolveKitsuUrl(requestPath: string): string {
  if (!requestPath) throw new Error('Kitsu path is required');

  if (requestPath.startsWith('http://') || requestPath.startsWith('https://')) {
    const parsed = new URL(requestPath);
    if (parsed.origin !== KITSU_API_ORIGIN) {
      throw Object.assign(new Error('Disallowed Kitsu URL origin'), { statusCode: 400 });
    }
    return parsed.toString();
  }

  if (!requestPath.startsWith('/') || requestPath.startsWith('//')) {
    throw Object.assign(new Error('Invalid Kitsu API path'), { statusCode: 400 });
  }

  return `${KITSU_API_BASE}${requestPath}`;
}

export async function kitsuFetch<T>(path: string): Promise<T> {
  if (circuitBreaker.isOpen()) {
    throw Object.assign(new Error('Kitsu circuit breaker open'), { statusCode: 503 });
  }

  await acquireSlot();

  const url = resolveKitsuUrl(path);

  try {
    const data = await fetchWithRetry<T>(
      url,
      { headers: KITSU_HEADERS },
      {
        providerName: 'Kitsu',
        timeoutMs: TIMEOUTS.KITSU_FETCH_MS,
        onRateLimited: (_response, attempt) => log.warn('Kitsu rate limited', { attempt }),
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
