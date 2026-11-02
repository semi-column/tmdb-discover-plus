import pg from 'pg';
import { createLogger } from '../../../utils/logger.ts';
import { LATENCY_BUCKETS } from '../collector.ts';
import type { TimeRange } from '../liveQueries.ts';
import {
  buildHistoryOverview,
  buildHistoryUpstreamOverview,
  type ExactPercentiles,
} from './overview.ts';
import type { ErrorEvent, RequestEvent, SystemSample, UpstreamEvent } from '../types.ts';
import {
  SETTABLE_ERROR_STATUSES,
  bucketForRange,
  encodeCursor,
  type ErrorFilter,
  type ErrorGroupBatch,
  type HistoryStore,
  EMPTY_REQUEST_FILTER,
  REQUEST_GROUP_LIMIT,
  REQUEST_GROUP_SERIES,
  buildGroupSeries,
  groupSeriesBucketMs,
  toGroupRow,
  type RequestFilter,
  type RequestGroupColumn,
  type StorageInfo,
} from './types.ts';

const log = createLogger('obs:pg');

const PARTITIONED_TABLES = ['obs_requests', 'obs_upstream', 'obs_error_events'] as const;
const ALL_TABLES = [...PARTITIONED_TABLES, 'obs_error_groups', 'obs_system_samples'];
const LOCK_KEY = 'tdp_obs_maintenance';
const MAX_ROWS_PER_INSERT = 2000;

