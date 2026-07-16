import { createLogger } from '../../utils/logger.ts';
import { config } from '../../config.ts';
import { TIMEOUTS } from '../../constants.ts';
import { createCircuitBreaker } from '../common/circuitBreaker.ts';
import { fetchWithRetry } from '../common/fetchWithRetry.ts';

const log = createLogger('simkl:client');

const SIMKL_API_BASE = 'https://api.simkl.com';
const SIMKL_CDN_BASE = 'https://data.simkl.in';
const SIMKL_API_ORIGIN = new URL(SIMKL_API_BASE).origin;
const SIMKL_CDN_ORIGIN = new URL(SIMKL_CDN_BASE).origin;
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

const circuitBreaker = createCircuitBreaker({
  onOpen: () => log.warn('circuit breaker opened for Simkl API'),
});

export function getSimklApiKey(userKey?: string): string {
  return userKey || config.simklApi.clientId;
}

function resolveSimklApiUrl(requestPath: string): string {
  if (!requestPath) throw new Error('Simkl path is required');

  if (requestPath.startsWith('http://') || requestPath.startsWith('https://')) {
    const parsed = new URL(requestPath);
    if (parsed.origin !== SIMKL_API_ORIGIN) {
      throw Object.assign(new Error('Disallowed Simkl URL origin'), { statusCode: 400 });
    }
    return parsed.toString();
  }

  if (!requestPath.startsWith('/') || requestPath.startsWith('//')) {
    throw Object.assign(new Error('Invalid Simkl API path'), { statusCode: 400 });
  }

  return `${SIMKL_API_BASE}${requestPath}`;
}

function resolveSimklCdnUrl(requestPath: string): string {
  if (!requestPath) throw new Error('Simkl CDN path is required');

  if (requestPath.startsWith('http://') || requestPath.startsWith('https://')) {
    const parsed = new URL(requestPath);
    if (parsed.origin !== SIMKL_CDN_ORIGIN) {
      throw Object.assign(new Error('Disallowed Simkl CDN URL origin'), { statusCode: 400 });
    }
    return parsed.toString();
  }

  if (!requestPath.startsWith('/') || requestPath.startsWith('//')) {
    throw Object.assign(new Error('Invalid Simkl CDN path'), { statusCode: 400 });
  }

  return `${SIMKL_CDN_BASE}${requestPath}`;
}

export async function simklFetch<T>(path: string, apiKey?: string): Promise<T> {
  const key = getSimklApiKey(apiKey);
  if (!key) {
    throw Object.assign(new Error('Simkl API key not configured'), { statusCode: 503 });
  }

  if (circuitBreaker.isOpen()) {
    throw Object.assign(new Error('Simkl circuit breaker open'), { statusCode: 503 });
  }

  await acquireSlot();

  const url = resolveSimklApiUrl(path);

  try {
    const data = await fetchWithRetry<T>(
      url,
      {
        headers: {
          'Content-Type': 'application/json',
          'simkl-api-key': key,
        },
      },
      {
        providerName: 'Simkl',
        timeoutMs: TIMEOUTS.SIMKL_FETCH_MS,
        isRateLimited: (status) => status === 429 || status === 503,
        onRateLimited: (response, attempt) =>
          log.warn('Simkl rate limited', { status: response.status, attempt }),
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

export async function simklCdnFetch<T>(path: string): Promise<T> {
  const url = resolveSimklCdnUrl(path);
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
