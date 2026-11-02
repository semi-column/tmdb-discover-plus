import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import pg from 'pg';
import { MemoryHistory } from '../../src/services/observability/history/memory.ts';
import { MongoHistory } from '../../src/services/observability/history/mongo.ts';
import { PostgresHistory } from '../../src/services/observability/history/postgres.ts';
import {
  parseErrorFilter,
  parseRequestFilter,
  weightedPercentiles,
  type HistoryStore,
} from '../../src/services/observability/history/types.ts';
import type {
  ErrorEvent,
  RequestEvent,
  UpstreamEvent,
} from '../../src/services/observability/types.ts';

/*
 * Real-backend reproduction (repository root; disposable databases only):
 * docker run --rm --name tdp-history-check-pg -e POSTGRES_PASSWORD=history-test -e POSTGRES_DB=history_test -p 127.0.0.1:55439:5432 -d postgres:16-alpine
 * docker run --rm --name tdp-history-check-mongo -p 127.0.0.1:55440:27017 -d mongo:7
 * docker exec tdp-history-check-pg pg_isready -U postgres -d history_test
 * docker exec tdp-history-check-mongo mongosh --quiet --eval 'db.runCommand({ping:1}).ok'
 * cd server
 * OBS_HISTORY_TEST_POSTGRES=postgres://postgres:history-test@127.0.0.1:55439/history_test OBS_HISTORY_TEST_MONGO=mongodb://127.0.0.1:55440 npm test -- tests/unit/observabilityHistory.test.ts tests/unit/observabilityHistoryBackends.test.ts
 * docker stop tdp-history-check-pg tdp-history-check-mongo
 *
 * Without those environment variables, PostgreSQL/Mongo tests are SKIPPED.
 * The 2026-11-01 real-database run passed all 65 tests; schemas/databases created
 * by this suite are isolated and removed. Readiness commands must succeed first.
 *
 * Manual performance probe used `node --experimental-strip-types --input-type=module`
 * against a separate disposable PostgreSQL schema. Seed 50 batches of 1,000
 * requests: i=0..49,999, ts=now-i*1000, durationMs=i+1, route=`/route${i%5}`,
 * weight=1, status=200, upstreamCalls=1, cacheHits=1, cacheMisses=0; all other
 * request dimensions constant. Call overview({from:now-86400000,to:now,kind:'h'},
 * 1500) sequentially three times, timing each with performance.now().
 * Baseline was the PostgreSQL class read by:
 * git show 6c63cf857f2f53130f047101ad039e6f90848a99:server/src/services/observability/history/postgres.ts
 * It was loaded in memory using node:module stripTypeScriptTypes, with imports
 * resolved to the same working-tree dependencies; no checkout/files were changed.
 *
 * Baseline times: 65/57/58 ms (median 58), incorrect histogram p95=60000.
 * Corrected times: 104/97/98 ms (median 98), exact p95=47500.
 * EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) on the corrected captured SQL/parameters:
 * execution 103.539 ms, each selected request partition scanned once (50,000 rows
 * in today's partition, zero in yesterday's). The identical Mongo fixture took
 * 1029/970/950 ms after replacing the overflowing $facet implementation.
 * These are local synthetic measurements, NOT evidence of a production speedup.
 * The change reduces PostgreSQL round trips 6->1 and shares one request snapshot;
 * exact percentile computation adds CPU cost. Production's 4.4s was not remeasured.
 */

const now = Math.floor(Date.now() / 60_000) * 60_000;
const range = { from: now - 120_000, to: now + 60_000, kind: 'm' as const };
const options = { retentionDays: 7, capMb: 0, version: 'test' };
const schema = `obs_history_test_${process.pid}`;

function request(id: number, overrides: Partial<RequestEvent> = {}): RequestEvent {
  return {
    ts: now,
    requestId: `r${String(id).padStart(3, '0')}`,
    instance: 'test',
    method: 'GET',
    route: '/catalog',
    path: '/catalog/a%_b.json',
    status: 200,
    durationMs: 111,
    resource: 'catalog',
    source: 'tmdb',
    contentType: 'movie',
    catalogId: 'tmdb-a',
    userHash: 'hashed-user',
    client: 'Browser',
    ua: '',
    country: 'GB',
    colo: 'LHR',
    ipHash: '',
    cacheHits: 1,
    cacheMisses: 0,
    upstreamCalls: 1,
    upstreamMs: 10,
    errorFp: '',
    weight: 1,
    ...overrides,
  };
}

