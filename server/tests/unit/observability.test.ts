import { describe, it, expect } from 'vitest';
import { describePath } from '../../src/services/observability/routeInfo.ts';
import {
  computeFingerprint,
  normalizeMessage,
  topAppFrame,
} from '../../src/services/observability/errors.ts';
import { classifyClient } from '../../src/services/observability/identity.ts';
import {
  providerForHost,
  templateUpstreamPath,
} from '../../src/services/observability/upstream.ts';
import { Collector, latencyBucket } from '../../src/services/observability/collector.ts';
import { MemoryLiveStore } from '../../src/services/observability/liveStore.ts';
import {
  liveOverview,
  liveUpstreams,
  histPercentile,
} from '../../src/services/observability/liveQueries.ts';

describe('describePath', () => {
  it('templates Stremio catalog paths and masks the config id', () => {
    const info = describePath('/AbC123xyz0/catalog/movie/anilist-abc/skip=20.json');
    expect(info.route).toBe('/:userId/catalog/:type/:catalogId/:extra.json');
    expect(info.path).toBe('/:user/catalog/movie/anilist-abc/skip=20.json');
    expect(info.source).toBe('anilist');
    expect(info.resource).toBe('catalog');
    expect(info.userId).toBe('AbC123xyz0');
    expect(info.path).not.toContain('AbC123xyz0');
  });

  it('defaults unprefixed catalogs to tmdb and detects meta id sources', () => {
    expect(describePath('/u/catalog/series/custom-1.json').source).toBe('tmdb');
    expect(describePath('/u/meta/movie/tt0111161.json').source).toBe('imdb');
    expect(describePath('/u/meta/series/kitsu:123.json').source).toBe('kitsu');
    expect(describePath('/u/manifest.json').route).toBe('/:userId/manifest.json');
  });

  it('masks user params on API routes using the Express template', () => {
    const info = describePath('/api/config/AbC123xyz0', '/api/config/:userId');
    expect(info.route).toBe('/api/config/:userId');
    expect(info.path).toBe('/api/config/:user');
  });

  it('collapses unmatched paths to one route', () => {
    expect(describePath('/wp-login.php', null).route).toBe('(unmatched)');
  });
});

describe('error fingerprints', () => {
  it('normalises volatile parts of messages', () => {
    expect(normalizeMessage('Fetch https://x.y/z?id=1 failed after 3 tries for tt12345')).toBe(
      'Fetch <url> failed after <n> tries for <imdb>'
    );
  });

  it('groups the same error with different ids together', () => {
    const a = computeFingerprint('error', 'tmdb', 'Movie 123 failed', 'timeout after 5000ms', '');
    const b = computeFingerprint('error', 'tmdb', 'Movie 987 failed', 'timeout after 8000ms', '');
    const c = computeFingerprint('error', 'imdb', 'Movie 987 failed', 'timeout after 8000ms', '');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('extracts the first app frame without line numbers', () => {
    const stack = [
      'Error: boom',
      '    at Object.run (/app/node_modules/x/index.js:1:1)',
      '    at handleCatalog (/app/server/src/routes/addon.ts:345:12)',
    ].join('\n');
    expect(topAppFrame(stack)).toBe('handleCatalog@routes/addon.ts');
  });
});

describe('client and upstream classification', () => {
  it('classifies user agents', () => {
    expect(classifyClient('')).toBe('No user-agent');
    expect(classifyClient('Mozilla/5.0 (Linux; Android 13) Stremio/1.6')).toBe('Stremio Android');
    expect(classifyClient('curl/8.1')).toBe('Bot / script');
    expect(classifyClient('Mozilla/5.0 (Windows NT 10.0)')).toBe('Browser');
  });

  it('maps hosts and strips query strings (and keys) from upstream paths', () => {
    expect(providerForHost('api.themoviedb.org')).toBe('tmdb');
    expect(providerForHost('graphql.anilist.co')).toBe('anilist');
    expect(templateUpstreamPath('/3/movie/550/credits?api_key=SECRET')).toBe(
      '/3/movie/:id/credits'
    );
  });
});

describe('collector + live store', () => {
  const base = {
    requestId: 'r1',
    instance: 'i1',
    method: 'GET',
    route: '/:userId/catalog/:type/:catalogId.json',
    path: '/:user/catalog/movie/x.json',
    resource: 'catalog',
    source: 'tmdb',
    contentType: 'movie',
    catalogId: 'x',
    userHash: 'u1',
    client: 'Browser',
    ua: 'Mozilla',
    country: 'IN',
    colo: 'MAA',
    ipHash: 'ip',
    cacheHits: 1,
    cacheMisses: 0,
    upstreamCalls: 0,
    upstreamMs: 0,
    errorFp: '',
  };

  it('aggregates requests and upstream calls into overview numbers', async () => {
    const collector = new Collector({
      sampleRate: 1,
      slowMs: 1000,
      maxBuffer: 100,
      hourTtlSec: 3600,
    });
    const live = new MemoryLiveStore();
    collector.setLiveStore(live);
    const now = Date.now();
    collector.recordRequest({ ...base, ts: now, status: 200, durationMs: 40 });
    collector.recordRequest({ ...base, ts: now, status: 500, durationMs: 1200, userHash: 'u2' });
    collector.recordUpstream({
      ts: now,
      requestId: 'r1',
      instance: 'i1',
      provider: 'tmdb',
      host: 'api.themoviedb.org',
      method: 'GET',
      path: '/3/movie/:id',
      status: 429,
      durationMs: 80,
      error: '',
      timedOut: false,
    });
    await collector.flush();

    const range = { from: now - 60_000, to: now, kind: 'm' as const };
    const overview = await liveOverview(live, range);
    expect(overview.totals.requests).toBe(2);
    expect(overview.totals.errors5xx).toBe(1);
    expect(overview.totals.slow).toBe(1);
    expect(overview.totals.uniqueUsers).toBe(2);
    expect(overview.breakdowns.countries[0]).toEqual({ key: 'IN', count: 2 });
    expect(overview.routes[0].errors5xx).toBe(1);

    const upstreams = await liveUpstreams(live, range);
    expect(upstreams[0]).toMatchObject({ provider: 'tmdb', calls: 1, rateLimited: 1 });

    expect((await live.readTail(10)).length).toBe(2);
  });

  it('computes bucketed percentiles', () => {
    expect(latencyBucket(5)).toBe(0);
    expect(latencyBucket(60_000)).toBe(11);
    expect(histPercentile([0, 0, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0], 0.95)).toBe(50);
    expect(histPercentile(new Array(12).fill(0), 0.5)).toBeNull();
  });
});
