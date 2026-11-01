import { describe, it, expect } from 'vitest';
import { MemoryHistory } from '../../src/services/observability/history/memory.ts';
import {
  parseErrorFilter,
  parseRequestFilter,
} from '../../src/services/observability/history/types.ts';
import { hashIdentifier } from '../../src/services/observability/identity.ts';
import { buildHistoryOverview } from '../../src/services/observability/history/overview.ts';
import type {
  ErrorEvent,
  RequestEvent,
  UpstreamEvent,
} from '../../src/services/observability/types.ts';

const now = Date.now();
const range = { from: now - 3_600_000, to: now + 1000, kind: 'm' as const };

function request(i: number, over: Partial<RequestEvent> = {}): RequestEvent {
  return {
    ts: now - 60_000 + i,
    requestId: `r${String(i).padStart(3, '0')}`,
    instance: 'i1',
    method: 'GET',
    route: '/:userId/catalog/:type/:catalogId.json',
    path: `/:user/catalog/movie/tmdb-${i}.json`,
    status: 200,
    durationMs: 10 * (i + 1),
    resource: 'catalog',
    source: 'tmdb',
    contentType: 'movie',
    catalogId: `tmdb-${i}`,
    userHash: hashIdentifier('user-a'),
    client: 'Browser',
    ua: 'Mozilla',
    country: '',
    colo: '',
    ipHash: '',
    cacheHits: 0,
    cacheMisses: 0,
    upstreamCalls: 0,
    upstreamMs: 0,
    errorFp: '',
    weight: 1,
    ...over,
  };
}

function errorEvent(fp: string, requestId = ''): ErrorEvent {
  return {
    ts: now,
    fingerprint: fp,
    level: 'error',
    context: 'tmdb:client',
    message: 'boom',
    stack: '',
    requestId,
    instance: 'i1',
    route: '/x',
  };
}

function upstream(status: number, durationMs: number, timedOut = false): UpstreamEvent {
  return {
    ts: now,
    requestId: `upstream-${status}`,
    instance: 'i1',
    provider: 'tmdb',
    host: 'api.themoviedb.org',
    method: 'GET',
    path: '/3/movie/:id',
    status,
    durationMs,
    error: '',
    timedOut,
  };
}

function newHistory(maxEvents = 100) {
  return new MemoryHistory({
    maxEvents,
    retentionDays: 7,
    version: '1.0.0',
    loadConfigs: async () => [],
  });
}

