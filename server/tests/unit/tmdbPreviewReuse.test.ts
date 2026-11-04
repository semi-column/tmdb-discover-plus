import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CacheWrapper } from '../../src/services/cache/CacheWrapper.ts';
import { MockCacheAdapter } from './helpers/mocks.ts';
import { startOpportunisticWork } from '../../src/utils/requestContext.ts';

const flags = vi.hoisted(() => ({
  demandFirst: true,
  backgroundPriority: true,
  disableRateLimit: false,
}));
let cache: CacheWrapper;
vi.mock('../../src/config.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/config.ts')>();
  return { ...actual, config: { ...actual.config, features: flags } };
});
vi.mock('../../src/services/cache/index.ts', () => ({ getCache: () => cache }));
vi.mock('../../src/infrastructure/tmdbThrottle.ts', () => ({
  getTmdbThrottle: () => ({
    acquire: vi.fn().mockResolvedValue(undefined),
    notifyRateLimited: vi.fn(),
  }),
  RATE_LIMITER_TIMEOUT_CODE: 'RATE_LIMITER_TIMEOUT',
}));

import {
  batchGetPreviewDetails,
  getDetails,
  getPreviewDetails,
} from '../../src/services/tmdb/details.ts';
import { resetCircuitBreaker, validateApiKey } from '../../src/services/tmdb/client.ts';

const details = {
  id: 550,
  title: 'Example',
  release_date: '2020-01-01',
  external_ids: { imdb_id: 'tt1234567' },
  credits: { cast: [], crew: [] },
  images: { logos: [] },
};

beforeEach(() => {
  cache = new CacheWrapper(new MockCacheAdapter());
  flags.demandFirst = true;
  resetCircuitBreaker();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(details), { status: 200 }))
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TMDB preview reuse', () => {
  it('uses already-cached full details without another provider request', async () => {
    const full = await getDetails('key', 550, 'movie', { language: 'en' });
    const preview = await getPreviewDetails('key', 550, 'movie', { language: 'en' });

    expect(preview).toEqual(full);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('fetches only preview data on a miss and keeps languages separate', async () => {
    await getDetails('key', 550, 'movie', { language: 'en' });
    await getPreviewDetails('key', 550, 'movie', { language: 'fr' });

    const requests = vi.mocked(globalThis.fetch).mock.calls;
    expect(requests).toHaveLength(2);
    const url = new URL(String(requests[1][0]));
    expect(url.searchParams.get('language')).toBe('fr');
    expect(url.searchParams.get('include_image_language')).toBe('fr,en,null');
    expect(url.searchParams.get('append_to_response')).toBe('external_ids,credits,images');
  });

  it('can disable full-detail reuse without fetching extra full data', async () => {
    flags.demandFirst = false;
    await getDetails('key', 550, 'movie', { language: 'en' });
    await getPreviewDetails('key', 550, 'movie', { language: 'en' });
    const calls = vi.mocked(globalThis.fetch).mock.calls;
    expect(calls).toHaveLength(2);
    expect(new URL(String(calls[1][0])).searchParams.get('append_to_response')).toBe(
      'external_ids,credits,images'
    );
  });

  it('limits background preview detail fanout without changing foreground behavior', async () => {
    const gate = Promise.withResolvers<void>();
    vi.mocked(globalThis.fetch).mockImplementationOnce(async () => {
      await gate.promise;
      return new Response(JSON.stringify(details), { status: 200 });
    });
    const background = startOpportunisticWork(() =>
      batchGetPreviewDetails('key', [550, 551], 'movie', { displayLanguage: 'en' })
    )!;
    try {
      await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));
      gate.resolve();
      expect((await background.promise).size).toBe(2);
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    } finally {
      gate.resolve();
    }
  });

  it('does not use a cached full response missing preview fields', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 550 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(details), { status: 200 }));

    await getDetails('key', 550, 'movie', { language: 'en' });
    expect(await getPreviewDetails('key', 550, 'movie', { language: 'en' })).toEqual(details);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('does not let a rejected API key use cached full details', async () => {
    await getDetails('valid-key', 550, 'movie', { language: 'en' });
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ status_code: 7, status_message: 'Invalid API key' }), {
        status: 401,
      })
    );
    expect(await validateApiKey('rejected-preview-key')).toMatchObject({
      valid: false,
      invalidApiKey: true,
    });

    await expect(
      getPreviewDetails('rejected-preview-key', 550, 'movie', { language: 'en' })
    ).rejects.toMatchObject({ statusCode: 401, invalidApiKey: true });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
});
