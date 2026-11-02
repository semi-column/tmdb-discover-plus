import { describe, expect, it, vi } from 'vitest';

import { fetchWithRetry } from '../../src/services/common/fetchWithRetry.ts';

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
