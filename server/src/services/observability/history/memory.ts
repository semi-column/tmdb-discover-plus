import type { TimeRange } from '../liveQueries.ts';
import type { ErrorEvent, RequestEvent, SystemSample, UpstreamEvent } from '../types.ts';
import type { UserConfig } from '../../../types/index.ts';
import { cacheCoverage, cacheDetails, cacheMetrics, cacheReadMetrics } from './cache.ts';
import { CACHE_READ_LAYERS, type CacheReads, type CacheReadMetrics } from '../../../types/cache.ts';
import { LATENCY_BUCKETS, latencyBucket } from '../collector.ts';
import {
  buildHistoryUpstreamOverview,
  buildHistoryOverview,
  type OverviewBreakdown,
  type OverviewBucket,
  type OverviewLogBucket,
  type UpstreamOverviewBucket,
} from './overview.ts';
import {
  SETTABLE_ERROR_STATUSES,
  bucketForRange,
  encodeCursor,
  percentileSorted,
  weightedPercentiles,
  type ErrorFilter,
  type ErrorGroupBatch,
  type HistoryStore,
  EMPTY_REQUEST_FILTER,
  REQUEST_GROUP_LIMIT,
  buildGroupSeries,
  groupSeriesBucketMs,
  toGroupRow,
  type RequestFilter,
  type RequestGroupColumn,
  type StorageInfo,
} from './types.ts';

type Row = Record<string, unknown>;

const DAY_MS = 86_400_000;
const MAX_ERROR_GROUPS = 2000;
const MAX_SYSTEM_SAMPLES = 2880;

function toRequestRow(e: RequestEvent): Row {
  return {
    ts: new Date(e.ts),
    request_id: e.requestId,
    instance: e.instance,
    method: e.method,
    route: e.route,
    path: e.path,
    status: e.status,
    duration_ms: e.durationMs,
    resource: e.resource,
    source: e.source,
    content_type: e.contentType,
    catalog_id: e.catalogId,
    user_hash: e.userHash,
    client: e.client,
    ua: e.ua,
    country: e.country,
    colo: e.colo,
    ip_hash: e.ipHash,
    cache_hits: e.cacheHits,
    cache_misses: e.cacheMisses,
    cache_reads: e.cacheReads ?? null,
    upstream_calls: e.upstreamCalls,
    upstream_ms: e.upstreamMs,
    error_fp: e.errorFp,
    weight: e.weight,
  };
}

/** Append to a newest-last ring buffer. */
function pushCapped<T>(list: T[], items: T[], cap: number): void {
  list.push(...items);
  if (list.length > cap) list.splice(0, list.length - cap);
}

function inRange(ts: number, range: TimeRange): boolean {
  return ts >= range.from && ts <= range.to;
}

function sortedDurations(rows: Array<{ durationMs: number }>): number[] {
  return rows.map((r) => r.durationMs).sort((a, b) => a - b);
}

/**
 * Bounded, single-process history for deployments without Postgres or MongoDB.
 * Covers the last `maxEvents` requests on this instance and is lost on restart.
 */
export class MemoryHistory implements HistoryStore {
  readonly kind = 'memory' as const;
  readonly approximatePercentiles = false;
  readonly maxEvents: number;
  private retentionMs: number;
  private version: string;
  private loadConfigs: () => Promise<UserConfig[]>;

  private requests: RequestEvent[] = [];
  private upstream: UpstreamEvent[] = [];
  private errorEvents: ErrorEvent[] = [];
  private groups = new Map<string, Row>();
  private system: SystemSample[] = [];

  constructor(opts: {
    maxEvents: number;
    retentionDays: number;
    version: string;
    loadConfigs: () => Promise<UserConfig[]>;
  }) {
    this.maxEvents = opts.maxEvents;
    this.retentionMs = opts.retentionDays * DAY_MS;
    this.version = opts.version;
    this.loadConfigs = opts.loadConfigs;
  }

  async init(): Promise<void> {}

  async close(): Promise<void> {}

  isPaused(): boolean {
    return false;
  }