interface RequestMetric extends ExactPercentiles {
  kind: 'bucket' | 'route' | 'total';
  key: string;
  requests: number;
  errors5xx: number;
  errors4xx: number;
  slow: number;
  duration: number;
  cache_hits: number;
  cache_misses: number;
  upstream_calls: number;
  sampled: boolean;
  max_ms: number;
  [column: string]: unknown;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS obs_requests (
  ts             timestamptz NOT NULL,
  request_id     text NOT NULL,
  instance       text NOT NULL,
  method         text NOT NULL,
  route          text NOT NULL,
  path           text NOT NULL,
  status         smallint NOT NULL,
  duration_ms    integer NOT NULL,
  resource       text NOT NULL,
  source         text NOT NULL,
  content_type   text NOT NULL,
  catalog_id     text NOT NULL,
  user_hash      text NOT NULL,
  client         text NOT NULL,
  ua             text NOT NULL,
  country        text NOT NULL,
  colo           text NOT NULL,
  ip_hash        text NOT NULL,
  cache_hits     integer NOT NULL,
  cache_misses   integer NOT NULL,
  upstream_calls integer NOT NULL,
  upstream_ms    integer NOT NULL,
  error_fp       text NOT NULL,
  weight         real NOT NULL DEFAULT 1
) PARTITION BY RANGE (ts);
CREATE INDEX IF NOT EXISTS obs_requests_ts_idx ON obs_requests (ts DESC);
CREATE INDEX IF NOT EXISTS obs_requests_route_idx ON obs_requests (route, ts DESC);
CREATE INDEX IF NOT EXISTS obs_requests_status_idx ON obs_requests (status, ts DESC);
CREATE INDEX IF NOT EXISTS obs_requests_rid_idx ON obs_requests (request_id);
CREATE INDEX IF NOT EXISTS obs_requests_user_idx ON obs_requests (user_hash, ts DESC);

CREATE TABLE IF NOT EXISTS obs_upstream (
  ts          timestamptz NOT NULL,
  request_id  text NOT NULL,
  instance    text NOT NULL,
  provider    text NOT NULL,
  host        text NOT NULL,
  method      text NOT NULL,
  path        text NOT NULL,
  status      smallint NOT NULL,
  duration_ms integer NOT NULL,
  error       text NOT NULL,
  timed_out   boolean NOT NULL
) PARTITION BY RANGE (ts);
CREATE INDEX IF NOT EXISTS obs_upstream_ts_idx ON obs_upstream (ts DESC);
CREATE INDEX IF NOT EXISTS obs_upstream_provider_idx ON obs_upstream (provider, ts DESC);
CREATE INDEX IF NOT EXISTS obs_upstream_rid_idx ON obs_upstream (request_id);

CREATE TABLE IF NOT EXISTS obs_error_events (
  ts          timestamptz NOT NULL,
  fingerprint text NOT NULL,
  level       text NOT NULL,
  request_id  text NOT NULL,
  instance    text NOT NULL,
  route       text NOT NULL,
  message     text NOT NULL
) PARTITION BY RANGE (ts);
CREATE INDEX IF NOT EXISTS obs_error_events_fp_idx ON obs_error_events (fingerprint, ts DESC);
CREATE INDEX IF NOT EXISTS obs_error_events_rid_idx ON obs_error_events (request_id);

CREATE TABLE IF NOT EXISTS obs_error_groups (
  fingerprint       text PRIMARY KEY,
  level             text NOT NULL,
  context           text NOT NULL,
  message           text NOT NULL,
  sample_stack      text NOT NULL DEFAULT '',
  sample_route      text NOT NULL DEFAULT '',
  first_seen        timestamptz NOT NULL,
  last_seen         timestamptz NOT NULL,
  count             bigint NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'open',
  status_changed_at timestamptz,
  first_version     text NOT NULL DEFAULT '',
  last_version      text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS obs_error_groups_last_idx ON obs_error_groups (last_seen DESC);

ALTER TABLE obs_error_events ADD COLUMN IF NOT EXISTS occurrences bigint NOT NULL DEFAULT 1;
ALTER TABLE obs_error_events ADD COLUMN IF NOT EXISTS classification text NOT NULL DEFAULT '';
ALTER TABLE obs_error_groups ADD COLUMN IF NOT EXISTS classification text NOT NULL DEFAULT '';
ALTER TABLE obs_upstream ADD COLUMN IF NOT EXISTS cancelled boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS obs_system_samples (
  ts       timestamptz NOT NULL,
  instance text NOT NULL,
  data     jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS obs_system_samples_ts_idx ON obs_system_samples (ts DESC);
`;

const REQUEST_COLUMNS = `ts, request_id, instance, method, route, path, status, duration_ms, resource,
  source, content_type, catalog_id, user_hash, client, ua, country, colo, ip_hash, cache_hits,
  cache_misses, upstream_calls, upstream_ms, error_fp, weight`;

const CATALOGS_SQL = `CASE WHEN jsonb_typeof(data->'catalogs') = 'array' THEN data->'catalogs' ELSE '[]'::jsonb END`;

function dayStart(offsetDays: number, now = Date.now()): Date {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d;
}

function partitionSuffix(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export class PostgresHistory implements HistoryStore {
  readonly kind = 'postgres' as const;
  readonly approximatePercentiles = false;
  private pool: InstanceType<typeof pg.Pool>;
  private retentionDays: number;
  private capBytes: number | null;
  private version: string;
  private paused = false;

  constructor(uri: string, opts: { retentionDays: number; capMb: number; version: string }) {
    this.pool = new pg.Pool({
      connectionString: uri,
      max: 3,
      idleTimeoutMillis: 30_000,
      statement_timeout: 20_000,
      application_name: 'tdp-observability',
    });
    this.pool.on('error', (err: Error) => log.warn('Idle client error', { error: err.message }));
    this.retentionDays = opts.retentionDays;
    this.capBytes = opts.capMb > 0 ? opts.capMb * 1024 * 1024 : null;
    this.version = opts.version;
  }

  isPaused(): boolean {
    return this.paused;
  }

  async init(): Promise<void> {
    const client = await this.pool.connect();
    try {
      // Serialise DDL across replicas starting at the same time.
      await client.query('SELECT pg_advisory_lock(hashtext($1))', [LOCK_KEY]);
      await client.query(SCHEMA_SQL);
      await this.ensurePartitions(client);
    } finally {
      await client
        .query('SELECT pg_advisory_unlock(hashtext($1))', [LOCK_KEY])
        .catch(() => undefined);
      client.release();
    }
  }

  private async ensurePartitions(client: pg.PoolClient): Promise<void> {
    for (const table of PARTITIONED_TABLES) {
      for (let offset = -1; offset <= 2; offset++) {
        const from = dayStart(offset);
        const to = dayStart(offset + 1);
        // Identifiers come from constants and dates only, never from input.
        await client.query(
          `CREATE TABLE IF NOT EXISTS ${table}_p${partitionSuffix(from)} PARTITION OF ${table}
           FOR VALUES FROM ('${from.toISOString()}') TO ('${to.toISOString()}')`
        );
      }
    }
  }

  private async listPartitions(
    client: pg.PoolClient
  ): Promise<Array<{ name: string; day: string }>> {
    const { rows } = await client.query<{ name: string }>(
      `SELECT c.relname AS name FROM pg_inherits i
       JOIN pg_class c ON c.oid = i.inhrelid
       JOIN pg_class p ON p.oid = i.inhparent
       WHERE p.relname = ANY($1)`,
      [PARTITIONED_TABLES]
    );
    return rows
      .map(({ name }) => ({ name, day: /_p(\d{8})$/.exec(name)?.[1] ?? '' }))
      .filter((p) => p.day);
  }

  /** Runs on whichever replica wins the advisory lock; every replica refreshes its pause flag. */
  async maintain(): Promise<void> {
    const client = await this.pool.connect();
    let locked = false;
    try {
      const { rows } = await client.query<{ ok: boolean }>(
        'SELECT pg_try_advisory_lock(hashtext($1)) AS ok',
        [LOCK_KEY]
      );
      locked = rows[0]?.ok === true;
      if (locked) {
        await this.ensurePartitions(client);
        const cutoff = partitionSuffix(dayStart(-this.retentionDays));
        const dropped: string[] = [];
        for (const p of await this.listPartitions(client)) {
          if (p.day < cutoff) {
            await client.query(`DROP TABLE IF EXISTS ${p.name}`);
            dropped.push(p.name);
          }
        }
        await client.query(
          `DELETE FROM obs_system_samples WHERE ts < now() - make_interval(days => $1)`,
          [this.retentionDays]
        );
        await client.query(
          `DELETE FROM obs_error_groups WHERE last_seen < now() - make_interval(days => $1)`,
          [Math.max(this.retentionDays, 30)]
        );
        dropped.push(...(await this.enforceCap(client)));
        if (dropped.length) log.info('Dropped observability partitions', { dropped });
      }
      const info = await this.storageInfo();
      this.paused = info.paused;
    } finally {
      if (locked) {
        await client
          .query('SELECT pg_advisory_unlock(hashtext($1))', [LOCK_KEY])
          .catch(() => undefined);
      }
      client.release();
    }
  }

  /** Drops the oldest whole days (never today) until under OBS_MAX_STORAGE_MB. */
  private async enforceCap(client: pg.PoolClient): Promise<string[]> {
    if (!this.capBytes) return [];
    const today = partitionSuffix(dayStart(0));
    const dropped: string[] = [];
    for (;;) {
      const { totalBytes } = await this.storageInfo();
      if (totalBytes <= this.capBytes) break;
      const days = [...new Set((await this.listPartitions(client)).map((p) => p.day))]
        .filter((d) => d < today)
        .sort();
      if (!days.length) break;
      for (const p of (await this.listPartitions(client)).filter((x) => x.day === days[0])) {
        await client.query(`DROP TABLE IF EXISTS ${p.name}`);
        dropped.push(p.name);
      }
    }
    return dropped;
  }

  async insertRequests(events: RequestEvent[]): Promise<void> {
    for (let i = 0; i < events.length; i += MAX_ROWS_PER_INSERT) {
      const chunk = events.slice(i, i + MAX_ROWS_PER_INSERT);
      await this.pool.query(
        `INSERT INTO obs_requests (ts, request_id, instance, method, route, path, status, duration_ms,
           resource, source, content_type, catalog_id, user_hash, client, ua, country, colo, ip_hash,
           cache_hits, cache_misses, upstream_calls, upstream_ms, error_fp, weight)
         SELECT * FROM unnest($1::timestamptz[], $2::text[], $3::text[], $4::text[], $5::text[],
           $6::text[], $7::smallint[], $8::int[], $9::text[], $10::text[], $11::text[], $12::text[],
           $13::text[], $14::text[], $15::text[], $16::text[], $17::text[], $18::text[], $19::int[],
           $20::int[], $21::int[], $22::int[], $23::text[], $24::real[])`,
        [
          chunk.map((e) => new Date(e.ts)),
          chunk.map((e) => e.requestId),
          chunk.map((e) => e.instance),
          chunk.map((e) => e.method),
          chunk.map((e) => e.route),
          chunk.map((e) => e.path),
          chunk.map((e) => e.status),
          chunk.map((e) => e.durationMs),
          chunk.map((e) => e.resource),
          chunk.map((e) => e.source),
          chunk.map((e) => e.contentType),
          chunk.map((e) => e.catalogId),
          chunk.map((e) => e.userHash),
          chunk.map((e) => e.client),
          chunk.map((e) => e.ua),
          chunk.map((e) => e.country),
          chunk.map((e) => e.colo),
          chunk.map((e) => e.ipHash),
          chunk.map((e) => e.cacheHits),
          chunk.map((e) => e.cacheMisses),
          chunk.map((e) => e.upstreamCalls),
          chunk.map((e) => e.upstreamMs),
          chunk.map((e) => e.errorFp),
          chunk.map((e) => e.weight),
        ]
      );
    }
  }

  async insertUpstream(events: UpstreamEvent[]): Promise<void> {
    for (let i = 0; i < events.length; i += MAX_ROWS_PER_INSERT) {
      const chunk = events.slice(i, i + MAX_ROWS_PER_INSERT);
      await this.pool.query(
        `INSERT INTO obs_upstream (ts, request_id, instance, provider, host, method, path, status,
           duration_ms, error, timed_out, cancelled)
         SELECT * FROM unnest($1::timestamptz[], $2::text[], $3::text[], $4::text[], $5::text[],
           $6::text[], $7::text[], $8::smallint[], $9::int[], $10::text[], $11::boolean[], $12::boolean[])`,
        [
          chunk.map((e) => new Date(e.ts)),
          chunk.map((e) => e.requestId),
          chunk.map((e) => e.instance),
          chunk.map((e) => e.provider),
          chunk.map((e) => e.host),
          chunk.map((e) => e.method),
          chunk.map((e) => e.path),
          chunk.map((e) => e.status),
          chunk.map((e) => e.durationMs),
          chunk.map((e) => e.error),
          chunk.map((e) => e.timedOut),
          chunk.map((e) => e.cancelled ?? false),
        ]
      );
    }
  }

  /** A resolved group that fires again becomes "regressed". */
  async insertErrors(events: ErrorEvent[], groups: Map<string, ErrorGroupBatch>): Promise<void> {
    if (groups.size) {
      const list = [...groups.entries()];
      await this.pool.query(
        `INSERT INTO obs_error_groups (fingerprint, level, context, message, sample_stack, sample_route,
           first_seen, last_seen, count, status, first_version, last_version, classification)
         SELECT fp, lvl, ctx, msg, stk, rte, fs, ls, cnt, 'open', $10, $10, cls
         FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[],
           $7::timestamptz[], $8::timestamptz[], $9::bigint[], $11::text[]) AS t(fp, lvl, ctx, msg, stk, rte, fs, ls, cnt, cls)
         ON CONFLICT (fingerprint) DO UPDATE SET
           last_seen = GREATEST(obs_error_groups.last_seen, EXCLUDED.last_seen),
           count = obs_error_groups.count + EXCLUDED.count,
           last_version = EXCLUDED.last_version,
           classification = CASE WHEN EXCLUDED.classification <> '' THEN EXCLUDED.classification
                                 ELSE obs_error_groups.classification END,
           sample_stack = CASE WHEN EXCLUDED.sample_stack <> '' THEN EXCLUDED.sample_stack
                               ELSE obs_error_groups.sample_stack END,
           status = CASE WHEN obs_error_groups.status = 'resolved' THEN 'regressed'
                         ELSE obs_error_groups.status END,
           status_changed_at = CASE WHEN obs_error_groups.status = 'resolved' THEN now()
                                    ELSE obs_error_groups.status_changed_at END`,
        [
          list.map(([fp]) => fp),
          list.map(([, g]) => g.first.level),
          list.map(([, g]) => g.first.context),
          list.map(([, g]) => g.first.message),
          list.map(([, g]) => g.first.stack),
          list.map(([, g]) => g.first.route),
          list.map(([, g]) => new Date(g.first.ts)),
          list.map(([, g]) => new Date(g.lastTs)),
          list.map(([, g]) => g.count),
          this.version,
          list.map(([, g]) => g.first.classification ?? ''),
        ]
      );
    }
    for (let i = 0; i < events.length; i += MAX_ROWS_PER_INSERT) {
      const chunk = events.slice(i, i + MAX_ROWS_PER_INSERT);
      await this.pool.query(
        `INSERT INTO obs_error_events (ts, fingerprint, level, request_id, instance, route, message, occurrences, classification)
         SELECT * FROM unnest($1::timestamptz[], $2::text[], $3::text[], $4::text[], $5::text[],
           $6::text[], $7::text[], $8::bigint[], $9::text[])`,
        [
          chunk.map((e) => new Date(e.ts)),
          chunk.map((e) => e.fingerprint),
          chunk.map((e) => e.level),
          chunk.map((e) => e.requestId),
          chunk.map((e) => e.instance),
          chunk.map((e) => e.route),
          chunk.map((e) => e.message),
          chunk.map((e) => e.occurrences ?? 1),
          chunk.map((e) => e.classification ?? ''),
        ]
      );
    }
  }

  async insertSystem(samples: SystemSample[]): Promise<void> {
    if (!samples.length) return;
    await this.pool.query(
      `INSERT INTO obs_system_samples (ts, instance, data)
       SELECT * FROM unnest($1::timestamptz[], $2::text[], $3::jsonb[])`,
      [
        samples.map((s) => new Date(s.ts)),
        samples.map((s) => s.instance),
        samples.map((s) => JSON.stringify(s.data)),
      ]
    );
  }

  /** `params` may carry leading statement parameters; the time range must be $1/$2. */
  private requestWhere(
    range: TimeRange,
    filter: RequestFilter,
    params: unknown[] = [new Date(range.from), new Date(range.to)]
  ) {
    const where: string[] = ['ts >= $1', 'ts <= $2'];
    const add = (sql: string, ...values: unknown[]) => {
      let text = sql;
      for (const value of values) {
        params.push(value);
        text = text.replace('?', `$${params.length}`);
      }
      where.push(text);
    };
    // Column names come from the RequestFilter type's fixed keys.
    for (const [column, value] of Object.entries(filter.exact)) add(`${column} = ?`, value);
    for (const [column, values] of Object.entries(filter.exclude))
      add(`NOT (${column} = ANY(?::text[]))`, values);
    for (const [min, max] of filter.excludeStatus) add('NOT (status BETWEEN ? AND ?)', min, max);
    if (filter.statusMin !== undefined) add('status >= ?', filter.statusMin);
    if (filter.statusMax !== undefined) add('status <= ?', filter.statusMax);
    if (filter.minMs !== undefined) add('duration_ms >= ?::double precision', filter.minMs);
    if (filter.maxMs !== undefined) add('duration_ms <= ?::double precision', filter.maxMs);
    if (filter.minUpstreamCalls !== undefined)
      add('upstream_calls >= ?::double precision', filter.minUpstreamCalls);
    if (filter.errorsOnly) where.push("(status >= 500 OR error_fp <> '')");
    if (filter.pathContains) add('path ILIKE ?', likePattern(filter.pathContains));
    return { params, where };
  }

  async listRequests(range: TimeRange, filter: RequestFilter, limit: number) {
    const { params, where } = this.requestWhere(range, filter);
    const sort = filter.sort ?? 'newest';
    const metric =
      sort === 'duration' ? 'duration_ms' : sort === 'upstreamCalls' ? 'upstream_calls' : '';
    const direction = sort === 'oldest' ? 'ASC' : 'DESC';
    const order = `${metric ? `${metric} DESC, ` : ''}ts ${direction}, request_id COLLATE "C" ${direction}`;
    let cursor = '';
    if (filter.cursor) {
      const start = params.length;
      params.push(filter.cursor.ts, filter.cursor.requestId);
      if (metric) params.push(filter.cursor.value);
      cursor = `WHERE (${metric ? `${metric}, ` : ''}ts, request_id COLLATE "C") ${sort === 'oldest' ? '>' : '<'}
        (${metric ? `$${start + 3}::double precision, ` : ''}$${start + 1}, $${start + 2})`;
    }
    params.push(limit + 1);
    const { rows: result } = await this.pool.query(
      `WITH filtered AS MATERIALIZED (
         SELECT ${REQUEST_COLUMNS} FROM obs_requests WHERE ${where.join(' AND ')}
       ), page AS (SELECT * FROM filtered ${cursor} ORDER BY ${order} LIMIT $${params.length})
       SELECT (SELECT count(*)::float FROM filtered) AS total,
         COALESCE((SELECT json_agg(page ORDER BY ${order}) FROM page), '[]'::json) AS rows`,
      params
    );
    const page = result[0].rows as Record<string, unknown>[];
    const rows = page.slice(0, limit);
    return {
      rows,
      total: Number(result[0].total),
      nextCursor: page.length > limit ? encodeCursor(rows, limit, sort) : null,
    };
  }

  async requestFacets(range: TimeRange) {
    const { rows } = await this.pool.query(
      `SELECT 'route' AS facet, route AS value, sum(weight::double precision)::bigint AS count FROM obs_requests
         WHERE ts >= $1 AND ts <= $2 GROUP BY route
       UNION ALL
       SELECT 'client', client, sum(weight::double precision)::bigint FROM obs_requests WHERE ts >= $1 AND ts <= $2 GROUP BY client
       UNION ALL
       SELECT 'instance', instance, sum(weight::double precision)::bigint FROM obs_requests WHERE ts >= $1 AND ts <= $2 GROUP BY instance
       UNION ALL
       SELECT 'country', country, sum(weight::double precision)::bigint FROM obs_requests WHERE ts >= $1 AND ts <= $2 AND country <> '' GROUP BY country`,
      [new Date(range.from), new Date(range.to)]
    );
    const facets: Record<string, Array<{ value: string; count: number }>> = {};
    for (const row of rows)
      (facets[row.facet] ??= []).push({ value: row.value, count: Number(row.count) });
    for (const list of Object.values(facets)) list.sort((a, b) => b.count - a.count);
    return facets;
  }

  async getTrace(requestId: string) {
    const [requests, upstream, errors] = await Promise.all([
      this.pool.query(
        `SELECT ${REQUEST_COLUMNS} FROM obs_requests WHERE request_id = $1 ORDER BY ts DESC LIMIT 5`,
        [requestId]
      ),
      this.pool.query(
        `SELECT ts, provider, host, method, path, status, duration_ms, error, timed_out, cancelled
         FROM obs_upstream WHERE request_id = $1 ORDER BY ts LIMIT 500`,
        [requestId]
      ),
      this.pool.query(
        `SELECT e.ts, e.fingerprint, e.level, e.message, e.occurrences, e.classification, g.context, g.status
         FROM obs_error_events e LEFT JOIN obs_error_groups g USING (fingerprint)
         WHERE e.request_id = $1 ORDER BY e.ts LIMIT 200`,
        [requestId]
      ),
    ]);
    return { requests: requests.rows, upstream: upstream.rows, errors: errors.rows };
  }

  async overview(range: TimeRange, slowMs: number, filter: RequestFilter = EMPTY_REQUEST_FILTER) {
    const bucketMs = range.kind === 'm' ? 60_000 : 3_600_000;
    const histogram = [
      ...LATENCY_BUCKETS.map((upper, index) => {
        const condition = index
          ? `duration_ms > ${LATENCY_BUCKETS[index - 1]} AND duration_ms <= ${upper}`
          : `duration_ms <= ${upper}`;
        return `COALESCE(SUM(requests) FILTER (WHERE ${condition}), 0)::float AS lat_${index}`;
      }),
      `COALESCE(SUM(requests) FILTER (WHERE duration_ms > ${LATENCY_BUCKETS.at(-1)}), 0)::float AS lat_${LATENCY_BUCKETS.length}`,
    ].join(',');
    const timeFilter = 'ts >= $1 AND ts <= $2';
    const { params, where } = this.requestWhere(range, filter, [
      new Date(range.from),
      new Date(range.to),
      bucketMs,
      slowMs,
    ]);
    // One statement gives every panel one MVCC snapshot and reads the request table only once.
    const {
      rows: [result],
    } = await this.pool.query(
      `WITH filtered AS MATERIALIZED (
         SELECT route, status, duration_ms, weight::double precision AS weight,
           cache_hits, cache_misses, upstream_calls, user_hash,
           resource, source, content_type, client, country, colo, instance,
           (floor(extract(epoch FROM ts) * 1000 / $3)::bigint * $3) AS bucket
         FROM obs_requests WHERE ${where.join(' AND ')}
       ), sampling AS MATERIALIZED (
         SELECT coalesce(bool_or(weight <> 1), false) AS sampled FROM filtered
       ), durations AS (
         SELECT CASE WHEN grouping(bucket) = 0 THEN 'bucket'
                     WHEN grouping(route) = 0 THEN 'route' ELSE 'total' END AS kind,
           CASE WHEN grouping(bucket) = 0 THEN bucket::text
                WHEN grouping(route) = 0 THEN route ELSE '' END AS key,
           duration_ms, SUM(weight) AS requests,
           COALESCE(SUM(weight) FILTER (WHERE status >= 500), 0) AS errors5xx,
           COALESCE(SUM(weight) FILTER (WHERE status >= 400 AND status < 500), 0) AS errors4xx,
           COALESCE(SUM(weight) FILTER (WHERE duration_ms >= $4), 0) AS slow,
           SUM(cache_hits * weight) AS cache_hits, SUM(cache_misses * weight) AS cache_misses,
           SUM(upstream_calls * weight) AS upstream_calls, bool_or(weight <> 1) AS sampled
         FROM filtered WHERE (SELECT sampled FROM sampling)
         GROUP BY GROUPING SETS ((bucket, duration_ms), (route, duration_ms), (duration_ms))
       ), ranked AS (
         SELECT *, SUM(requests) OVER (PARTITION BY kind, key ORDER BY duration_ms) AS cumulative,
           SUM(requests) OVER (PARTITION BY kind, key) AS total FROM durations
       ), metrics AS (
         SELECT kind, key, SUM(requests) AS requests, SUM(errors5xx) AS errors5xx,
           SUM(errors4xx) AS errors4xx, SUM(slow) AS slow,
           SUM(duration_ms * requests) AS duration, SUM(cache_hits) AS cache_hits,
           SUM(cache_misses) AS cache_misses, SUM(upstream_calls) AS upstream_calls,
           bool_or(sampled) AS sampled, max(duration_ms) AS max_ms,
           min(duration_ms) FILTER (WHERE cumulative >= total * 0.5) AS "p50Ms",
           min(duration_ms) FILTER (WHERE cumulative >= total * 0.95) AS "p95Ms",
           min(duration_ms) FILTER (WHERE cumulative >= total * 0.99) AS "p99Ms",
           ${histogram}
         FROM ranked GROUP BY kind, key
         UNION ALL
         SELECT CASE WHEN grouping(bucket) = 0 THEN 'bucket'
                     WHEN grouping(route) = 0 THEN 'route' ELSE 'total' END AS kind,
           CASE WHEN grouping(bucket) = 0 THEN bucket::text
                WHEN grouping(route) = 0 THEN route ELSE '' END AS key,
           SUM(weight) AS requests,
           COALESCE(SUM(weight) FILTER (WHERE status >= 500), 0) AS errors5xx,
           COALESCE(SUM(weight) FILTER (WHERE status >= 400 AND status < 500), 0) AS errors4xx,
           COALESCE(SUM(weight) FILTER (WHERE duration_ms >= $4), 0) AS slow,
           SUM(duration_ms * weight) AS duration, SUM(cache_hits * weight) AS cache_hits,
           SUM(cache_misses * weight) AS cache_misses, SUM(upstream_calls * weight) AS upstream_calls,
           false AS sampled, max(duration_ms) AS max_ms,
           percentile_disc(0.5) WITHIN GROUP (ORDER BY duration_ms) AS "p50Ms",
           percentile_disc(0.95) WITHIN GROUP (ORDER BY duration_ms) AS "p95Ms",
           percentile_disc(0.99) WITHIN GROUP (ORDER BY duration_ms) AS "p99Ms",
           ${histogram.replaceAll('SUM(requests)', 'SUM(weight)')}
         FROM filtered WHERE NOT (SELECT sampled FROM sampling)
         GROUP BY GROUPING SETS ((bucket), (route), ()) HAVING count(*) > 0
       ), statuses AS (
         SELECT status, sum(weight) AS count FROM filtered GROUP BY status
       ), dimensions AS (
         SELECT CASE WHEN grouping(resource) = 0 THEN 'resource'
           WHEN grouping(source) = 0 THEN 'source'
           WHEN grouping(content_type) = 0 THEN 'contentType'
           WHEN grouping(client) = 0 THEN 'client'
           WHEN grouping(country) = 0 THEN 'country'
           WHEN grouping(colo) = 0 THEN 'colo' ELSE 'instance' END AS kind,
           coalesce(resource, source, content_type, client, country, colo, instance) AS key,
           sum(weight) AS count FROM filtered
         GROUP BY GROUPING SETS ((resource), (source), (content_type), (client), (country), (colo), (instance))
         HAVING coalesce(resource, source, content_type, client, country, colo, instance) <> ''
       ), logs AS (
         SELECT (floor(extract(epoch FROM ts) * 1000 / $3)::bigint * $3) AS bucket,
           level, classification, sum(coalesce(occurrences, 1))::float AS count
         FROM obs_error_events WHERE ${timeFilter} GROUP BY bucket, level, classification
       )
       SELECT (SELECT json_agg(metrics) FROM metrics) AS metrics,
         (SELECT json_agg(statuses) FROM statuses) AS statuses,
         (SELECT json_agg(dimensions) FROM dimensions) AS breakdowns,
         (SELECT json_agg(logs) FROM logs) AS logs,
         (SELECT count(DISTINCT user_hash)::int FROM filtered WHERE user_hash <> '') AS users`,
      params
    );
    const metrics: RequestMetric[] = result.metrics ?? [];
    const buckets = metrics
      .filter((row) => row.kind === 'bucket')
      .map((row) => ({
        bucket: Number(row.key),
        requests: Number(row.requests),
        errors5xx: Number(row.errors5xx),
        errors4xx: Number(row.errors4xx),
        slow: Number(row.slow),
        duration: Number(row.duration),
        cacheHits: Number(row.cache_hits),
        cacheMisses: Number(row.cache_misses),
        p95Ms: Number(row.p95Ms),
        sampled: Boolean(row.sampled),
        histogram: LATENCY_BUCKETS.map((_, index) => Number(row[`lat_${index}`])).concat(
          Number(row[`lat_${LATENCY_BUCKETS.length}`])
        ),
      }));
    const routes = metrics
      .filter((row) => row.kind === 'route')
      .map((row) => ({
        route: row.key,
        count: Math.round(row.requests),
        errors5xx: Math.round(row.errors5xx),
        errors4xx: Math.round(row.errors4xx),
        avgMs: Math.round(row.duration / row.requests),
        p50Ms: row.p50Ms,
        p95Ms: row.p95Ms,
        p99Ms: row.p99Ms,
        maxMs: row.max_ms,
        avgUpstreamCalls: Number((row.upstream_calls / row.requests).toFixed(1)),
        percentilesApproximate: row.sampled,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 200);
    const logs = new Map<number, { bucket: number; errors: number; warnings: number }>();
    let userConfigErrors = 0,
      userConfigWarnings = 0;
    for (const row of result.logs ?? []) {
      const bucket = Number(row.bucket);
      const value = logs.get(bucket) ?? { bucket, errors: 0, warnings: 0 };
      if (row.level === 'error') value.errors += Number(row.count);
      else if (row.level === 'warn') value.warnings += Number(row.count);
      if (row.classification === 'user_config') {
        if (row.level === 'error') userConfigErrors += Number(row.count);
        else if (row.level === 'warn') userConfigWarnings += Number(row.count);
      }
      logs.set(bucket, value);
    }
    const logCounts = [...logs.values()].reduce(
      (sum, bucket) => ({
        errors: sum.errors + bucket.errors,
        warnings: sum.warnings + bucket.warnings,
      }),
      { errors: 0, warnings: 0 }
    );
    return buildHistoryOverview(
      range,
      buckets,
      routes,
      result.statuses ?? [],
      result.breakdowns ?? [],
      [...logs.values()],
      { ...logCounts, userConfigErrors, userConfigWarnings },
      Number(result.users),
      metrics.find((row) => row.kind === 'total') ?? { p50Ms: null, p95Ms: null, p99Ms: null }
    );
  }

  async groupRequests(range: TimeRange, filter: RequestFilter, by: RequestGroupColumn) {
    const { params, where } = this.requestWhere(range, filter);
    params.push(groupSeriesBucketMs(range));
    const bucket = `$${params.length}`;
    // `by` comes from the REQUEST_GROUP_COLUMNS allowlist.
    const { rows } = await this.pool.query(
      `WITH filtered AS MATERIALIZED (
         SELECT ${by}::text AS key, ts, status, duration_ms, weight::double precision AS weight,
           upstream_calls, user_hash
         FROM obs_requests WHERE ${where.join(' AND ')}
       ), ranked AS (
         SELECT *, sum(weight) OVER (PARTITION BY key ORDER BY duration_ms) AS cumulative,
           sum(weight) OVER (PARTITION BY key) AS key_total
         FROM filtered
       ), groups AS (
         SELECT key, sum(weight)::float AS count,
           COALESCE(sum(weight) FILTER (WHERE status >= 500), 0)::float AS errors5xx,
           COALESCE(sum(weight) FILTER (WHERE status >= 400 AND status < 500), 0)::float AS errors4xx,
           round(sum(duration_ms * weight) / sum(weight))::int AS avg_ms,
           min(duration_ms) FILTER (WHERE cumulative >= key_total * 0.5) AS p50_ms,
           min(duration_ms) FILTER (WHERE cumulative >= key_total * 0.95) AS p95_ms,
           min(duration_ms) FILTER (WHERE cumulative >= key_total * 0.99) AS p99_ms,
           round((sum(upstream_calls * weight) / sum(weight))::numeric, 1)::float AS avg_upstream_calls,
           count(DISTINCT user_hash) FILTER (WHERE user_hash <> '')::int AS users
         FROM ranked GROUP BY key ORDER BY count DESC LIMIT ${REQUEST_GROUP_LIMIT}
       ), series AS (
         SELECT (floor(extract(epoch FROM ts) * 1000 / ${bucket})::bigint * ${bucket}) AS bucket, key,
           sum(weight)::float AS n
         FROM filtered
         WHERE key IN (SELECT key FROM groups ORDER BY count DESC LIMIT ${REQUEST_GROUP_SERIES})
         GROUP BY 1, 2
       )
       SELECT COALESCE((SELECT json_agg(groups ORDER BY count DESC) FROM groups), '[]'::json) AS groups,
         COALESCE((SELECT json_agg(series) FROM series), '[]'::json) AS series,
         (SELECT COALESCE(sum(weight), 0)::float FROM filtered) AS total`,
      params
    );
    const groups = (rows[0].groups as Record<string, unknown>[]).map(toGroupRow);
    return {
      groups,
      total: Math.round(Number(rows[0].total)),
      series: buildGroupSeries(
        range,
        groups,
        (rows[0].series as Record<string, unknown>[]).map((p) => ({
          bucket: Number(p.bucket),
          key: String(p.key ?? ''),
          n: Number(p.n),
        }))
      ),
    };
  }

  async routeStats(range: TimeRange) {
    const { rows } = await this.pool.query(
      `WITH ranked AS (
         SELECT *, sum(weight::double precision) OVER (PARTITION BY route ORDER BY duration_ms) AS cumulative,
           sum(weight::double precision) OVER (PARTITION BY route) AS total
         FROM obs_requests WHERE ts >= $1 AND ts <= $2
       )
       SELECT route, sum(weight::double precision)::bigint AS count,
         COALESCE(sum(weight::double precision) FILTER (WHERE status >= 500), 0)::bigint AS errors5xx,
         COALESCE(sum(weight::double precision) FILTER (WHERE status >= 400 AND status < 500), 0)::bigint AS errors4xx,
         round(sum(duration_ms * weight::double precision) / sum(weight::double precision))::int AS avg_ms,
         min(duration_ms) FILTER (WHERE cumulative >= total * 0.5) AS p50_ms,
         min(duration_ms) FILTER (WHERE cumulative >= total * 0.95) AS p95_ms,
         min(duration_ms) FILTER (WHERE cumulative >= total * 0.99) AS p99_ms,
         max(duration_ms) AS max_ms,
         round((sum(upstream_calls * weight::double precision) / sum(weight::double precision))::numeric, 1) AS avg_upstream_calls,
         bool_or(weight <> 1) AS "percentilesApproximate"
       FROM ranked
       GROUP BY route ORDER BY count DESC LIMIT 200`,
      [new Date(range.from), new Date(range.to)]
    );
    return rows;
  }

  async listErrorGroups(range: TimeRange, filter: ErrorFilter) {
    const params: unknown[] = [new Date(range.from), new Date(range.to)];
    const where = ['g.last_seen >= $1', 'g.first_seen <= $2'];
    if (filter.status) {
      params.push(filter.status);
      where.push(`g.status = $${params.length}`);
    } else if (filter.active) {
      where.push(`g.status IN ('open', 'regressed')`);
    }
    if (filter.level) {
      params.push(filter.level);
      where.push(`g.level = $${params.length}`);
    }
    if (filter.classification) {
      params.push(filter.classification);
      where.push(`g.classification = $${params.length}`);
    }
    if (filter.q) {
      params.push(likePattern(filter.q));
      where.push(`(g.message ILIKE $${params.length} OR g.context ILIKE $${params.length})`);
    }
    const bucket = bucketForRange(range) === 86_400_000 ? 'day' : 'hour';
    const { rows } = await this.pool.query(
      `SELECT g.*,
         (SELECT json_agg(json_build_array(extract(epoch FROM b.bucket)::bigint, b.n) ORDER BY b.bucket)
            FROM (SELECT date_trunc('${bucket}', e.ts) AS bucket, sum(coalesce(e.occurrences, 1)) AS n FROM obs_error_events e
                  WHERE e.fingerprint = g.fingerprint AND e.ts >= $1 AND e.ts <= $2 GROUP BY 1) b) AS spark
       FROM obs_error_groups g WHERE ${where.join(' AND ')}
       ORDER BY g.last_seen DESC LIMIT 200`,
      params
    );
    return rows;
  }

  async getErrorGroup(fingerprint: string) {
    const [group, events, routes] = await Promise.all([
      this.pool.query('SELECT * FROM obs_error_groups WHERE fingerprint = $1', [fingerprint]),
      this.pool.query(
        `SELECT ts, level, request_id, instance, route, message, occurrences, classification FROM obs_error_events
         WHERE fingerprint = $1 ORDER BY ts DESC LIMIT 100`,
        [fingerprint]
      ),
      this.pool.query(
        `SELECT route, sum(coalesce(occurrences, 1)) AS count FROM obs_error_events WHERE fingerprint = $1
         GROUP BY route ORDER BY count DESC LIMIT 20`,
        [fingerprint]
      ),
    ]);
    if (!group.rows[0]) return null;
    return { group: group.rows[0], events: events.rows, routes: routes.rows };
  }

  async setErrorStatus(fingerprint: string, status: string) {
    if (!SETTABLE_ERROR_STATUSES.has(status)) return false;
    const res = await this.pool.query(
      'UPDATE obs_error_groups SET status = $2, status_changed_at = now() WHERE fingerprint = $1',
      [fingerprint, status]
    );
    return (res.rowCount ?? 0) > 0;
  }

  async upstreamEndpoints(range: TimeRange, provider?: string) {
    const params: unknown[] = [new Date(range.from), new Date(range.to)];
    let extra = '';
    if (provider) {
      params.push(provider);
      extra = `AND provider = $${params.length}`;
    }
    const [endpoints, recentErrors] = await Promise.all([
      this.pool.query(
        `SELECT provider, method, path, count(*) AS calls,
           count(*) FILTER (WHERE NOT cancelled AND (status = 0 OR status >= 500)) AS errors,
           count(*) FILTER (WHERE NOT cancelled AND status >= 400 AND status < 500 AND status <> 429) AS rejected,
           count(*) FILTER (WHERE NOT cancelled AND status = 429) AS rate_limited,
           count(*) FILTER (WHERE NOT cancelled AND timed_out) AS timeouts,
           count(*) FILTER (WHERE cancelled) AS cancelled,
           round(avg(duration_ms))::int AS avg_ms,
           percentile_disc(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_ms,
           max(duration_ms) AS max_ms
         FROM obs_upstream WHERE ts >= $1 AND ts <= $2 ${extra}
         GROUP BY provider, method, path ORDER BY calls DESC LIMIT 100`,
        params
      ),
      this.pool.query(
        `WITH transport AS (
           SELECT ts, provider, method, path, status, duration_ms, error, request_id, cancelled FROM obs_upstream
           WHERE ts >= $1 AND ts <= $2 ${extra} AND NOT cancelled AND (status = 0 OR status >= 500)
           ORDER BY ts DESC LIMIT 25
         ), limited AS (
           SELECT ts, provider, method, path, status, duration_ms, error, request_id, cancelled FROM obs_upstream
           WHERE ts >= $1 AND ts <= $2 ${extra} AND NOT cancelled AND status = 429
           ORDER BY ts DESC LIMIT 25
         ), rejected AS (
           SELECT ts, provider, method, path, status, duration_ms, error, request_id, cancelled FROM obs_upstream
           WHERE ts >= $1 AND ts <= $2 ${extra} AND NOT cancelled AND status >= 400 AND status < 500 AND status <> 429
           ORDER BY ts DESC LIMIT 25
         ), cancellations AS (
           SELECT ts, provider, method, path, status, duration_ms, error, request_id, cancelled FROM obs_upstream
           WHERE ts >= $1 AND ts <= $2 ${extra} AND cancelled
           ORDER BY ts DESC LIMIT 25
         )
         SELECT * FROM transport UNION ALL SELECT * FROM limited UNION ALL SELECT * FROM rejected
         UNION ALL SELECT * FROM cancellations ORDER BY ts DESC LIMIT 100`,
        params
      ),
    ]);
    return { endpoints: endpoints.rows, recentErrors: recentErrors.rows };
  }

  async upstreamOverview(range: TimeRange) {
    const bucketMs = range.kind === 'm' ? 60_000 : 3_600_000;
    const histogram = [
      ...LATENCY_BUCKETS.map((upper, index) => {
        const condition = index
          ? `duration_ms > ${LATENCY_BUCKETS[index - 1]} AND duration_ms <= ${upper}`
          : `duration_ms <= ${upper}`;
        return `COALESCE(SUM(1) FILTER (WHERE ${condition}), 0)::float AS lat_${index}`;
      }),
      `COALESCE(SUM(1) FILTER (WHERE duration_ms > ${LATENCY_BUCKETS.at(-1)}), 0)::float AS lat_${LATENCY_BUCKETS.length}`,
    ].join(',');
    const { rows } = await this.pool.query(
      `WITH filtered AS (
         SELECT *, (floor(extract(epoch FROM ts) * 1000 / $3)::bigint * $3) AS bucket
         FROM obs_upstream WHERE ts >= $1 AND ts <= $2
       )
       SELECT provider, bucket, grouping(bucket) AS is_total,
         count(*)::float AS calls,
         count(*) FILTER (WHERE NOT cancelled AND (status = 0 OR status >= 500))::float AS errors,
         count(*) FILTER (WHERE NOT cancelled AND status = 429)::float AS "rateLimited",
         count(*) FILTER (WHERE NOT cancelled AND status >= 400 AND status < 500 AND status <> 429)::float AS rejected,
         count(*) FILTER (WHERE NOT cancelled AND timed_out)::float AS timeouts,
         count(*) FILTER (WHERE cancelled)::float AS cancelled,
         COALESCE(sum(duration_ms), 0)::float AS duration,
         percentile_disc(0.5) WITHIN GROUP (ORDER BY duration_ms) AS "p50Ms",
         percentile_disc(0.95) WITHIN GROUP (ORDER BY duration_ms) AS "p95Ms",
         percentile_disc(0.99) WITHIN GROUP (ORDER BY duration_ms) AS "p99Ms",
         ${histogram}
       FROM filtered GROUP BY GROUPING SETS ((provider, bucket), (provider)) ORDER BY provider, bucket`,
      [new Date(range.from), new Date(range.to), bucketMs]
    );
    return buildHistoryUpstreamOverview(
      range,
      rows
        .filter((row) => !row.is_total)
        .map((row) => ({
          provider: String(row.provider),
          bucket: Number(row.bucket),
          calls: Number(row.calls),
          errors: Number(row.errors),
          rateLimited: Number(row.rateLimited),
          rejected: Number(row.rejected),
          timeouts: Number(row.timeouts),
          cancelled: Number(row.cancelled),
          duration: Number(row.duration),
          p95Ms: Number(row.p95Ms),
          histogram: LATENCY_BUCKETS.map((_, index) => Number(row[`lat_${index}`])).concat(
            Number(row[`lat_${LATENCY_BUCKETS.length}`])
          ),
        })),
      new Map(
        rows
          .filter((row) => row.is_total)
          .map((row) => [
            row.provider,
            {
              p50Ms: Number(row.p50Ms),
              p95Ms: Number(row.p95Ms),
              p99Ms: Number(row.p99Ms),
            },
          ])
      )
    );
  }

  async usageStats(range: TimeRange) {
    const params = [new Date(range.from), new Date(range.to)];
    const [catalogs, daily] = await Promise.all([
      this.pool.query(
        `WITH ranked AS (
           SELECT *, sum(weight::double precision) OVER (
             PARTITION BY catalog_id, source, content_type ORDER BY duration_ms
           ) AS cumulative, sum(weight::double precision) OVER (
             PARTITION BY catalog_id, source, content_type
           ) AS total FROM obs_requests WHERE ts >= $1 AND ts <= $2 AND resource = 'catalog'
         )
         SELECT catalog_id, source, content_type, sum(weight::double precision)::bigint AS requests,
           count(DISTINCT user_hash) AS users,
           COALESCE(sum(weight::double precision) FILTER (WHERE status >= 500), 0)::bigint AS errors,
           min(duration_ms) FILTER (WHERE cumulative >= total * 0.95) AS p95_ms,
           bool_or(weight <> 1) AS "percentilesApproximate"
         FROM ranked
         GROUP BY catalog_id, source, content_type ORDER BY requests DESC LIMIT 50`,
        params
      ),
      this.pool.query(
        `SELECT date_trunc('day', ts) AS day,
           count(DISTINCT user_hash) FILTER (WHERE user_hash <> '') AS users,
           sum(weight::double precision)::bigint AS requests,
           COALESCE(sum(weight::double precision) FILTER (WHERE resource = 'manifest'), 0)::bigint AS manifest_fetches
         FROM obs_requests WHERE ts >= $1 AND ts <= $2 GROUP BY 1 ORDER BY 1`,
        params
      ),
    ]);
    return { topCatalogs: catalogs.rows, daily: daily.rows };
  }

  async systemSeries(range: TimeRange) {
    // Downsample to ~300 points per instance.
    const stepSec = Math.max(30, Math.floor((range.to - range.from) / 1000 / 300));
    const { rows } = await this.pool.query(
      `SELECT DISTINCT ON (instance, bucket) instance, bucket, data FROM (
         SELECT instance, data, ts, to_timestamp(floor(extract(epoch FROM ts) / $3) * $3) AS bucket
         FROM obs_system_samples WHERE ts >= $1 AND ts <= $2
       ) s ORDER BY instance, bucket, ts DESC`,
      [new Date(range.from), new Date(range.to), stepSec]
    );
    return rows;
  }

  async storageInfo(): Promise<StorageInfo> {
    const { rows } = await this.pool.query(
      `SELECT p.relname AS table_name, count(i.inhrelid)::int AS partitions,
         COALESCE(sum(pg_total_relation_size(i.inhrelid)), pg_total_relation_size(p.oid))::bigint AS bytes
       FROM pg_class p LEFT JOIN pg_inherits i ON i.inhparent = p.oid
       WHERE p.relname = ANY($1) AND p.relkind IN ('r', 'p')
       GROUP BY p.relname, p.oid`,
      [ALL_TABLES]
    );
    const tables = rows.map((r) => ({ ...r, bytes: Number(r.bytes) }));
    const totalBytes = tables.reduce((sum, t) => sum + t.bytes, 0);
    return {
      tables,
      totalBytes,
      capBytes: this.capBytes,
      paused: !!this.capBytes && totalBytes > this.capBytes,
    };
  }

  async businessAnalytics() {
    const [summary, bySource, filterKeys, prefs, activity, market, topMarket] = await Promise.all([
      this.pool.query(
        `SELECT count(*) AS configs, count(DISTINCT api_key_id) AS api_keys,
           COALESCE(sum(jsonb_array_length(${CATALOGS_SQL})), 0) AS catalogs,
           count(*) FILTER (WHERE updated_at > now() - interval '1 day') AS updated_1d,
           count(*) FILTER (WHERE updated_at > now() - interval '7 days') AS updated_7d,
           count(*) FILTER (WHERE updated_at > now() - interval '30 days') AS updated_30d
         FROM user_configs`
      ),
      this.pool.query(
        `SELECT COALESCE(c->>'source', 'tmdb') AS source, COALESCE(c->>'type', '?') AS type, count(*) AS count
         FROM user_configs, jsonb_array_elements(${CATALOGS_SQL}) c
         GROUP BY 1, 2 ORDER BY count DESC`
      ),
      this.pool.query(
        `SELECT k AS key, count(*) AS count
         FROM user_configs, jsonb_array_elements(${CATALOGS_SQL}) c,
           jsonb_object_keys(CASE WHEN jsonb_typeof(c->'filters') = 'object' THEN c->'filters' ELSE '{}'::jsonb END) k
         GROUP BY 1 ORDER BY count DESC LIMIT 40`
      ),
      this.pool.query(
        `SELECT
           count(*) FILTER (WHERE data->'preferences'->>'showAdultContent' = 'true') AS show_adult,
           count(*) FILTER (WHERE data->'preferences'->>'shuffleCatalogs' = 'true') AS shuffle,
           count(*) FILTER (WHERE data->'preferences'->>'disableSearch' = 'true') AS search_disabled,
           count(*) FILTER (WHERE COALESCE(data->>'malClientIdEncrypted', '') <> '') AS has_mal_key,
           count(*) FILTER (WHERE COALESCE(data->>'simklApiKeyEncrypted', '') <> '') AS has_simkl_key,
           count(*) FILTER (WHERE jsonb_typeof(data->'preferences'->'apiKeysEncrypted') = 'object'
                              AND data->'preferences'->'apiKeysEncrypted' <> '{}'::jsonb) AS has_artwork_keys
         FROM user_configs`
      ),
      this.pool.query(
        `SELECT date_trunc('day', updated_at) AS day, count(*) AS updated
         FROM user_configs WHERE updated_at > now() - interval '30 days' GROUP BY 1 ORDER BY 1`
      ),
      this.pool
        .query(
          `SELECT count(*) AS entries, COALESCE(sum(installs), 0) AS installs,
             COALESCE(sum(likes), 0) AS likes, COALESCE(sum(views), 0) AS views
           FROM marketplace_entries WHERE visibility = 'public' AND moderation = 'active'`
        )
        .catch(() => ({ rows: [] })),
      this.pool
        .query(
          `SELECT name, source, type, installs, likes, views, published_at FROM marketplace_entries
           WHERE visibility = 'public' AND moderation = 'active' ORDER BY installs DESC LIMIT 15`
        )
        .catch(() => ({ rows: [] })),
    ]);
    return {
      summary: summary.rows[0],
      catalogsBySource: bySource.rows,
      popularFilters: filterKeys.rows,
      preferences: prefs.rows[0],
      configActivity: activity.rows,
      marketplace: { totals: market.rows[0] ?? null, top: topMarket.rows },
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