function error(ts: number, overrides: Partial<ErrorEvent> = {}): ErrorEvent {
  return {
    ts,
    fingerprint: 'stable-fingerprint',
    level: 'error',
    context: 'tmdb',
    message: 'invalid key',
    stack: '',
    requestId: 'r001',
    instance: 'test',
    route: '/catalog',
    ...overrides,
  };
}

describe('history filter validation', () => {
  it.each([
    { status: '600' },
    { status: 'nope' },
    { status: ['200', '500'] },
    { minMs: '-1' },
    { maxMs: 'Infinity' },
    { minMs: '1e3' },
    { minMs: '' },
    { maxMs: '2', minMs: '3' },
    { minUpstreamCalls: '1.5' },
    { minUpstreamCalls: 'NaN' },
    { errorsOnly: 'yes' },
    { errorsOnly: ['true'] },
    { sort: 'random' },
    { cursor: 'bad' },
    { cursor: 'v1:e30' },
    { cursor: '2020-01-01|r' },
    { route: { $ne: '' } },
    { q: 'a'.repeat(301) },
  ])('rejects explicit invalid values %j', (raw) => {
    expect(() => parseRequestFilter(raw)).toThrow(RangeError);
  });

  it('accepts zero, decimal bounds, hashed-user lookup and the UI upstream sort', () => {
    expect(
      parseRequestFilter({
        minMs: '0',
        maxMs: '0.5',
        minUpstreamCalls: '0',
        errorsOnly: 'false',
        sort: 'upstream',
        userHash: 'hashed-user',
      })
    ).toMatchObject({
      minMs: 0,
      maxMs: 0.5,
      minUpstreamCalls: 0,
      sort: 'upstreamCalls',
      errorsOnly: false,
      exact: { user_hash: 'hashed-user' },
    });
  });

  it('uses weighted nearest rank without expanding sampled rows', () => {
    expect(
      weightedPercentiles([
        [7777, 1],
        [111, 20],
      ])
    ).toEqual({
      p50Ms: 111,
      p95Ms: 111,
      p99Ms: 7777,
    });
    expect(weightedPercentiles([])).toEqual({ p50Ms: null, p95Ms: null, p99Ms: null });
  });
});