  async maintain(): Promise<void> {
    const cutoff = Date.now() - this.retentionMs;
    const keep = <T extends { ts: number }>(list: T[]) => list.filter((e) => e.ts >= cutoff);
    this.requests = keep(this.requests);
    this.upstream = keep(this.upstream);
    this.errorEvents = keep(this.errorEvents);
    this.system = keep(this.system);
  }

  async insertRequests(events: RequestEvent[]) {
    pushCapped(this.requests, events, this.maxEvents);
  }

  async insertUpstream(events: UpstreamEvent[]) {
    pushCapped(this.upstream, events, this.maxEvents);
  }

  async insertErrors(events: ErrorEvent[], groups: Map<string, ErrorGroupBatch>) {
    pushCapped(this.errorEvents, events, Math.ceil(this.maxEvents / 2));
    for (const [fp, g] of groups) {
      const existing = this.groups.get(fp);
      if (existing) {
        existing.count = Number(existing.count) + g.count;
        existing.last_seen = new Date(Math.max((existing.last_seen as Date).getTime(), g.lastTs));
        existing.last_version = this.version;
        if (g.first.stack) existing.sample_stack = g.first.stack;
        if (g.first.classification) existing.classification = g.first.classification;
        if (existing.status === 'resolved') {
          existing.status = 'regressed';
          existing.status_changed_at = new Date();
        }
      } else {
        this.groups.set(fp, {
          fingerprint: fp,
          level: g.first.level,
          context: g.first.context,
          message: g.first.message,
          classification: g.first.classification ?? '',
          sample_stack: g.first.stack,
          sample_route: g.first.route,
          first_seen: new Date(g.first.ts),
          last_seen: new Date(g.lastTs),
          count: g.count,
          status: 'open',
          status_changed_at: null,
          first_version: this.version,
          last_version: this.version,
        });
      }
    }
    if (this.groups.size > MAX_ERROR_GROUPS) {
      const oldest = [...this.groups.values()]
        .sort((a, b) => (a.last_seen as Date).getTime() - (b.last_seen as Date).getTime())
        .slice(0, this.groups.size - MAX_ERROR_GROUPS);
      for (const g of oldest) this.groups.delete(g.fingerprint as string);
    }
  }

  async insertSystem(samples: SystemSample[]) {
    pushCapped(this.system, samples, MAX_SYSTEM_SAMPLES);
  }

  private matches(e: RequestEvent, range: TimeRange, f: RequestFilter): boolean {
    if (!inRange(e.ts, range)) return false;
    const row = toRequestRow(e);
    for (const [field, value] of Object.entries(f.exact)) if (row[field] !== value) return false;
    for (const [field, values] of Object.entries(f.exclude))
      if (values.includes(row[field] as string)) return false;
    if (f.excludeStatus.some(([min, max]) => e.status >= min && e.status <= max)) return false;
    if (f.statusMin !== undefined && (e.status < f.statusMin || e.status > (f.statusMax ?? 999)))
      return false;
    if (f.minMs !== undefined && e.durationMs < f.minMs) return false;
    if (f.maxMs !== undefined && e.durationMs > f.maxMs) return false;
    if (f.minUpstreamCalls !== undefined && e.upstreamCalls < f.minUpstreamCalls) return false;
    if (f.errorsOnly && !(e.status >= 500 || e.errorFp)) return false;
    if (f.pathContains && !e.path.toLowerCase().includes(f.pathContains.toLowerCase()))
      return false;
    return true;
  }

