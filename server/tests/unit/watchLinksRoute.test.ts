import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import express from 'express';
import { createServer } from 'node:http';
import { once } from 'node:events';
import request from 'supertest';

vi.hoisted(() => {
  process.env.CACHE_DRIVER = 'memory';
  process.env.DATABASE_DRIVER = 'memory';
  process.env.REDIS_URL = '';
});

vi.mock('../../src/services/configService.ts', () => ({
  getUserConfig: vi.fn(),
  getApiKeyFromConfig: (config: unknown) => (config ? 'test-api-key' : null),
}));

vi.mock('../../src/services/tmdb/client.ts', () => ({
  tmdbFetch: vi.fn(),
  validateApiKey: vi.fn(),
  validateApiKeyCached: vi.fn(async () => ({ valid: true })),
  isInvalidApiKeyError: (error: { invalidApiKey?: boolean }) => error?.invalidApiKey === true,
}));

import { addonRouter } from '../../src/routes/addon.ts';
import { getUserConfig } from '../../src/services/configService.ts';
import { tmdbFetch } from '../../src/services/tmdb/client.ts';
import type { UserConfig } from '../../src/types/config.ts';

const config: UserConfig = {
  userId: 'watch-links-route-test',
  catalogs: [
    {
      _id: 'included',
      name: 'Included',
      type: 'movie',
      filters: { watchRegion: 'US', watchProviders: [8], watchMonetizationTypes: ['flatrate'] },
    },
  ],
  preferences: { enableWatchLinks: true },
};

const app = express();
app.use(addonRouter);
const server = createServer(app);
beforeAll(async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
});
afterAll(
  () =>
    new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    })
);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getUserConfig).mockResolvedValue(structuredClone(config));
  vi.mocked(tmdbFetch).mockResolvedValue({
    id: 123,
    results: { US: { flatrate: [{ provider_id: 8, provider_name: 'Netflix' }] } },
  });
});

it('serves classified viewing links through the configured Stremio stream route', async () => {
  const response = await request(server).get('/watch-links-route-test/stream/movie/tmdb:123.json');
  expect(response.status).toBe(200);
  expect(response.body.streams[0].name).toBe('INCLUDED · Netflix');
  expect(response.body.streams[0].externalUrl).toBe(
    'https://www.themoviedb.org/movie/123/watch?locale=US'
  );
  expect(response.body.cacheMaxAge).toBe(300);
  expect(response.headers['cache-control']).toBe('public, max-age=300');
  expect(response.text).not.toContain('test-api-key');
});

it('keeps the feature disabled for existing configurations', async () => {
  vi.mocked(getUserConfig).mockResolvedValue({ ...config, preferences: {} });
  const response = await request(server).get('/watch-links-route-test/stream/movie/tmdb:123.json');
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ streams: [], cacheMaxAge: 0 });
  expect(tmdbFetch).not.toHaveBeenCalled();
});

it('does not turn malformed IDs into upstream paths', async () => {
  const response = await request(server).get(
    '/watch-links-route-test/stream/movie/tmdb%3A123%2Fexternal_ids.json'
  );
  expect(response.status).toBe(200);
  expect(response.body.streams).toEqual([]);
  expect(tmdbFetch).not.toHaveBeenCalled();
});

it('does not serve viewing options for a missing configuration', async () => {
  vi.mocked(getUserConfig).mockResolvedValue(null);
  const response = await request(server).get('/missing-configuration/stream/movie/tmdb:123.json');
  expect(response.status).toBe(404);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(tmdbFetch).not.toHaveBeenCalled();
});

it('does not cache a lookup outage as missing or included availability', async () => {
  vi.mocked(tmdbFetch).mockRejectedValue(new Error('TMDB temporarily unavailable'));
  const response = await request(server).get('/watch-links-route-test/stream/movie/tmdb:123.json');
  expect(response.status).toBe(200);
  expect(response.body.streams[0].name).toBe('CHECK · Where to watch');
  expect(response.body.cacheMaxAge).toBe(0);
  expect(response.headers['cache-control']).toBe('no-store');
});

it('retains the existing invalid-key response', async () => {
  vi.mocked(tmdbFetch).mockRejectedValue(
    Object.assign(new Error('Invalid API key'), { invalidApiKey: true })
  );
  const response = await request(server).get('/watch-links-route-test/stream/movie/tmdb:123.json');
  expect(response.status).toBe(401);
  expect(response.headers['cache-control']).toBe('no-store');
});
