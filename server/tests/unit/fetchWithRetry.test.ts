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