describe('MemoryHistory', () => {
  it('normalizes PostgreSQL route metrics for the dashboard', () => {
    const overview = buildHistoryOverview(
      range,
      [],
      [
        {
          route: '/:userId/meta/:type/:id.json',
          count: '5',
          errors5xx: '0',
          errors4xx: '2',
          avg_ms: 125,
          p95_ms: 250,
        },
      ],
      [],
      [],
      [],
      { errors: 0, warnings: 0 },
      1
    );

    expect(overview.routes[0]).toMatchObject({
      count: 5,
      errors5xx: 0,
      errors4xx: 2,
      avgMs: 125,
      p95Ms: 250,
    });
  });

  it('builds provider totals and endpoint detail from the same history window', async () => {
    const history = newHistory();
    await history.insertUpstream([
      upstream(200, 100),
      upstream(403, 40),
      upstream(429, 50),
      upstream(0, 1000, true),
    ]);

    const providers = await history.upstreamOverview(range);
    const endpoints = await history.upstreamEndpoints(range);
    const provider = providers[0];
    const endpoint = endpoints.endpoints[0];

    expect(provider).toMatchObject({ calls: 4, errors: 1, rateLimited: 1, timeouts: 1 });
    expect(provider.calls).toBe(endpoint.calls);
    expect(provider.errors).toBe(endpoint.errors);
    expect(endpoint.rejected).toBe(1);
    expect(provider.series.calls.reduce((sum, calls) => sum + calls, 0)).toBe(provider.calls);
  });

  it('keeps transport failures visible when 4xx samples are more frequent', async () => {
    const history = newHistory();
    await history.insertUpstream([
      ...Array.from({ length: 60 }, (_, i) => upstream(403, i + 1)),
      upstream(0, 1000, true),
      upstream(500, 900),
    ]);

    const { endpoints, recentErrors } = await history.upstreamEndpoints(range);

    expect(endpoints[0]).toMatchObject({ calls: 62, errors: 2, rejected: 60 });
    expect(recentErrors.some((event) => event.status === 0)).toBe(true);
    expect(recentErrors.some((event) => event.status === 500)).toBe(true);
    expect(recentErrors.filter((event) => event.status === 403)).toHaveLength(25);
  });

  it('filters, pages with a cursor, and caps memory', async () => {
    const h = newHistory(50);
    await h.insertRequests(
      Array.from({ length: 60 }, (_, i) => request(i, i === 59 ? { status: 503 } : {}))
    );

    const first = await h.listRequests(range, parseRequestFilter({}), 20);
    expect(first.rows).toHaveLength(20);
    expect(first.rows[0].request_id).toBe('r059');
    const second = await h.listRequests(
      range,
      parseRequestFilter({ cursor: first.nextCursor }),
      20
    );
    expect(second.rows[0].request_id).toBe('r039');

    const all = await h.listRequests(range, parseRequestFilter({}), 500);
    expect(all.rows).toHaveLength(50);

    const errors = await h.listRequests(range, parseRequestFilter({ status: '5xx' }), 10);
    expect(errors.rows.map((r) => r.request_id)).toEqual(['r059']);

    const byUser = await h.listRequests(
      range,
      parseRequestFilter({ userId: 'user-a', minMs: '500' }),
      500
    );
    expect(byUser.rows.every((r) => Number(r.duration_ms) >= 500)).toBe(true);

    const routes = await h.routeStats(range);
    expect(routes[0]).toMatchObject({ count: 50, errors5xx: 1 });
  });

  it('builds overview totals, routes, cache rate, and charts from the exact selected interval', async () => {
    const h = newHistory();
    const start = now - 60_000;
    await h.insertRequests([
      request(1, { ts: start - 1, durationMs: 2000, cacheHits: 1, cacheMisses: 1, weight: 10 }),
      request(2, { ts: start, durationMs: 100, cacheHits: 3, cacheMisses: 1, weight: 1 }),
      request(3, { ts: start + 1, status: 503, durationMs: 2500, cacheMisses: 2, weight: 1 }),
    ]);
    await h.insertErrors(
      [
        { ...errorEvent('fp1'), ts: start + 1, level: 'error' },
        { ...errorEvent('fp2'), ts: start - 1, level: 'warn' },
      ],
      new Map()
    );

    const overview = await h.overview({ from: start, to: now, kind: 'm' }, 1500);

    expect(overview.totals).toMatchObject({
      requests: 2,
      errors5xx: 1,
      slow: 1,
      cacheHitRate: 0.5,
      logErrors: 1,
      logWarnings: 0,
      uniqueUsers: 1,
    });
    expect(overview.routes).toHaveLength(1);
    expect(overview.routes[0]).toMatchObject({ count: 2, errors5xx: 1 });
    expect(overview.series.requests.reduce((sum, value) => sum + value, 0)).toBe(
      overview.totals.requests
    );
    expect(overview.series.logErrors.reduce((sum, value) => sum + value, 0)).toBe(
      overview.totals.logErrors
    );
    expect(overview.range).toEqual({ from: start, to: now, resolution: 'minute' });
  });

  it('groups errors, links them to requests, and marks resolved groups as regressed', async () => {
    const h = newHistory();
    const batch = (fp: string, requestId = '') =>
      new Map([[fp, { count: 1, first: errorEvent(fp, requestId), lastTs: now }]]);
    await h.insertErrors([errorEvent('fp1', 'req-1')], batch('fp1', 'req-1'));
    expect(await h.setErrorStatus('fp1', 'resolved')).toBe(true);
    expect(await h.setErrorStatus('fp1', 'regressed')).toBe(false);

    await h.insertErrors([errorEvent('fp1')], batch('fp1'));
    const groups = await h.listErrorGroups(range, parseErrorFilter({ status: 'active' }));
    expect(groups[0]).toMatchObject({ fingerprint: 'fp1', status: 'regressed', count: 2 });

    const trace = await h.getTrace('req-1');
    expect(trace.errors[0]).toMatchObject({ fingerprint: 'fp1' });
  });
});
