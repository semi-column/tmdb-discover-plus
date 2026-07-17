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
  /** Optional fetch implementation for providers that require a specific HTTP client. */
  fetchImplementation?: typeof fetch;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Shared fetch-with-retry loop for provider API clients: retries on network
 * errors and non-ok responses with exponential backoff, and separately
 * handles rate-limit responses by waiting and retrying without consuming an
 * error. Does not manage circuit breaker state — callers should record
 * success/failure around this call.
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
    fetchImplementation = fetch,
  } = config;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await fetchImplementation(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (isRateLimited(response.status)) {
        onRateLimited?.(response, attempt);
        const delayMs = getRetryDelayMs
          ? getRetryDelayMs(response, attempt)
          : backoffBaseMs * Math.pow(2, attempt);
        await sleep(delayMs);
        continue;
      }

      if (!response.ok) {
        const message = includeResponseBodyInError
          ? `${providerName} API error: ${response.status} ${await response.text().catch(() => '')}`
          : `${providerName} API error: ${response.status}`;
        throw Object.assign(new Error(message), { statusCode: response.status });
      }

      return (await response.json()) as T;
    } catch (err) {
      lastError = err as Error;
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode !== undefined && isRateLimited(statusCode)) continue;
      if (attempt < maxAttempts - 1) {
        await sleep(backoffBaseMs * Math.pow(2, attempt));
      }
    }
  }

  throw lastError || new Error(`${providerName} API request failed`);
}
