import pg from 'pg';
import { createLogger } from '../../../utils/logger.ts';
import type { TimeRange } from '../liveQueries.ts';
import type { ErrorEvent, RequestEvent, SystemSample, UpstreamEvent } from '../types.ts';
import {
  SETTABLE_ERROR_STATUSES,
  bucketForRange,
  encodeCursor,
  type ErrorFilter,
  type ErrorGroupBatch,
  type HistoryStore,
  type RequestFilter,
  type StorageInfo,
} from './types.ts';

const log = createLogger('obs:pg');

const PARTITIONED_TABLES = ['obs_requests', 'obs_upstream', 'obs_error_events'] as const;
const ALL_TABLES = [...PARTITIONED_TABLES, 'obs_error_groups', 'obs_system_samples'];
const LOCK_KEY = 'tdp_obs_maintenance';
const MAX_ROWS_PER_INSERT = 2000;

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
           duration_ms, error, timed_out)
         SELECT * FROM unnest($1::timestamptz[], $2::text[], $3::text[], $4::text[], $5::text[],
           $6::text[], $7::text[], $8::smallint[], $9::int[], $10::text[], $11::boolean[])`,
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
           first_seen, last_seen, count, status, first_version, last_version)
         SELECT fp, lvl, ctx, msg, stk, rte, fs, ls, cnt, 'open', $10, $10
         FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[],
           $7::timestamptz[], $8::timestamptz[], $9::bigint[]) AS t(fp, lvl, ctx, msg, stk, rte, fs, ls, cnt)
         ON CONFLICT (fingerprint) DO UPDATE SET
           last_seen = GREATEST(obs_error_groups.last_seen, EXCLUDED.last_seen),
           count = obs_error_groups.count + EXCLUDED.count,
           last_version = EXCLUDED.last_version,
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
        ]
      );
    }
    for (let i = 0; i < events.length; i += MAX_ROWS_PER_INSERT) {
      const chunk = events.slice(i, i + MAX_ROWS_PER_INSERT);
      await this.pool.query(
        `INSERT INTO obs_error_events (ts, fingerprint, level, request_id, instance, route, message)
         SELECT * FROM unnest($1::timestamptz[], $2::text[], $3::text[], $4::text[], $5::text[],
           $6::text[], $7::text[])`,
        [
          chunk.map((e) => new Date(e.ts)),
          chunk.map((e) => e.fingerprint),
          chunk.map((e) => e.level),
          chunk.map((e) => e.requestId),
          chunk.map((e) => e.instance),
          chunk.map((e) => e.route),
          chunk.map((e) => e.message),
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

  private requestWhere(range: TimeRange, filter: RequestFilter) {
    const params: unknown[] = [new Date(range.from), new Date(range.to)];
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
    if (filter.statusMin !== undefined) add('status >= ?', filter.statusMin);
    if (filter.statusMax !== undefined) add('status <= ?', filter.statusMax);
    if (filter.minMs !== undefined) add('duration_ms >= ?', filter.minMs);
    if (filter.errorsOnly) where.push("(status >= 500 OR error_fp <> '')");
    if (filter.pathContains) add('path ILIKE ?', likePattern(filter.pathContains));
    if (filter.cursor) add('(ts, request_id) < (?, ?)', filter.cursor.ts, filter.cursor.requestId);
    return { params, where };
  }

  async listRequests(range: TimeRange, filter: RequestFilter, limit: number) {
    const { params, where } = this.requestWhere(range, filter);
    params.push(limit);
    const { rows } = await this.pool.query(
      `SELECT ${REQUEST_COLUMNS} FROM obs_requests WHERE ${where.join(' AND ')}
       ORDER BY ts DESC, request_id DESC LIMIT $${params.length}`,
      params
    );
    return { rows, nextCursor: encodeCursor(rows, limit) };
  }

  async requestFacets(range: TimeRange) {
    const { rows } = await this.pool.query(
      `SELECT 'route' AS facet, route AS value, sum(weight)::bigint AS count FROM obs_requests
         WHERE ts >= $1 AND ts <= $2 GROUP BY route
       UNION ALL
       SELECT 'client', client, sum(weight)::bigint FROM obs_requests WHERE ts >= $1 AND ts <= $2 GROUP BY client
       UNION ALL
       SELECT 'instance', instance, sum(weight)::bigint FROM obs_requests WHERE ts >= $1 AND ts <= $2 GROUP BY instance
       UNION ALL
       SELECT 'country', country, sum(weight)::bigint FROM obs_requests WHERE ts >= $1 AND ts <= $2 AND country <> '' GROUP BY country`,
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
        `SELECT ts, provider, host, method, path, status, duration_ms, error, timed_out
         FROM obs_upstream WHERE request_id = $1 ORDER BY ts LIMIT 500`,
        [requestId]
      ),
      this.pool.query(
        `SELECT e.ts, e.fingerprint, e.level, e.message, g.context, g.status
         FROM obs_error_events e LEFT JOIN obs_error_groups g USING (fingerprint)
         WHERE e.request_id = $1 ORDER BY e.ts LIMIT 200`,
        [requestId]
      ),
    ]);
    return { requests: requests.rows, upstream: upstream.rows, errors: errors.rows };
  }

  async routeStats(range: TimeRange) {
    const { rows } = await this.pool.query(
      `SELECT route, sum(weight)::bigint AS count,
         COALESCE(sum(weight) FILTER (WHERE status >= 500), 0)::bigint AS errors5xx,
         COALESCE(sum(weight) FILTER (WHERE status >= 400 AND status < 500), 0)::bigint AS errors4xx,
         round(avg(duration_ms))::int AS avg_ms,
         percentile_disc(0.5) WITHIN GROUP (ORDER BY duration_ms) AS p50_ms,
         percentile_disc(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_ms,
         percentile_disc(0.99) WITHIN GROUP (ORDER BY duration_ms) AS p99_ms,
         max(duration_ms) AS max_ms,
         round(avg(upstream_calls)::numeric, 1) AS avg_upstream_calls
       FROM obs_requests WHERE ts >= $1 AND ts <= $2
       GROUP BY route ORDER BY count DESC LIMIT 200`,
      [new Date(range.from), new Date(range.to)]
    );
    return rows;
  }

  async listErrorGroups(range: TimeRange, filter: ErrorFilter) {
    const params: unknown[] = [new Date(range.from), new Date(range.to)];
    const where = ['g.last_seen >= $1'];
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
    if (filter.q) {
      params.push(likePattern(filter.q));
      where.push(`(g.message ILIKE $${params.length} OR g.context ILIKE $${params.length})`);
    }
    const bucket = bucketForRange(range) === 86_400_000 ? 'day' : 'hour';
    const { rows } = await this.pool.query(
      `SELECT g.*,
         (SELECT json_agg(json_build_array(extract(epoch FROM b.bucket)::bigint, b.n) ORDER BY b.bucket)
            FROM (SELECT date_trunc('${bucket}', e.ts) AS bucket, count(*) AS n FROM obs_error_events e
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
        `SELECT ts, level, request_id, instance, route, message FROM obs_error_events
         WHERE fingerprint = $1 ORDER BY ts DESC LIMIT 100`,
        [fingerprint]
      ),
      this.pool.query(
        `SELECT route, count(*) AS count FROM obs_error_events WHERE fingerprint = $1
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
           count(*) FILTER (WHERE status = 0 OR status >= 500) AS errors,
           count(*) FILTER (WHERE status = 429) AS rate_limited,
           count(*) FILTER (WHERE timed_out) AS timeouts,
           round(avg(duration_ms))::int AS avg_ms,
           percentile_disc(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_ms,
           max(duration_ms) AS max_ms
         FROM obs_upstream WHERE ts >= $1 AND ts <= $2 ${extra}
         GROUP BY provider, method, path ORDER BY calls DESC LIMIT 100`,
        params
      ),
      this.pool.query(
        `SELECT ts, provider, method, path, status, duration_ms, error, request_id FROM obs_upstream
         WHERE ts >= $1 AND ts <= $2 ${extra} AND (status = 0 OR status >= 400)
         ORDER BY ts DESC LIMIT 50`,
        params
      ),
    ]);
    return { endpoints: endpoints.rows, recentErrors: recentErrors.rows };
  }

  async usageStats(range: TimeRange) {
    const params = [new Date(range.from), new Date(range.to)];
    const [catalogs, daily] = await Promise.all([
      this.pool.query(
        `SELECT catalog_id, source, content_type, sum(weight)::bigint AS requests,
           count(DISTINCT user_hash) AS users,
           COALESCE(sum(weight) FILTER (WHERE status >= 500), 0)::bigint AS errors,
           percentile_disc(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_ms
         FROM obs_requests WHERE ts >= $1 AND ts <= $2 AND resource = 'catalog'
         GROUP BY catalog_id, source, content_type ORDER BY requests DESC LIMIT 50`,
        params
      ),
      this.pool.query(
        `SELECT date_trunc('day', ts) AS day,
           count(DISTINCT user_hash) FILTER (WHERE user_hash <> '') AS users,
           sum(weight)::bigint AS requests,
           COALESCE(sum(weight) FILTER (WHERE resource = 'manifest'), 0)::bigint AS manifest_fetches
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