for (const backend of ['memory', 'postgres', 'mongo'] as const) {
  const uri =
    backend === 'postgres'
      ? process.env.OBS_HISTORY_TEST_POSTGRES
      : backend === 'mongo'
        ? process.env.OBS_HISTORY_TEST_MONGO
        : undefined;
  describe.skipIf(backend !== 'memory' && !uri)(`${backend} history contract`, () => {
    let history: HistoryStore;
    let admin: pg.Pool | undefined;

    beforeAll(async () => {
      if (backend === 'postgres') {
        admin = new pg.Pool({ connectionString: uri });
        await admin.query(`CREATE SCHEMA ${schema}`);
        const scoped = new URL(uri!);
        scoped.searchParams.set('options', `-c search_path=${schema}`);
        history = new PostgresHistory(scoped.toString(), options);
      } else if (backend === 'mongo') {
        await mongoose.connect(uri!, { dbName: schema });
        history = new MongoHistory(options);
      } else {
        history = new MemoryHistory({ ...options, maxEvents: 1000, loadConfigs: async () => [] });
      }
      await history.init();
    });

    beforeEach(async () => {
      if (backend === 'postgres') {
        await admin!.query(`TRUNCATE ${schema}.obs_requests, ${schema}.obs_upstream,
          ${schema}.obs_error_events, ${schema}.obs_error_groups`);
      } else if (backend === 'mongo') {
        await Promise.all(
          ['obs_requests', 'obs_upstream', 'obs_error_events', 'obs_error_groups'].map((name) =>
            mongoose.connection.db!.collection(name).deleteMany({})
          )
        );
      } else {
        history = new MemoryHistory({ ...options, maxEvents: 1000, loadConfigs: async () => [] });
      }
    });

    afterAll(async () => {
      await history?.close();
      if (admin) {
        await admin.query(`DROP SCHEMA ${schema} CASCADE`);
        await admin.end();
      }
      if (backend === 'mongo') {
        await mongoose.connection.db?.dropDatabase();
        await mongoose.disconnect();
      }
    });

    it('returns exact raw headline, route and bucket percentiles, not histogram bounds', async () => {
      await history.insertRequests([
        ...Array.from({ length: 19 }, (_, i) => request(i, { ts: now - 60_000 })),
        request(20, { durationMs: 7777 }),
        request(21, { ts: range.from - 1, durationMs: 999_999 }),
      ]);
      const overview = await history.overview(range, 1000);
      expect(overview.totals).toMatchObject({
        requests: 20,
        p50Ms: 111,
        p95Ms: 111,
        p99Ms: 7777,
        slow: 1,
      });
      expect(overview.percentilesApproximate).toBe(false);
      expect(overview.routes[0]).toMatchObject({ count: 20, p50Ms: 111, p95Ms: 111, p99Ms: 7777 });
      expect(overview.series.p95Ms).toEqual([null, 111, 7777, null]);
      expect(overview.series.requests.reduce((sum, n) => sum + n, 0)).toBe(20);
      expect(Object.values(overview.statusCodes).reduce((sum, n) => sum + n, 0)).toBe(20);
    });

    it('preserves weights and marks sampled distributions honestly', async () => {
      await history.insertRequests([
        request(1, { weight: 20, cacheHits: 2, upstreamCalls: 2 }),
        request(2, {
          durationMs: 7777,
          status: 503,
          cacheHits: 0,
          cacheMisses: 2,
          upstreamCalls: 10,
        }),
      ]);
      const overview = await history.overview(range, 1000);
      expect(overview.percentilesApproximate).toBe(true);
      expect(overview.totals).toMatchObject({
        requests: 21,
        errors5xx: 1,
        p50Ms: 111,
        p95Ms: 111,
        p99Ms: 7777,
        avgMs: Math.round((20 * 111 + 7777) / 21),
        cacheHitRate: 40 / 42,
      });
      expect(overview.routes[0]).toMatchObject({
        count: 21,
        p95Ms: 111,
        percentilesApproximate: true,
        avgMs: overview.totals.avgMs,
        avgUpstreamCalls: 2.4,
      });
      const routes = await history.routeStats(range);
      expect(Number(routes[0].p95_ms)).toBe(111);
      expect(routes[0].percentilesApproximate).toBe(true);
      const { topCatalogs } = await history.usageStats(range);
      expect(Number(topCatalogs[0].p95_ms)).toBe(111);
      expect(topCatalogs[0].percentilesApproximate).toBe(true);
      expect((await history.listRequests(range, parseRequestFilter({}), 10)).total).toBe(2);
    });

    it('returns null exact percentiles for an empty range', async () => {
      const overview = await history.overview(range, 1000);
      expect(overview.percentilesApproximate).toBe(false);
      expect(overview.totals).toMatchObject({ requests: 0, p50Ms: null, p95Ms: null, p99Ms: null });
      expect(overview.series.p95Ms).toEqual([null, null, null, null]);
      expect(await history.upstreamOverview(range)).toEqual([]);
    });

    it('keeps provider totals and bucket percentiles exact, including the overflow bucket', async () => {
      const events: UpstreamEvent[] = [200, 403, 429, 0, 500].map((status, i) => ({
        ts: now,
        requestId: `u${i}`,
        instance: 'test',
        provider: 'tmdb',
        host: 'tmdb',
        method: 'GET',
        path: '/movie',
        status,
        durationMs: [111, 222, 333, 4444, 123456][i],
        error: '',
        timedOut: status === 0,
      }));
      await history.insertUpstream(events);
      const [provider] = await history.upstreamOverview(range);
      expect(provider).toMatchObject({
        calls: 5,
        errors: 2,
        rejected: 1,
        rateLimited: 1,
        timeouts: 1,
        p50Ms: 333,
        p95Ms: 123456,
        p99Ms: 123456,
        percentilesApproximate: false,
      });
      expect(provider.series.p95Ms).toEqual([null, null, 123456, null]);
      const { endpoints } = await history.upstreamEndpoints(range);
      expect(Number(endpoints[0].p95_ms)).toBe(provider.p95Ms);
    });

    it('records caller cancellations without treating them as provider failures or timeouts', async () => {
      const base: UpstreamEvent = {
        ts: now,
        requestId: 'timeout',
        instance: 'test',
        provider: 'tmdb',
        host: 'tmdb',
        method: 'GET',
        path: '/movie',
        status: 0,
        durationMs: 111,
        error: 'TimeoutError',
        timedOut: true,
      };
      await history.insertUpstream([
        base,
        { ...base, requestId: 'server', status: 503, timedOut: false, error: 'server error' },
        ...Array.from({ length: 30 }, (_, i) => ({
          ...base,
          requestId: `cancel-${i}`,
          cancelled: true,
          error: 'AbortError',
        })),
      ]);
      const [provider] = await history.upstreamOverview(range);
      expect(provider).toMatchObject({
        calls: 32,
        errors: 2,
        timeouts: 1,
        cancelled: 30,
        errorRate: 2 / 32,
      });
      expect(provider.series.cancelled.reduce((sum, n) => sum + n, 0)).toBe(30);
      const { endpoints, recentErrors } = await history.upstreamEndpoints(range);
      expect(Number(endpoints[0].errors)).toBe(2);
      expect(Number(endpoints[0].timeouts)).toBe(1);
      expect(Number(endpoints[0].cancelled)).toBe(30);
      expect(recentErrors.filter((row) => row.cancelled)).toHaveLength(25);
      expect(recentErrors.filter((row) => !row.cancelled)).toHaveLength(2);
      expect((await history.getTrace('cancel-0')).upstream[0]).toMatchObject({
        cancelled: true,
        error: 'AbortError',
      });
    });

    it.each([
      ['newest', ['r004', 'r003', 'r002', 'r001']],
      ['oldest', ['r001', 'r002', 'r003', 'r004']],
      ['duration', ['r003', 'r002', 'r004', 'r001']],
      ['upstream', ['r004', 'r002', 'r003', 'r001']],
    ])('pages stably by %s regardless of insertion order or ties', async (sort, expected) => {
      await history.insertRequests([
        request(2, { durationMs: 500, upstreamCalls: 8 }),
        request(4, { durationMs: 300, upstreamCalls: 8 }),
        request(1, { durationMs: 100, upstreamCalls: 0 }),
        request(3, { durationMs: 500, upstreamCalls: 3 }),
      ]);
      const first = await history.listRequests(range, parseRequestFilter({ sort }), 2);
      expect(first.total).toBe(4);
      expect(first.rows.map((row) => row.request_id)).toEqual(expected.slice(0, 2));
      expect(first.nextCursor).toBeTruthy();
      const second = await history.listRequests(
        range,
        parseRequestFilter({ sort, cursor: first.nextCursor }),
        2
      );
      expect(second.total).toBe(4);
      expect(second.rows.map((row) => row.request_id)).toEqual(expected.slice(2));
      expect(second.nextCursor).toBeNull();
      if (sort === 'duration') {
        expect(() => parseRequestFilter({ sort: 'upstream', cursor: first.nextCursor })).toThrow(
          RangeError
        );
      }
    });

    it('applies "is not" filters to lists and the overview, and groups by any column', async () => {
      await history.insertRequests([
        request(1, { durationMs: 100 }),
        request(2, { durationMs: 300, status: 500, upstreamCalls: 5 }),
        request(3, { route: '/meta', status: 404, userHash: '', durationMs: 5 }),
        request(4, { route: '/meta', status: 404, userHash: '', durationMs: 7, weight: 3 }),
        request(5, { route: '/manifest', userHash: 'other', client: 'Nuvio' }),
      ]);
      const notMeta = parseRequestFilter({ notRoute: '/meta' });
      expect((await history.listRequests(range, notMeta, 10)).total).toBe(3);
      const overview = await history.overview(range, 1000, notMeta);
      expect(overview.totals).toMatchObject({ requests: 3, errors4xx: 0, errors5xx: 1 });
      expect(
        (await history.listRequests(range, parseRequestFilter({ notStatus: '4xx,5xx' }), 10)).total
      ).toBe(2);
      expect(
        (await history.listRequests(range, parseRequestFilter({ notClient: 'Browser,Nuvio' }), 10))
          .total
      ).toBe(0);

      const byRoute = await history.groupRequests(range, parseRequestFilter({}), 'route');
      expect(byRoute.total).toBe(7);
      expect(byRoute.groups.map((g) => [g.key, g.count])).toEqual([
        ['/meta', 4],
        ['/catalog', 2],
        ['/manifest', 1],
      ]);
      expect(byRoute.groups[1]).toMatchObject({
        errors5xx: 1,
        avg_ms: 200,
        p50_ms: 100,
        p95_ms: 300,
        avg_upstream_calls: 3,
        users: 1,
      });
      expect(byRoute.groups[0]).toMatchObject({ errors4xx: 4, users: 0 });
      expect(byRoute.series.keys).toEqual(['/meta', '/catalog', '/manifest']);
      expect(byRoute.series.values.map((v) => v.reduce((a, b) => a + b, 0))).toEqual([4, 2, 1]);

      const byStatus = await history.groupRequests(range, notMeta, 'status');
      expect(byStatus.groups.map((g) => [g.key, g.count])).toEqual([
        ['200', 2],
        ['500', 1],
      ]);
    });

    it('counts all filtered rows before the cursor, and applies both duration bounds and fanout', async () => {
      await history.insertRequests([
        request(1, { durationMs: 100, upstreamCalls: 2 }),
        request(2, { durationMs: 500, upstreamCalls: 3 }),
        request(3, { durationMs: 501, upstreamCalls: 4 }),
        request(4, { durationMs: 200, upstreamCalls: 1 }),
        request(5, { durationMs: 200, upstreamCalls: 3, userHash: 'other' }),
      ]);
      const filters = {
        minMs: '100',
        maxMs: '500',
        minUpstreamCalls: '2',
        userHash: 'hashed-user',
        q: '%_',
      };
      const first = await history.listRequests(range, parseRequestFilter(filters), 1);
      expect(first.total).toBe(2);
      expect(first.rows[0].request_id).toBe('r002');
      const second = await history.listRequests(
        range,
        parseRequestFilter({ ...filters, cursor: first.nextCursor }),
        1
      );
      expect(second.total).toBe(2);
      expect(second.rows[0].request_id).toBe('r001');
      expect(second.nextCursor).toBeNull();
      const empty = await history.listRequests(
        range,
        parseRequestFilter({
          ...filters,
          cursor: `${new Date(range.from).toISOString()}|r000`,
        }),
        1
      );
      expect(empty).toEqual({ rows: [], total: 2, nextCursor: null });
      expect(
        (
          await history.listRequests(
            range,
            parseRequestFilter({
              minMs: '100.5',
              maxMs: '500.5',
            }),
            10
          )
        ).total
      ).toBe(3);
      expect(
        (
          await history.listRequests(
            range,
            parseRequestFilter({
              maxMs: '9007199254740991',
              minUpstreamCalls: '2147483648',
            }),
            10
          )
        ).total
      ).toBe(0);
    });

    it('preserves capped occurrence totals, minute allocation and fingerprint status continuity', async () => {
      const old = error(now - 60_000);
      await history.insertErrors(
        [old],
        new Map([[old.fingerprint, { first: old, lastTs: old.ts, count: 1 }]])
      );
      await history.setErrorStatus(old.fingerprint, 'resolved');
      const current = error(now, { occurrences: 99, classification: 'user_config' });
      const warning = error(now, {
        fingerprint: 'warning',
        level: 'warn',
        occurrences: 7,
        classification: 'user_config',
      });
      await history.insertErrors(
        [current, warning],
        new Map([
          [current.fingerprint, { first: current, lastTs: current.ts, count: 99 }],
          [warning.fingerprint, { first: warning, lastTs: warning.ts, count: 7 }],
        ])
      );
      const overview = await history.overview(range, 1000);
      expect(overview.totals).toMatchObject({
        logErrors: 100,
        logWarnings: 7,
        userConfigErrors: 99,
        userConfigWarnings: 7,
        errors5xx: 0,
      });
      expect(overview.series.logErrors).toEqual([0, 1, 99, 0]);
      expect(overview.series.logWarnings).toEqual([0, 0, 7, 0]);
      const groups = await history.listErrorGroups(
        range,
        parseErrorFilter({ classification: 'user_config', level: 'error' })
      );
      expect(groups).toHaveLength(1);
      expect(groups[0]).toMatchObject({
        fingerprint: 'stable-fingerprint',
        status: 'regressed',
        classification: 'user_config',
      });
      expect(Number(groups[0].count)).toBe(100);
      expect((groups[0].spark as number[][]).reduce((sum, [, count]) => sum + count, 0)).toBe(100);
      const detail = await history.getErrorGroup(current.fingerprint);
      expect(Number(detail?.routes[0].count)).toBe(100);
      expect(detail?.events).toHaveLength(2);
      expect(Number(detail?.events[0].occurrences)).toBe(99);
      expect(
        (await history.getTrace('r001')).errors.some((row) => row.classification === 'user_config')
      ).toBe(true);
    });

    if (backend === 'postgres') {
      it('does not accumulate REAL rounding drift across sampled traffic panels', async () => {
        await history.insertRequests(
          Array.from({ length: 20_000 }, (_, i) => request(i, { weight: 10 / 3 }))
        );
        const overview = await history.overview(range, 1000);
        const routes = await history.routeStats(range);
        const facets = await history.requestFacets(range);
        const usage = await history.usageStats(range);
        expect(overview.totals.requests).toBe(66_667);
        expect(Number(routes[0].count)).toBe(66_667);
        expect(facets.route[0].count).toBe(66_667);
        expect(Number(usage.topCatalogs[0].requests)).toBe(66_667);
        expect(Number(usage.daily[0].requests)).toBe(66_667);
      });

      it('uses one SQL statement for a consistent overview snapshot', async () => {
        const pool = (history as unknown as { pool: pg.Pool }).pool;
        const query = vi.spyOn(pool, 'query');
        await history.overview(range, 1000);
        expect(query).toHaveBeenCalledTimes(1);
        expect(String(query.mock.calls[0][0])).toContain('filtered AS MATERIALIZED');
        query.mockRestore();
      });

      it('migrates legacy events with occurrences=1 without rewriting fingerprints or statuses', async () => {
        const event = error(now);
        await history.insertErrors(
          [event],
          new Map([[event.fingerprint, { first: event, count: 1, lastTs: now }]])
        );
        await history.setErrorStatus(event.fingerprint, 'ignored');
        await history.insertUpstream([
          {
            ts: now,
            requestId: 'legacy',
            instance: 'test',
            provider: 'tmdb',
            host: 'tmdb',
            method: 'GET',
            path: '/movie',
            status: 0,
            durationMs: 111,
            error: 'network error',
            timedOut: false,
          },
        ]);
        await admin!.query(`ALTER TABLE ${schema}.obs_error_events DROP COLUMN occurrences;
          ALTER TABLE ${schema}.obs_error_events DROP COLUMN classification;
          ALTER TABLE ${schema}.obs_error_groups DROP COLUMN classification;
          ALTER TABLE ${schema}.obs_upstream DROP COLUMN cancelled`);
        await history.init();
        const group = await history.getErrorGroup(event.fingerprint);
        expect(group?.group.status).toBe('ignored');
        expect(Number(group?.events[0].occurrences)).toBe(1);
        expect((await history.overview(range, 1000)).totals.logErrors).toBe(1);
        expect((await history.upstreamOverview(range))[0]).toMatchObject({
          calls: 1,
          errors: 1,
          cancelled: 0,
        });
      });
    }

    if (backend === 'mongo') {
      it('uses one request aggregation shared by all request panels', async () => {
        const collection = mongoose.connection.db!.collection('obs_requests');
        const aggregate = vi.spyOn(Object.getPrototypeOf(collection), 'aggregate');
        await history.overview(range, 1000);
        expect(aggregate).toHaveBeenCalledTimes(2);
        expect(
          aggregate.mock.calls.some((args) => JSON.stringify(args[0]).includes('$dimension'))
        ).toBe(true);
        aggregate.mockRestore();
      });

      it('defaults legacy events without occurrences to one', async () => {
        await mongoose.connection.db!.collection('obs_error_events').insertOne({
          ts: new Date(now),
          fingerprint: 'legacy',
          level: 'error',
          request_id: '',
          instance: 'test',
          route: '/catalog',
          message: 'legacy',
        });
        expect((await history.overview(range, 1000)).totals.logErrors).toBe(1);
        await mongoose.connection.db!.collection('obs_upstream').insertOne({
          ts: new Date(now),
          request_id: 'legacy',
          provider: 'tmdb',
          method: 'GET',
          path: '/movie',
          status: 0,
          duration_ms: 111,
          timed_out: false,
        });
        expect((await history.upstreamOverview(range))[0]).toMatchObject({
          calls: 1,
          errors: 1,
          cancelled: 0,
        });
      });

      it('does not overflow Mongo facet document limits on 50,000 distinct durations', async () => {
        for (let batch = 0; batch < 50; batch++) {
          await history.insertRequests(
            Array.from({ length: 1000 }, (_, j) => {
              const i = batch * 1000 + j;
              return request(i, { ts: now - i * 1000, route: `/route${i % 5}`, durationMs: i + 1 });
            })
          );
        }
        const overview = await history.overview(
          { from: now - 86_400_000, to: now, kind: 'h' },
          1000
        );
        expect(overview.totals).toMatchObject({
          requests: 50_000,
          p50Ms: 25_000,
          p95Ms: 47_500,
          p99Ms: 49_500,
        });
        expect(overview.routes.reduce((sum, route) => sum + route.count, 0)).toBe(50_000);
      }, 30_000);
    }
  });
}
