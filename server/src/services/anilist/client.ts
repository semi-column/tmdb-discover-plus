import { createLogger } from '../../utils/logger.ts';
import { TIMEOUTS } from '../../constants.ts';
import { createCircuitBreaker, shouldRecordCircuitFailure } from '../common/circuitBreaker.ts';
import { fetchWithRetry } from '../common/fetchWithRetry.ts';
import { getAnilistThrottle } from '../../infrastructure/anilistThrottle.ts';

const log = createLogger('anilist:client');

const ANILIST_API_URL = 'https://graphql.anilist.co';
const ANILIST_API_ORIGIN = new URL(ANILIST_API_URL).origin;

function parseRetryAfterMs(value: string | null, now: number): number {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Number.isSafeInteger(seconds * 1000) ? Math.max(0, seconds * 1000) : 0;
  }
  const date = Date.parse(value);
  return Number.isNaN(date) ? 0 : Math.max(0, date - now);
}

/** Pauses the whole queue when AniList says to back off (429 or no remaining quota). */
async function noteRateLimitHeaders(headers: Headers, status: number): Promise<void> {
  const now = Date.now();
  let waitMs = parseRetryAfterMs(headers.get('retry-after'), now);
  if (!waitMs && (status === 429 || headers.get('x-ratelimit-remaining') === '0')) {
    const resetSeconds = Number(headers.get('x-ratelimit-reset'));
    waitMs =
      resetSeconds > 0 && Number.isSafeInteger(resetSeconds * 1000)
        ? Math.max(0, resetSeconds * 1000 - now)
        : 0;
    if (!Number.isFinite(waitMs) || waitMs <= 0) waitMs = 60_000;
  }
  await getAnilistThrottle().pause(waitMs);
}

const anilistFetchImplementation: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  try {
    await noteRateLimitHeaders(response.headers, response.status);
  } catch (error) {
    await response.body?.cancel();
    throw error;
  }
  return response;
};

export function requireAnilistField<T>(value: T | null | undefined, field: string): T {
  if (value == null) {
    throw Object.assign(new Error(`AniList response missing ${field}`), { statusCode: 502 });
  }
  return value;
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

  try {
    const data = await fetchWithRetry<
      T & { data?: unknown; errors?: Array<{ status?: number; message?: string }> }
    >(
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
        beforeAttempt: (signal) => getAnilistThrottle().acquire(signal),
        onRateLimited: (_response, attempt) =>
          log.warn('AniList rate limited', { statusCode: 429, attempt }),
        // The shared admission gate owns the complete cooldown, including retry attempts.
        getRetryDelayMs: () => 0,
      }
    );
    if (
      !data ||
      typeof data !== 'object' ||
      (data.errors !== undefined && !Array.isArray(data.errors))
    ) {
      throw Object.assign(new Error('Invalid AniList GraphQL response'), { statusCode: 502 });
    }
    if (data.errors?.length) {
      const statusCode =
        data.errors.find(
          (error) =>
            typeof error?.status === 'number' &&
            Number.isInteger(error.status) &&
            error.status >= 400 &&
            error.status <= 599
        )?.status ?? 502;
      if (statusCode === 429) await getAnilistThrottle().pause(60_000);
      throw Object.assign(new Error('AniList GraphQL response contains errors'), { statusCode });
    }
    requireAnilistField(data.data, 'data');
    if (typeof data.data !== 'object') {
      throw Object.assign(new Error('Invalid AniList GraphQL data'), { statusCode: 502 });
    }
    circuitBreaker.recordSuccess();
    return data;
  } catch (err) {
    if (shouldRecordCircuitFailure(err)) circuitBreaker.recordFailure();
    throw err;
  }
}