  async listRequests(range: TimeRange, filter: RequestFilter, limit: number) {
    const sort = filter.sort ?? 'newest';
    const metric = (e: RequestEvent) =>
      sort === 'duration' ? e.durationMs : sort === 'upstreamCalls' ? e.upstreamCalls : 0;
    const compare = (a: RequestEvent, b: RequestEvent) =>
      metric(b) - metric(a) ||
      (sort === 'oldest' ? 1 : -1) *
        (a.ts - b.ts || (a.requestId < b.requestId ? -1 : a.requestId > b.requestId ? 1 : 0));
    const matching = this.requests.filter((event) => this.matches(event, range, filter));
    const cursor = filter.cursor;
    const page = matching
      .filter((event) => {
        if (!cursor) return true;
        if ((sort === 'duration' || sort === 'upstreamCalls') && metric(event) !== cursor.value)
          return metric(event) < cursor.value!;
        return sort === 'oldest'
          ? event.ts > cursor.ts.getTime() ||
              (event.ts === cursor.ts.getTime() && event.requestId > cursor.requestId)
          : event.ts < cursor.ts.getTime() ||
              (event.ts === cursor.ts.getTime() && event.requestId < cursor.requestId);
      })
      .sort(compare);
    const rows = page.slice(0, limit).map(toRequestRow);
    return {
      rows,
      total: matching.length,
      nextCursor: page.length > limit ? encodeCursor(rows, limit, sort) : null,
    };
  }

  async requestFacets(range: TimeRange) {
    const counts: Record<string, Map<string, number>> = {
      route: new Map(),
      client: new Map(),
      instance: new Map(),
      country: new Map(),
    };
    for (const e of this.requests) {
      if (!inRange(e.ts, range)) continue;
      for (const [facet, value] of [
        ['route', e.route],
        ['client', e.client],
        ['instance', e.instance],
        ['country', e.country],
      ] as const) {
        if (value) counts[facet].set(value, (counts[facet].get(value) ?? 0) + e.weight);
      }
    }
    return Object.fromEntries(
      Object.entries(counts).map(([facet, map]) => [
        facet,
        [...map.entries()]
          .map(([value, count]) => ({ value, count: Math.round(count) }))
          .sort((a, b) => b.count - a.count),
      ])
    );
  }

  async getTrace(requestId: string) {
    return {
      requests: this.requests.filter((e) => e.requestId === requestId).map(toRequestRow),
      upstream: this.upstream
        .filter((u) => u.requestId === requestId)
        .map((u) => ({
          ts: new Date(u.ts),
          provider: u.provider,
          host: u.host,
          method: u.method,
          path: u.path,
          status: u.status,
          duration_ms: u.durationMs,
          error: u.error,
          timed_out: u.timedOut,
          cancelled: u.cancelled ?? false,
        })),
      errors: this.errorEvents
        .filter((e) => e.requestId === requestId)
        .map((e) => ({
          ts: new Date(e.ts),
          fingerprint: e.fingerprint,
          level: e.level,
          message: e.message,
          context: e.context,
          occurrences: e.occurrences ?? 1,
          classification: e.classification ?? '',
          status: this.groups.get(e.fingerprint)?.status ?? '',
        })),
    };
  }

