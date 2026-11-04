import { TIMEOUTS } from '../../constants.ts';
import { getRequestRemainingMs, getRequestSignal } from '../../utils/requestContext.ts';
import { admissionDelay } from '../../infrastructure/sharedAdmission.ts';

export interface FetchWithRetryConfig {
  /** Provider name used in generated error messages, e.g. "AniList API error: 500". */
  providerName: string;
  /** AbortSignal timeout (ms) applied to every attempt. */
  timeoutMs: number;
  /** Total attempts before giving up (default 3). */
  maxAttempts?: number;
  /** Base delay (ms) for the exponential backoff applied between failed attempts: base * 2^attempt (default 300). */
  backoffBaseMs?: number;
  /** Returns true when a response status should be treated as a rate limit (wait + retry, not an error). Defaults to `status === 429`. */
  isRateLimited?: (status: number) => boolean;
  /** Computes how long to wait before retrying a rate-limited response. Defaults to the same exponential backoff used for other failures. */
  getRetryDelayMs?: (response: Response, attempt: number) => number;
  /** Called when a response is rate-limited, before waiting — typically used to log a provider-specific warning. */
  onRateLimited?: (response: Response, attempt: number) => void;
  /** Include the response body text in the thrown error message (default false). */
  includeResponseBodyInError?: boolean;
  /** Optional allowlist for outbound request origins, e.g. ['https://api.example.com']. */
  allowedOrigins?: readonly string[];
  /** Optional fetch implementation for providers that require a specific HTTP client. */
  fetchImplementation?: typeof fetch;
  /** Provider admission runs before the transport timeout, once for every attempt. */
  beforeAttempt?: (signal: AbortSignal) => Promise<void>;
}

/**
 * Retries transient transport/status failures, preserving provider-specific quota handling.
 */
export async function fetchWithRetry<T>(
  url: string,
  init: RequestInit,
  config: FetchWithRetryConfig
): Promise<T> {
  const {
    providerName,
    timeoutMs,
    maxAttempts = 3,
    backoffBaseMs = 300,
    isRateLimited = (status) => status === 429,
    getRetryDelayMs,
    onRateLimited,
    includeResponseBodyInError = false,
    allowedOrigins,
    fetchImplementation = fetch,
    beforeAttempt,
  } = config;

  if (
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1 ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0 ||
    !Number.isFinite(backoffBaseMs) ||
    backoffBaseMs < 0
  ) {
    throw new Error('Invalid provider retry configuration');
  }
  const requestUrl = new URL(url);
  if (requestUrl.protocol !== 'https:') {
    throw Object.assign(new Error(`${providerName} API URL must use HTTPS`), { statusCode: 400 });
  }
  if (requestUrl.username || requestUrl.password) {
    throw Object.assign(new Error(`${providerName} API URL must not include credentials`), {
      statusCode: 400,
    });
  }
  if (allowedOrigins && !allowedOrigins.includes(requestUrl.origin)) {
    throw Object.assign(new Error(`Disallowed ${providerName} API URL origin`), {
      statusCode: 400,
    });
  }

  const requestSignal = getRequestSignal();
  const signal = AbortSignal.any([
    ...(init.signal ? [init.signal] : []),
    ...(requestSignal ? [requestSignal] : []),
  ]);
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    signal.throwIfAborted();
    if (getRequestRemainingMs(TIMEOUTS.REQUEST_MS) <= 0) {
      throw new DOMException(`${providerName} request deadline exceeded`, 'TimeoutError');
    }
    // Admission failures are not transport failures and must not be retried.
    await beforeAttempt?.(signal);
    signal.throwIfAborted();
    if (getRequestRemainingMs(TIMEOUTS.REQUEST_MS) <= 0) {
      throw new DOMException(`${providerName} request deadline exceeded`, 'TimeoutError');
    }
    let delayMs = backoffBaseMs * Math.pow(2, attempt);
    try {
      // lgtm[js/request-forgery] URL is parsed above, restricted to HTTPS, stripped of credentials, and checked against caller-provided allowed origins.
      const response = await fetchImplementation(requestUrl.toString(), {
        ...init,
        signal: AbortSignal.any([
          signal,
          AbortSignal.timeout(
            Math.max(1, Math.min(timeoutMs, getRequestRemainingMs(TIMEOUTS.REQUEST_MS)))
          ),
        ]),
      });

      if (isRateLimited(response.status)) {
        onRateLimited?.(response, attempt);
        delayMs = getRetryDelayMs
          ? getRetryDelayMs(response, attempt)
          : backoffBaseMs * Math.pow(2, attempt);
        await response.body?.cancel();
        lastError = Object.assign(new Error(`${providerName} API rate limited`), {
          statusCode: response.status,
          rateLimitExhausted: true,
        });
      } else if (!response.ok) {
        const message = includeResponseBodyInError
          ? `${providerName} API error: ${response.status} ${await response.text()}`
          : `${providerName} API error: ${response.status}`;
        if (!includeResponseBodyInError) await response.body?.cancel();
        throw Object.assign(new Error(message), { statusCode: response.status });
      } else {
        const data = (await response.json()) as T;
        signal.throwIfAborted();
        return data;
      }
    } catch (err) {
      signal.throwIfAborted();
      lastError = err;
      const statusCode =
        err && typeof err === 'object' && 'statusCode' in err ? err.statusCode : undefined;
      if (
        err instanceof SyntaxError ||
        (err &&
          typeof err === 'object' &&
          'code' in err &&
          err.code === 'SHARED_ADMISSION_UNAVAILABLE') ||
        (typeof statusCode === 'number' && statusCode < 500)
      ) {
        throw err;
      }
    }
    if (attempt === maxAttempts - 1) break;
    if (!Number.isFinite(delayMs) || delayMs < 0) {
      throw new Error(`${providerName} returned an invalid retry delay`, { cause: lastError });
    }
    if (delayMs >= getRequestRemainingMs(TIMEOUTS.REQUEST_MS)) throw lastError;
    await admissionDelay(delayMs, signal);
  }

  throw lastError;
}
