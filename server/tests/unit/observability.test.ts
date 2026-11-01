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
import { createLogger, setLogSink } from '../../src/utils/logger.ts';
import {
  liveOverview,
  liveUpstreams,
  histPercentile,
  previousRangeIfRetained,
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

describe('previousRangeIfRetained', () => {
  const now = Date.UTC(2026, 10, 1);

  it('returns a previous window when it fits inside retention', () => {
    const range = { from: now - 6 * 60 * 60_000, to: now, kind: 'm' as const };
    expect(previousRangeIfRetained(range, 7, now)).toEqual({
      from: now - 12 * 60 * 60_000,
      to: range.from - 1,
      kind: 'm',
    });
  });

  it('returns no comparison when the previous window predates retention', () => {
    const range = { from: now - 7 * 86_400_000, to: now, kind: 'h' as const };
    expect(previousRangeIfRetained(range, 7, now)).toBeNull();
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

  it('keeps HTTP status classes separate in error fingerprints', () => {
    const notFound = computeFingerprint(
      'error',
      'tmdb',
      'Fetch failed',
      'Request rejected',
      '',
      'http:404'
    );
    const serverError = computeFingerprint(
      'error',
      'tmdb',
      'Fetch failed',
      'Request rejected',
      '',
      'http:500'
    );

    expect(notFound).not.toBe(serverError);
  });

  it('preserves a secret-scrubbed stack for the observability sink', () => {
    let captured: Record<string, unknown> | null = null;
    const error = new Error('Request failed');
    error.stack =
      'Error: api_key=secret-value\n    at handle (/app/server/src/routes/addon.ts:10:2)';
    setLogSink((_level, _context, _message, data) => {
      captured = data;
    });

    try {
      createLogger('observability-test').error('Request failed', { error });
    } finally {
      setLogSink(null);
    }

    const safeError = captured?.error as { stack?: string } | undefined;
    expect(safeError?.stack).toContain('routes/addon.ts');
    expect(safeError?.stack).not.toContain('secret-value');
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
    expect(overview.totalsResolution).toBe('minute');
    expect(overview.breakdownResolution).toBe('hour');
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

  it('counts storage-cap omissions while retaining aggregated error groups', async () => {
    const collector = new Collector({
      sampleRate: 1,
      slowMs: 1500,
      maxBuffer: 100,
      hourTtlSec: 3600,
    });
    const history = {
      kind: 'memory',
      isPaused: () => true,
      insertRequests: vi.fn().mockResolvedValue(undefined),
      insertUpstream: vi.fn().mockResolvedValue(undefined),
      insertErrors: vi.fn().mockResolvedValue(undefined),
      insertSystem: vi.fn().mockResolvedValue(undefined),
    };
    collector.setHistory(history as any);
    const now = Date.now();
    collector.recordRequest({ ...base, ts: now, status: 200, durationMs: 40 });
    collector.recordUpstream({
      ts: now,
      requestId: 'r1',
      instance: 'i1',
      provider: 'tmdb',
      host: 'api.themoviedb.org',
      method: 'GET',
      path: '/3/movie/:id',
      status: 200,
      durationMs: 40,
      error: '',
      timedOut: false,
    });
    collector.recordError({
      ts: now,
      fingerprint: 'fp1',
      level: 'error',
      context: 'tmdb:client',
      message: 'boom',
      stack: '',
      requestId: 'r1',
      instance: 'i1',
      route: '/meta',
    });
    collector.recordSystem({ ts: now, instance: 'i1', data: {} });

    expect(collector.stats.dropped.storageCap).toBe(4);
    await collector.flush();

    expect(history.insertRequests).not.toHaveBeenCalled();
    expect(history.insertUpstream).not.toHaveBeenCalled();
    expect(history.insertSystem).not.toHaveBeenCalled();
    expect(history.insertErrors.mock.calls[0][0]).toEqual([]);
    expect(history.insertErrors.mock.calls[0][1].get('fp1').count).toBe(1);
  });

  it('reports failed history batches separately from omitted raw records', async () => {
    const collector = new Collector({
      sampleRate: 1,
      slowMs: 1500,
      maxBuffer: 100,
      hourTtlSec: 3600,
    });
    const history = {
      kind: 'postgres',
      isPaused: () => false,
      insertRequests: vi.fn().mockRejectedValue(new Error('database unavailable')),
      insertUpstream: vi.fn().mockResolvedValue(undefined),
      insertErrors: vi.fn().mockResolvedValue(undefined),
      insertSystem: vi.fn().mockResolvedValue(undefined),
    };
    collector.setHistory(history as any);
    collector.recordRequest({ ...base, ts: Date.now(), status: 200, durationMs: 40 });

    await collector.flush();

    expect(collector.stats.failedWrites).toMatchObject({ historyBatches: 1, historyRecords: 1 });
    expect(collector.stats.dropped.requests).toBe(0);
    expect(collector.stats.lastFlushError).toContain('database unavailable');
  });

  it('clears the last flush error after a successful recovery flush', async () => {
    const collector = new Collector({
      sampleRate: 1,
      slowMs: 1500,
      maxBuffer: 100,
      hourTtlSec: 3600,
    });
    const history = {
      kind: 'postgres',
      isPaused: () => false,
      insertRequests: vi
        .fn()
        .mockRejectedValueOnce(new Error('database unavailable'))
        .mockResolvedValue(undefined),
      insertUpstream: vi.fn().mockResolvedValue(undefined),
      insertErrors: vi.fn().mockResolvedValue(undefined),
      insertSystem: vi.fn().mockResolvedValue(undefined),
    };
    collector.setHistory(history as any);

    collector.recordRequest({ ...base, ts: Date.now(), status: 200, durationMs: 40 });
    await collector.flush();
    expect(collector.stats.lastFlushError).toContain('database unavailable');

    collector.recordRequest({
      ...base,
      ts: Date.now(),
      requestId: 'r2',
      status: 200,
      durationMs: 40,
    });
    await collector.flush();
    expect(collector.stats.lastFlushError).toBe('');
  });

  it('counts capped live-tail and per-fingerprint error samples', () => {
    const collector = new Collector({
      sampleRate: 1,
      slowMs: 1500,
      maxBuffer: 500,
      hourTtlSec: 3600,
    });
    const now = Date.now();
    for (let i = 0; i <= 200; i++) {
      collector.recordRequest({ ...base, ts: now + i, status: 200, durationMs: 40 });
    }
    for (let i = 0; i <= 50; i++) {
      collector.recordError({
        ts: now + i,
        fingerprint: 'same-error',
        level: 'error',
        context: 'tmdb:client',
        message: 'boom',
        stack: '',
        requestId: `r${i}`,
        instance: 'i1',
        route: '/meta',
      });
    }

    expect(collector.stats.dropped.tail).toBe(1);
    expect(collector.stats.dropped.sampledErrors).toBe(1);
  });
});
