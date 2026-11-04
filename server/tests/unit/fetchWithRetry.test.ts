import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchWithRetry } from '../../src/services/common/fetchWithRetry.ts';
import { shouldRecordCircuitFailure } from '../../src/services/common/circuitBreaker.ts';
import { withRequestAbortContext } from '../../src/utils/requestContext.ts';
import { TIMEOUTS } from '../../src/constants.ts';

const options = {
  providerName: 'Fixture',
  timeoutMs: 1000,
  allowedOrigins: ['https://fixture.test'],
};
const url = 'https://fixture.test/media';
const ok = () => new Response('{"complete":true}');

describe('provider retry contract', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each([400, 401, 403, 404, 422])('does not retry deterministic HTTP %i', async (status) => {
    const fetch = vi.fn(async () => new Response('rejected', { status }));
    vi.stubGlobal('fetch', fetch);
    await expect(fetchWithRetry(url, {}, options)).rejects.toMatchObject({ statusCode: status });
    expect(fetch).toHaveBeenCalledOnce();
    expect(shouldRecordCircuitFailure({ statusCode: status })).toBe(false);
  });

  it('admits each transient retry once', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 500 }))
      .mockImplementation(ok);
    const beforeAttempt = vi.fn(async () => {});
    vi.stubGlobal('fetch', fetch);
    const work = fetchWithRetry(url, {}, { ...options, beforeAttempt });
    await vi.advanceTimersByTimeAsync(300);
    await expect(work).resolves.toEqual({ complete: true });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(beforeAttempt).toHaveBeenCalledTimes(2);
  });

  it('retains terminal quota status without sleeping after the final attempt', async () => {
    const fetch = vi.fn(async () => new Response('', { status: 429 }));
    vi.stubGlobal('fetch', fetch);
    const result = fetchWithRetry(url, {}, options).catch((error) => error);
    await vi.advanceTimersByTimeAsync(900);
    expect(await result).toMatchObject({ statusCode: 429, rateLimitExhausted: true });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves Simkl 503 quota handling', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockImplementation(ok);
    const onRateLimited = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const work = fetchWithRetry(
      url,
      {},
      { ...options, isRateLimited: (status) => status === 429 || status === 503, onRateLimited }
    );
    await vi.advanceTimersByTimeAsync(300);
    await expect(work).resolves.toEqual({ complete: true });
    expect(onRateLimited).toHaveBeenCalledOnce();
  });

  it('aborts a retry wait and sends no further attempt', async () => {
    const controller = new AbortController();
    const fetch = vi.fn(async () => new Response('', { status: 500 }));
    vi.stubGlobal('fetch', fetch);
    const result = fetchWithRetry(url, { signal: controller.signal }, options).catch(
      (error) => error
    );
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    expect(await result).toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('propagates cancellation to active transport', async () => {
    const controller = new AbortController();
    const fetch = vi.fn(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
        })
    );
    vi.stubGlobal('fetch', fetch);
    const result = fetchWithRetry(url, { signal: controller.signal }, options).catch(
      (error) => error
    );
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    expect(await result).toMatchObject({ name: 'AbortError' });
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('does not retry failed admission or malformed JSON', async () => {
    const fetch = vi.fn(async () => new Response('not-json'));
    vi.stubGlobal('fetch', fetch);
    await expect(
      fetchWithRetry(
        url,
        {},
        {
          ...options,
          beforeAttempt: async () => {
            throw new Error('admission unavailable');
          },
        }
      )
    ).rejects.toThrow('admission unavailable');
    expect(fetch).not.toHaveBeenCalled();
    await expect(fetchWithRetry(url, {}, options)).rejects.toBeInstanceOf(SyntaxError);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('rejects malformed quota delays instead of spinning', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 429 }))
    );
    await expect(
      fetchWithRetry(url, {}, { ...options, getRetryDelayMs: () => NaN })
    ).rejects.toThrow('invalid retry delay');
  });

  it('sends no transport when admission consumes the remaining deadline', async () => {
    const fetchImplementation = vi.fn();
    await expect(
      withRequestAbortContext(() =>
        fetchWithRetry(
          url,
          {},
          {
            ...options,
            fetchImplementation,
            beforeAttempt: async () => {
              vi.setSystemTime(Date.now() + TIMEOUTS.REQUEST_MS);
            },
          }
        )
      )
    ).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it.each([Infinity, NaN, -1])('rejects invalid timeout %s before transport', async (timeoutMs) => {
    const fetchImplementation = vi.fn();
    await expect(
      fetchWithRetry(url, {}, { ...options, timeoutMs, fetchImplementation })
    ).rejects.toThrow('Invalid provider retry configuration');
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});

describe('fetchWithRetry outbound URL guard', () => {
  it('rejects non-HTTPS URLs before fetch', async () => {
    const fetchImplementation = vi.fn();

    await expect(
      fetchWithRetry(
        'http://api.example.com/items',
        {},
        {
          providerName: 'Example',
          timeoutMs: 1000,
          fetchImplementation,
        }
      )
    ).rejects.toThrow('Example API URL must use HTTPS');

    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('rejects URLs outside the allowed origin before fetch', async () => {
    const fetchImplementation = vi.fn();

    await expect(
      fetchWithRetry(
        'https://evil.example/items',
        {},
        {
          providerName: 'Example',
          timeoutMs: 1000,
          allowedOrigins: ['https://api.example.com'],
          fetchImplementation,
        }
      )
    ).rejects.toThrow('Disallowed Example API URL origin');

    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});

describe('fetchWithRetry rate-limit budget', () => {
  it('fails fast instead of sleeping past the parent request timeout', async () => {
    const { requestIdMiddleware } = await import('../../src/utils/requestContext.ts');
    const fetchImplementation = vi.fn(async () => new Response('', { status: 429 }));
    const getRetryDelayMs = vi.fn(() => 60_000);

    const result = await new Promise<unknown>((resolve) => {
      requestIdMiddleware()({ headers: {} } as any, { setHeader: () => {} } as any, () => {
        fetchWithRetry(
          'https://api.example.com/items',
          {},
          { providerName: 'Example', timeoutMs: 1000, getRetryDelayMs, fetchImplementation }
        ).then(resolve, resolve);
      });
    });

    expect(result).toMatchObject({
      message: 'Example API rate limited',
      statusCode: 429,
      rateLimitExhausted: true,
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });
});
