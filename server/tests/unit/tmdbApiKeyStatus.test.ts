import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cacheMocks = vi.hoisted(() => ({
  getEntry: vi.fn(),
  set: vi.fn(),
}));

vi.mock('../../src/services/cache/index.ts', () => ({
  getCache: () => cacheMocks,
}));

vi.mock('../../src/infrastructure/tmdbThrottle.ts', () => ({
  getTmdbThrottle: () => ({
    acquire: vi.fn().mockResolvedValue(undefined),
    notifyRateLimited: vi.fn(),
  }),
  RATE_LIMITER_TIMEOUT_CODE: 'RATE_LIMITER_TIMEOUT',
}));

import { validateApiKey, validateApiKeyCached } from '../../src/services/tmdb/client.ts';
import { computeApiKeyId } from '../../src/utils/security.ts';

describe('TMDB API key validation', () => {
  beforeEach(() => {
    cacheMocks.getEntry.mockResolvedValue(null);
    cacheMocks.set.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('checks TMDB directly instead of trusting the shared response cache', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ images: {} }),
      })
    );

    await expect(validateApiKey('valid-key')).resolves.toEqual({ valid: true });

    expect(cacheMocks.getEntry).not.toHaveBeenCalled();
    expect(cacheMocks.set).toHaveBeenCalledWith(
      `tmdb:api-key-status:${await computeApiKeyId('valid-key')}`,
      'valid',
      60
    );
  });

  it('shares confirmed invalid-key status across requests', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          status_code: 7,
          status_message: 'Invalid API key',
        }),
      })
    );

    await expect(validateApiKey('invalid-key')).resolves.toMatchObject({
      valid: false,
      invalidApiKey: true,
    });
    expect(cacheMocks.set).toHaveBeenCalledWith(
      `tmdb:api-key-status:${await computeApiKeyId('invalid-key')}`,
      'invalid',
      60
    );

    cacheMocks.getEntry.mockResolvedValue({
      __cacheWrapper: true,
      __storedAt: Date.now(),
      __ttl: 60,
      data: 'invalid',
    });
    const fetch = vi.mocked(globalThis.fetch);

    await expect(validateApiKeyCached('invalid-key')).resolves.toMatchObject({
      valid: false,
      invalidApiKey: true,
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('does not mistake unrelated authorization failures for an invalid key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          status_code: 3,
          status_message: 'Authentication failed',
        }),
      })
    );

    const result = await validateApiKey('unavailable-key');
    expect(result).toMatchObject({
      valid: false,
      unavailable: true,
    });
    expect(result).not.toHaveProperty('invalidApiKey');
    expect(cacheMocks.set).not.toHaveBeenCalled();
  });
});
