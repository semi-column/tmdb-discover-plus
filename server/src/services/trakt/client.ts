import { createLogger } from '../../utils/logger.ts';
import { config } from '../../config.ts';
import { TIMEOUTS } from '../../constants.ts';
import { createCircuitBreaker } from '../common/circuitBreaker.ts';
import { fetchWithRetry } from '../common/fetchWithRetry.ts';

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

const circuitBreaker = createCircuitBreaker({
  onOpen: () => log.warn('circuit breaker opened for Trakt API'),
});

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

  if (circuitBreaker.isOpen()) {
    throw Object.assign(new Error('Trakt circuit breaker open'), { statusCode: 503 });
  }

  await acquireSlot();

  try {
    const url = resolveTraktUrl(path);

    try {
      const data = await fetchWithRetry<T>(
        url,
        {
          headers: {
            'Content-Type': 'application/json',
            'Accept-Encoding': 'gzip, deflate',
            'trakt-api-version': '2',
            'trakt-api-key': key,
            'User-Agent': USER_AGENT,
          },
        },
        {
          providerName: 'Trakt',
          timeoutMs: TIMEOUTS.TRAKT_FETCH_MS,
          isRateLimited: (status) => status === 429 || status === 503,
          onRateLimited: (response, attempt) => {
            if (response.status === 429) {
              const retryAfter = parseInt(response.headers.get('Retry-After') || '5', 10);
              log.warn('Trakt rate limited', { status: 429, attempt, retryAfter });
            } else {
              log.warn('Trakt service unavailable', { attempt });
            }
          },
          getRetryDelayMs: (response, attempt) => {
            if (response.status === 429) {
              const retryAfter = parseInt(response.headers.get('Retry-After') || '5', 10);
              return retryAfter * 1000;
            }
            return 2000 * Math.pow(2, attempt);
          },
        }
      );
      circuitBreaker.recordSuccess();
      return data;
    } catch (err) {
      circuitBreaker.recordFailure();
      throw err;
    }
  } finally {
    releaseSlot();
  }
}