  async groupRequests(range: TimeRange, filter: RequestFilter, by: RequestGroupColumn) {
    const byKey = new Map<string, RequestEvent[]>();
    const matching = this.requests.filter((event) => this.matches(event, range, filter));
    const keyOf = (e: RequestEvent) => String(toRequestRow(e)[by] ?? '');
    for (const e of matching) {
      const key = keyOf(e);
      const list = byKey.get(key) ?? [];
      list.push(e);
      byKey.set(key, list);
    }
    const groups = [...byKey.entries()]
      .map(([key, list]) => {
        const sum = (fn: (e: RequestEvent) => number) => list.reduce((acc, e) => acc + fn(e), 0);
        const weight = sum((e) => e.weight);
        const percentiles = weightedPercentiles(list.map((e) => [e.durationMs, e.weight]));
        return toGroupRow({
          key,
          count: weight,
          errors5xx: sum((e) => (e.status >= 500 ? e.weight : 0)),
          errors4xx: sum((e) => (e.status >= 400 && e.status < 500 ? e.weight : 0)),
          avg_ms: Math.round(sum((e) => e.durationMs * e.weight) / weight),
          p50_ms: percentiles.p50Ms,
          p95_ms: percentiles.p95Ms,
          p99_ms: percentiles.p99Ms,
          avg_upstream_calls: sum((e) => e.upstreamCalls * e.weight) / weight,
          users: new Set(list.map((e) => e.userHash).filter(Boolean)).size,
        });
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, REQUEST_GROUP_LIMIT);
    const bucketMs = groupSeriesBucketMs(range);
    return {
      groups,
      total: Math.round(matching.reduce((acc, e) => acc + e.weight, 0)),
      series: buildGroupSeries(
        range,
        groups,
        matching.map((e) => ({
          bucket: Math.floor(e.ts / bucketMs) * bucketMs,
          key: keyOf(e),
          n: e.weight,
        }))
      ),
    };
  }

  async cacheStats(range: TimeRange, filter: RequestFilter, by: 'route' | 'path') {
    const totals = cacheMetrics();
    const groups = new Map<string, ReturnType<typeof cacheMetrics>>();
    const coverage = cacheCoverage();
    const reads: CacheReads = {};
    let sampled = false;
    for (const e of this.requests) {
      if (!this.matches(e, range, filter)) continue;
      coverage.retainedRequests++;
      const ts = new Date(e.ts).toISOString();
      if (!coverage.oldest || ts < coverage.oldest) coverage.oldest = ts;
      if (!coverage.newest || ts > coverage.newest) coverage.newest = ts;
      sampled ||= e.weight !== 1;
      if (e.cacheReads !== undefined) {
        coverage.detailedRequests++;
        if (!coverage.detailedOldest || ts < coverage.detailedOldest) coverage.detailedOldest = ts;
        for (const layer of CACHE_READ_LAYERS) {
          if (!e.cacheReads[layer]) continue;
          const row = (reads[layer] ??= cacheReadMetrics());
          for (const field of Object.keys(row) as Array<keyof CacheReadMetrics>) {
            row[field] += e.cacheReads[layer][field] * e.weight;
          }
        }
      }
      if (e.cacheHits + e.cacheMisses === 0) continue;
      const key = e[by];
      const group = groups.get(key) ?? cacheMetrics();
      groups.set(key, group);
      for (const row of [totals, group]) {
        row.requests += e.weight;
        row.hits += e.cacheHits * e.weight;
        row.misses += e.cacheMisses * e.weight;
        if (e.cacheMisses === 0) row.allHits += e.weight;
        else {
          if (e.cacheHits > 0) row.mixed += e.weight;
          else row.missesOnly += e.weight;
          if (e.upstreamCalls > 0) row.missesWithUpstream += e.weight;
        }
      }
    }
    return {
      totals,
      sampled,
      coverage,
      details: cacheDetails(reads),
      groups: [...groups]
        .map(([key, row]) => ({ key, ...row }))
        .sort(
          (a, b) => b.misses - a.misses || b.requests - a.requests || a.key.localeCompare(b.key)
        )
        .slice(0, REQUEST_GROUP_LIMIT),
    };
  }

  async routeStats(range: TimeRange) {
    return this.routeRows(this.requests.filter((event) => inRange(event.ts, range)));
  }

  private routeRows(events: RequestEvent[]) {
    const byRoute = new Map<string, RequestEvent[]>();
    for (const e of events) {
      const list = byRoute.get(e.route) ?? [];
      list.push(e);
      byRoute.set(e.route, list);
    }
    return [...byRoute.entries()]
      .map(([route, list]) => {
        const sorted = sortedDurations(list);
        const sum = (fn: (e: RequestEvent) => number) => list.reduce((acc, e) => acc + fn(e), 0);
        const weight = sum((e) => e.weight);
        const percentiles = weightedPercentiles(list.map((e) => [e.durationMs, e.weight]));
        return {
          route,
          count: Math.round(sum((e) => e.weight)),
          errors5xx: Math.round(sum((e) => (e.status >= 500 ? e.weight : 0))),
          errors4xx: Math.round(sum((e) => (e.status >= 400 && e.status < 500 ? e.weight : 0))),
          avg_ms: Math.round(sum((e) => e.durationMs * e.weight) / weight),
          p50_ms: percentiles.p50Ms,
          p95_ms: percentiles.p95Ms,
          p99_ms: percentiles.p99Ms,
          max_ms: sorted[sorted.length - 1],
          avg_upstream_calls: (sum((e) => e.upstreamCalls * e.weight) / weight).toFixed(1),
          percentilesApproximate: list.some((e) => e.weight !== 1),
        };
      })
      .sort((a, b) => b.count - a.count);
  }

  async overview(range: TimeRange, slowMs: number, filter: RequestFilter = EMPTY_REQUEST_FILTER) {
    const bucketMs = range.kind === 'm' ? 60_000 : 3_600_000;
    const buckets = new Map<number, OverviewBucket>();
    const statuses = new Map<number, number>();
    const breakdowns = new Map<string, number>();
    const users = new Set<string>();
    const events = this.requests.filter((event) => this.matches(event, range, filter));
    const durations = new Map<number, Array<[number, number]>>();
    const getBucket = (ts: number) => {
      const time = Math.floor(ts / bucketMs) * bucketMs;
      let bucket = buckets.get(time);
      if (!bucket) {
        bucket = {
          bucket: time,
          requests: 0,
          errors5xx: 0,
          errors4xx: 0,
          slow: 0,
          duration: 0,
          cacheHits: 0,
          cacheMisses: 0,
          histogram: Array(LATENCY_BUCKETS.length + 1).fill(0),
        };
        buckets.set(time, bucket);
      }
      return bucket;
    };
    for (const event of events) {
      const bucket = getBucket(event.ts);
      const values = durations.get(bucket.bucket) ?? [];
      values.push([event.durationMs, event.weight]);
      durations.set(bucket.bucket, values);
      bucket.sampled ||= event.weight !== 1;
      const weight = event.weight;
      bucket.requests += weight;
      if (event.status >= 500) bucket.errors5xx += weight;
      else if (event.status >= 400) bucket.errors4xx += weight;
      if (event.durationMs >= slowMs) bucket.slow += weight;
      bucket.duration += event.durationMs * weight;
      bucket.cacheHits += event.cacheHits * weight;
      bucket.cacheMisses += event.cacheMisses * weight;
      bucket.histogram[latencyBucket(event.durationMs)] += weight;
      statuses.set(event.status, (statuses.get(event.status) ?? 0) + weight);
      for (const [kind, key] of Object.entries({
        resource: event.resource,
        source: event.source,
        contentType: event.contentType,
        client: event.client,
        country: event.country,
        colo: event.colo,
        instance: event.instance,
      })) {
        if (key) {
          const composite = `${kind}\0${key}`;
          breakdowns.set(composite, (breakdowns.get(composite) ?? 0) + weight);
        }
      }
      if (event.userHash) users.add(event.userHash);
    }
    const logBuckets = new Map<number, OverviewLogBucket>();
    let errors = 0,
      warnings = 0,
      userConfigErrors = 0,
      userConfigWarnings = 0;
    for (const event of this.errorEvents) {
      if (!inRange(event.ts, range)) continue;
      const time = Math.floor(event.ts / bucketMs) * bucketMs;
      const bucket = logBuckets.get(time) ?? { bucket: time, errors: 0, warnings: 0 };
      if (event.level === 'error') {
        errors += event.occurrences ?? 1;
        bucket.errors += event.occurrences ?? 1;
      } else {
        warnings += event.occurrences ?? 1;
        bucket.warnings += event.occurrences ?? 1;
      }
      if (event.classification === 'user_config') {
        if (event.level === 'error') userConfigErrors += event.occurrences ?? 1;
        else userConfigWarnings += event.occurrences ?? 1;
      }
      logBuckets.set(time, bucket);
    }
    const breakdownRows: OverviewBreakdown[] = [...breakdowns].map(([composite, count]) => {
      const [kind, key] = composite.split('\0');
      return { kind, key, count };
    });
    for (const [time, bucket] of buckets)
      bucket.p95Ms = weightedPercentiles(durations.get(time)!).p95Ms;
    return buildHistoryOverview(
      range,
      [...buckets.values()],
      this.routeRows(events),
      [...statuses].map(([status, count]) => ({ status, count })),
      breakdownRows,
      [...logBuckets.values()],
      { errors, warnings, userConfigErrors, userConfigWarnings },
      users.size,
      weightedPercentiles(events.map((event) => [event.durationMs, event.weight]))
    );
  }

  async listErrorGroups(range: TimeRange, filter: ErrorFilter) {
    const bucketMs = bucketForRange(range);
    const q = filter.q?.toLowerCase();
    return [...this.groups.values()]
      .filter(
        (g) =>
          (g.last_seen as Date).getTime() >= range.from &&
          (g.first_seen as Date).getTime() <= range.to
      )
      .filter((g) =>
        filter.status
          ? g.status === filter.status
          : filter.active
            ? g.status === 'open' || g.status === 'regressed'
            : true
      )
      .filter((g) => !filter.level || g.level === filter.level)
      .filter((g) => !filter.classification || g.classification === filter.classification)
      .filter((g) => !q || `${g.message} ${g.context}`.toLowerCase().includes(q))
      .sort((a, b) => (b.last_seen as Date).getTime() - (a.last_seen as Date).getTime())
      .slice(0, 200)
      .map((g) => {
        const buckets = new Map<number, number>();
        for (const e of this.errorEvents) {
          if (e.fingerprint !== g.fingerprint || !inRange(e.ts, range)) continue;
          const b = Math.floor(e.ts / bucketMs) * bucketMs;
          buckets.set(b, (buckets.get(b) ?? 0) + (e.occurrences ?? 1));
        }
        return {
          ...g,
          spark: [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([b, n]) => [b / 1000, n]),
        };
      });
  }

  async getErrorGroup(fingerprint: string) {
    const group = this.groups.get(fingerprint);
    if (!group) return null;
    const events = this.errorEvents.filter((e) => e.fingerprint === fingerprint);
    const routes = new Map<string, number>();
    for (const e of events) routes.set(e.route, (routes.get(e.route) ?? 0) + (e.occurrences ?? 1));
    return {
      group,
      events: events
        .slice(-100)
        .reverse()
        .map((e) => ({
          ts: new Date(e.ts),
          level: e.level,
          request_id: e.requestId,
          instance: e.instance,
          route: e.route,
          message: e.message,
          occurrences: e.occurrences ?? 1,
          classification: e.classification ?? '',
        })),
      routes: [...routes.entries()]
        .map(([route, count]) => ({ route, count }))
        .sort((a, b) => b.count - a.count),
    };
  }

  async setErrorStatus(fingerprint: string, status: string) {
    const group = this.groups.get(fingerprint);
    if (!group || !SETTABLE_ERROR_STATUSES.has(status)) return false;
    group.status = status;
    group.status_changed_at = new Date();
    return true;
  }

  async upstreamEndpoints(range: TimeRange, provider?: string) {
    const list = this.upstream
      .filter((u) => inRange(u.ts, range) && (!provider || u.provider === provider))
      .sort((a, b) => a.ts - b.ts);
    const byKey = new Map<string, UpstreamEvent[]>();
    for (const u of list) {
      const key = `${u.provider}\u0000${u.method}\u0000${u.path}`;
      const group = byKey.get(key) ?? [];
      group.push(u);
      byKey.set(key, group);
    }
    const endpoints = [...byKey.values()]
      .map((group) => {
        const sorted = sortedDurations(group);
        return {
          provider: group[0].provider,
          method: group[0].method,
          path: group[0].path,
          calls: group.length,
          errors: group.filter((u) => !u.cancelled && (u.status === 0 || u.status >= 500)).length,
          rejected: group.filter(
            (u) => !u.cancelled && u.status >= 400 && u.status < 500 && u.status !== 429
          ).length,
          rate_limited: group.filter((u) => !u.cancelled && u.status === 429).length,
          timeouts: group.filter((u) => !u.cancelled && u.timedOut).length,
          cancelled: group.filter((u) => u.cancelled).length,
          avg_ms: Math.round(group.reduce((a, u) => a + u.durationMs, 0) / group.length),
          p95_ms: percentileSorted(sorted, 0.95),
          max_ms: sorted[sorted.length - 1],
        };
      })
      .sort((a, b) => b.calls - a.calls)
      .slice(0, 100);
    const recentErrors = [
      ...list.filter((u) => !u.cancelled && (u.status === 0 || u.status >= 500)).slice(-25),
      ...list.filter((u) => !u.cancelled && u.status === 429).slice(-25),
      ...list
        .filter((u) => !u.cancelled && u.status >= 400 && u.status < 500 && u.status !== 429)
        .slice(-25),
      ...list.filter((u) => u.cancelled).slice(-25),
    ]
      .sort((a, b) => b.ts - a.ts)
      .map((u) => ({
        ts: new Date(u.ts),
        provider: u.provider,
        method: u.method,
        path: u.path,
        status: u.status,
        duration_ms: u.durationMs,
        error: u.error,
        cancelled: u.cancelled ?? false,
        request_id: u.requestId,
      }));
    return { endpoints, recentErrors };
  }

  async upstreamOverview(range: TimeRange) {
    const bucketMs = range.kind === 'm' ? 60_000 : 3_600_000;
    const buckets = new Map<string, UpstreamOverviewBucket>();
    const durations = new Map<string, Array<[number, number]>>();
    const providerDurations = new Map<string, Array<[number, number]>>();

    for (const event of this.upstream) {
      if (!inRange(event.ts, range)) continue;
      const bucket = Math.floor(event.ts / bucketMs) * bucketMs;
      const key = `${event.provider}\0${bucket}`;
      let row = buckets.get(key);
      if (!row) {
        row = {
          provider: event.provider,
          bucket,
          calls: 0,
          errors: 0,
          rateLimited: 0,
          timeouts: 0,
          rejected: 0,
          cancelled: 0,
          duration: 0,
          histogram: Array(LATENCY_BUCKETS.length + 1).fill(0),
        };
        buckets.set(key, row);
      }
      row.calls++;
      if (event.cancelled) row.cancelled!++;
      else {
        if (event.status === 0 || event.status >= 500) row.errors++;
        if (event.status === 429) row.rateLimited++;
        if (event.status >= 400 && event.status < 500 && event.status !== 429) row.rejected!++;
        if (event.timedOut) row.timeouts++;
      }
      row.duration += event.durationMs;
      row.histogram[latencyBucket(event.durationMs)]++;
      const values = durations.get(key) ?? [];
      values.push([event.durationMs, 1]);
      durations.set(key, values);
      const providerValues = providerDurations.get(event.provider) ?? [];
      providerValues.push([event.durationMs, 1]);
      providerDurations.set(event.provider, providerValues);
    }

    for (const [key, bucket] of buckets)
      bucket.p95Ms = weightedPercentiles(durations.get(key)!).p95Ms;
    return buildHistoryUpstreamOverview(
      range,
      [...buckets.values()],
      new Map(
        [...providerDurations].map(([provider, values]) => [provider, weightedPercentiles(values)])
      )
    );
  }

  async usageStats(range: TimeRange) {
    const catalogs = new Map<string, { row: Row; events: RequestEvent[]; users: Set<string> }>();
    const days = new Map<number, { users: Set<string>; requests: number; manifest: number }>();
    for (const e of this.requests) {
      if (!inRange(e.ts, range)) continue;
      const day = Math.floor(e.ts / DAY_MS) * DAY_MS;
      const d = days.get(day) ?? { users: new Set<string>(), requests: 0, manifest: 0 };
      if (e.userHash) d.users.add(e.userHash);
      d.requests += e.weight;
      if (e.resource === 'manifest') d.manifest += e.weight;
      days.set(day, d);

      if (e.resource !== 'catalog') continue;
      const key = `${e.catalogId}\u0000${e.source}\u0000${e.contentType}`;
      const c = catalogs.get(key) ?? {
        row: { catalog_id: e.catalogId, source: e.source, content_type: e.contentType },
        events: [],
        users: new Set<string>(),
      };
      c.events.push(e);
      if (e.userHash) c.users.add(e.userHash);
      catalogs.set(key, c);
    }
    return {
      topCatalogs: [...catalogs.values()]
        .map((c) => ({
          ...c.row,
          requests: Math.round(c.events.reduce((a, e) => a + e.weight, 0)),
          users: c.users.size,
          errors: Math.round(c.events.reduce((a, e) => a + (e.status >= 500 ? e.weight : 0), 0)),
          p95_ms: weightedPercentiles(c.events.map((event) => [event.durationMs, event.weight]))
            .p95Ms,
          percentilesApproximate: c.events.some((event) => event.weight !== 1),
        }))
        .sort((a, b) => b.requests - a.requests)
        .slice(0, 50),
      daily: [...days.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([day, d]) => ({
          day: new Date(day),
          users: d.users.size,
          requests: Math.round(d.requests),
          manifest_fetches: Math.round(d.manifest),
        })),
    };
  }

  async systemSeries(range: TimeRange) {
    return this.system
      .filter((s) => inRange(s.ts, range))
      .map((s) => ({ instance: s.instance, bucket: new Date(s.ts), data: s.data }));
  }

  async storageInfo(): Promise<StorageInfo> {
    return {
      tables: [],
      totalBytes: 0,
      capBytes: null,
      paused: false,
      memory: {
        requests: this.requests.length,
        upstream: this.upstream.length,
        errorEvents: this.errorEvents.length,
        capacity: this.maxEvents,
      },
    };
  }

  async businessAnalytics() {
    const configs = await this.loadConfigs();
    const now = Date.now();
    const updatedWithin = (c: UserConfig, days: number) =>
      c.updatedAt ? now - new Date(c.updatedAt).getTime() < days * DAY_MS : false;
    const bySource = new Map<string, number>();
    const filterKeys = new Map<string, number>();
    const activity = new Map<number, number>();
    let catalogCount = 0;
    for (const c of configs) {
      for (const cat of Array.isArray(c.catalogs) ? c.catalogs : []) {
        catalogCount++;
        const key = `${cat.source ?? 'tmdb'}\u0000${cat.type ?? '?'}`;
        bySource.set(key, (bySource.get(key) ?? 0) + 1);
        if (cat.filters && typeof cat.filters === 'object') {
          for (const k of Object.keys(cat.filters)) filterKeys.set(k, (filterKeys.get(k) ?? 0) + 1);
        }
      }
      if (updatedWithin(c, 30) && c.updatedAt) {
        const day = Math.floor(new Date(c.updatedAt).getTime() / DAY_MS) * DAY_MS;
        activity.set(day, (activity.get(day) ?? 0) + 1);
      }
    }
    const prefs = (pred: (c: UserConfig) => boolean) => configs.filter(pred).length;
    return {
      summary: {
        configs: configs.length,
        api_keys: new Set(configs.map((c) => c.apiKeyId).filter(Boolean)).size,
        catalogs: catalogCount,
        updated_1d: prefs((c) => updatedWithin(c, 1)),
        updated_7d: prefs((c) => updatedWithin(c, 7)),
        updated_30d: prefs((c) => updatedWithin(c, 30)),
      },
      catalogsBySource: [...bySource.entries()]
        .map(([key, count]) => {
          const [source, type] = key.split('\u0000');
          return { source, type, count };
        })
        .sort((a, b) => b.count - a.count),
      popularFilters: [...filterKeys.entries()]
        .map(([key, count]) => ({ key, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 40),
      preferences: {
        show_adult: prefs((c) => c.preferences?.showAdultContent === true),
        shuffle: prefs((c) => c.preferences?.shuffleCatalogs === true),
        search_disabled: prefs((c) => c.preferences?.disableSearch === true),
        has_mal_key: prefs((c) => !!c.malClientIdEncrypted),
        has_simkl_key: prefs((c) => !!c.simklApiKeyEncrypted),
        has_artwork_keys: prefs(
          (c) => Object.keys(c.preferences?.apiKeysEncrypted ?? {}).length > 0
        ),
      },
      configActivity: [...activity.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([day, updated]) => ({ day: new Date(day), updated })),
      marketplace: { totals: null, top: [] },
    };
  }
}
