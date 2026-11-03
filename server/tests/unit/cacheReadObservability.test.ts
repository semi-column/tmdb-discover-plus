import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { CacheWrapper } from '../../src/services/cache/CacheWrapper.ts';
import { cacheReadLayer } from '../../src/services/cache/keys.ts';
import {
  getRequestCacheStats,
  getRequestLiveState,
  requestIdMiddleware,
} from '../../src/utils/requestContext.ts';
import { FailingCacheAdapter, MockCacheAdapter } from './helpers/mocks.ts';

describe('bounded cache read layers', () => {
  it.each([
    ['catalog:user:private-query', 'addon_response'],
    ['meta:full:private-hash', 'addon_response'],
    ['catalog-imdb:movie:private', 'addon_response'],
    ['anilist:catalog:private', 'addon_response'],
    ['mal:catalog:private', 'addon_response'],
    ['kitsu:catalog:private', 'addon_response'],
    ['simkl:catalog:private', 'addon_response'],
    ['tmdb:api-key-status:private', 'key_validation'],
    ['https://api.themoviedb.org/3/movie/1?api_key=SECRET', 'tmdb_api'],
    ['https://api.themoviedb.org/3/tv/1/season/2?api_key=SECRET', 'seasons'],
    ['season_1_2_en', 'seasons'],
    ['https://api.themoviedb.org/3/genre/movie/list?api_key=SECRET', 'tmdb_reference'],
    ['https://api.themoviedb.org/3/configuration?api_key=SECRET', 'tmdb_reference'],
    ['tmdb_watch_providers_movie_US', 'tmdb_reference'],
    ['tmdb_languages_v2', 'tmdb_reference'],
    ['logos_movie_1', 'artwork'],
    ['rpdb_rating_tt1', 'artwork'],
    ['external_ids_movie_1', 'id_lookup'],
    ['find_neg_tt1_movie', 'id_lookup'],
    ['imdb:/search?private', 'imdb'],
    ['imdb:fresh:/search?private', 'imdb_freshness'],
    ['anime-id-map:full-list', 'anime'],
    ['total_pages:/discover/movie:private', 'discovery'],
    ['geo_cities_private', 'other'],
    ['unknown-private-cache-key', 'other'],
  ])('classifies %s without retaining its contents', (key, layer) => {
    expect(cacheReadLayer(key)).toBe(layer);
  });
});

it('records each read once, separates error reads from writes, and preserves existing counters', async () => {
  const adapter = new MockCacheAdapter();
  const cache = new CacheWrapper(adapter);
  const read = vi.spyOn(adapter, 'get');
  const entry = (age: number) => ({
    __cacheWrapper: true,
    __storedAt: Date.now() - age,
    __ttl: 100,
    data: 'data',
  });
  adapter.store.set('meta:full:fresh', entry(0));
  adapter.store.set('meta:full:stale', entry(150_000));
  adapter.store.set('meta:full:expired', entry(250_000));
  adapter.store.set('meta:full:cached-error', { ...entry(0), __errorType: 'NOT_FOUND' });
  adapter.store.set('meta:full:malformed', { __cacheWrapper: true });
  adapter.store.set('unwrapped-private', { data: 'present' });
  const failing = new CacheWrapper(new FailingCacheAdapter());
  const app = express();
  app.use(requestIdMiddleware());
  app.get('/', async (_req, res) => {
    for (const key of ['fresh', 'stale', 'expired', 'cached-error', 'malformed', 'missing']) {
      await cache.getEntry(`meta:full:${key}`);
    }
    await cache.get('unwrapped-private');
    await failing.get('tmdb:api-key-status:SECRET');
    await failing.set('write-failure', 'data', 100);
    res.json({ reads: getRequestLiveState()?.cacheReads, old: getRequestCacheStats() });
  });
  const result = await request(app).get('/').expect(200);
  expect(result.body.reads).toEqual({
    addon_response: { freshHits: 1, staleHits: 1, misses: 2, cachedErrors: 1, readErrors: 1 },
    other: { freshHits: 1, staleHits: 0, misses: 0, cachedErrors: 0, readErrors: 0 },
    key_validation: { freshHits: 0, staleHits: 0, misses: 0, cachedErrors: 0, readErrors: 1 },
  });
  expect(result.body.old).toMatchObject({ hits: 3, misses: 2, errors: 4 });
  expect(read).toHaveBeenCalledTimes(7);
  expect(JSON.stringify(result.body.reads)).not.toMatch(/SECRET|private|malformed|meta:full/);
});
