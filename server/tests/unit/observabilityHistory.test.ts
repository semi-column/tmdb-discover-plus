import { describe, it, expect } from 'vitest';
import { MemoryHistory } from '../../src/services/observability/history/memory.ts';
import {
  parseErrorFilter,
  parseRequestFilter,
} from '../../src/services/observability/history/types.ts';
import { hashIdentifier } from '../../src/services/observability/identity.ts';
import type { ErrorEvent, RequestEvent } from '../../src/services/observability/types.ts';

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

function newHistory(maxEvents = 100) {
  return new MemoryHistory({
    maxEvents,
    retentionDays: 7,
    version: '1.0.0',
    loadConfigs: async () => [],
  });
}

describe('MemoryHistory', () => {
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
