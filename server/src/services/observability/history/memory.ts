import type { TimeRange } from '../liveQueries.ts';
import type { ErrorEvent, RequestEvent, SystemSample, UpstreamEvent } from '../types.ts';
import type { UserConfig } from '../../../types/index.ts';
import {
  SETTABLE_ERROR_STATUSES,
  bucketForRange,
  encodeCursor,
  percentileSorted,
  type ErrorFilter,
  type ErrorGroupBatch,
  type HistoryStore,
  type RequestFilter,
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
    if (f.statusMin !== undefined && (e.status < f.statusMin || e.status > (f.statusMax ?? 999)))
      return false;
    if (f.minMs !== undefined && e.durationMs < f.minMs) return false;
    if (f.errorsOnly && !(e.status >= 500 || e.errorFp)) return false;
    if (f.pathContains && !e.path.toLowerCase().includes(f.pathContains.toLowerCase()))
      return false;
    if (f.cursor) {
      const c = f.cursor.ts.getTime();
      if (!(e.ts < c || (e.ts === c && e.requestId < f.cursor.requestId))) return false;
    }
    return true;
  }

  async listRequests(range: TimeRange, filter: RequestFilter, limit: number) {
    const rows: Row[] = [];
    for (let i = this.requests.length - 1; i >= 0 && rows.length < limit; i--) {
      if (this.matches(this.requests[i], range, filter)) rows.push(toRequestRow(this.requests[i]));
    }
    return { rows, nextCursor: encodeCursor(rows, limit) };
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
        })),
      errors: this.errorEvents
        .filter((e) => e.requestId === requestId)
        .map((e) => ({
          ts: new Date(e.ts),
          fingerprint: e.fingerprint,
          level: e.level,
          message: e.message,
          context: e.context,
          status: this.groups.get(e.fingerprint)?.status ?? '',
        })),
    };
  }

  async routeStats(range: TimeRange) {
    const byRoute = new Map<string, RequestEvent[]>();
    for (const e of this.requests) {
      if (!inRange(e.ts, range)) continue;
      const list = byRoute.get(e.route) ?? [];
      list.push(e);
      byRoute.set(e.route, list);
    }
    return [...byRoute.entries()]
      .map(([route, list]) => {
        const sorted = sortedDurations(list);
        const sum = (fn: (e: RequestEvent) => number) => list.reduce((acc, e) => acc + fn(e), 0);
        return {
          route,
          count: Math.round(sum((e) => e.weight)),
          errors5xx: Math.round(sum((e) => (e.status >= 500 ? e.weight : 0))),
          errors4xx: Math.round(sum((e) => (e.status >= 400 && e.status < 500 ? e.weight : 0))),
          avg_ms: Math.round(sum((e) => e.durationMs) / list.length),
          p50_ms: percentileSorted(sorted, 0.5),
          p95_ms: percentileSorted(sorted, 0.95),
          p99_ms: percentileSorted(sorted, 0.99),
          max_ms: sorted[sorted.length - 1],
          avg_upstream_calls: (sum((e) => e.upstreamCalls) / list.length).toFixed(1),
        };
      })
      .sort((a, b) => b.count - a.count);
  }

  async listErrorGroups(range: TimeRange, filter: ErrorFilter) {
    const bucketMs = bucketForRange(range);
    const q = filter.q?.toLowerCase();
    return [...this.groups.values()]
      .filter((g) => (g.last_seen as Date).getTime() >= range.from)
      .filter((g) =>
        filter.status
          ? g.status === filter.status
          : filter.active
            ? g.status === 'open' || g.status === 'regressed'
            : true
      )
      .filter((g) => !filter.level || g.level === filter.level)
      .filter((g) => !q || `${g.message} ${g.context}`.toLowerCase().includes(q))
      .sort((a, b) => (b.last_seen as Date).getTime() - (a.last_seen as Date).getTime())
      .slice(0, 200)
      .map((g) => {
        const buckets = new Map<number, number>();
        for (const e of this.errorEvents) {
          if (e.fingerprint !== g.fingerprint || !inRange(e.ts, range)) continue;
          const b = Math.floor(e.ts / bucketMs) * bucketMs;
          buckets.set(b, (buckets.get(b) ?? 0) + 1);
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
    for (const e of events) routes.set(e.route, (routes.get(e.route) ?? 0) + 1);
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
    const list = this.upstream.filter(
      (u) => inRange(u.ts, range) && (!provider || u.provider === provider)
    );
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
          errors: group.filter((u) => u.status === 0 || u.status >= 500).length,
          rate_limited: group.filter((u) => u.status === 429).length,
          timeouts: group.filter((u) => u.timedOut).length,
          avg_ms: Math.round(group.reduce((a, u) => a + u.durationMs, 0) / group.length),
          p95_ms: percentileSorted(sorted, 0.95),
          max_ms: sorted[sorted.length - 1],
        };
      })
      .sort((a, b) => b.calls - a.calls)
      .slice(0, 100);
    const recentErrors = list
      .filter((u) => u.status === 0 || u.status >= 400)
      .slice(-50)
      .reverse()
      .map((u) => ({
        ts: new Date(u.ts),
        provider: u.provider,
        method: u.method,
        path: u.path,
        status: u.status,
        duration_ms: u.durationMs,
        error: u.error,
        request_id: u.requestId,
      }));
    return { endpoints, recentErrors };
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
          p95_ms: percentileSorted(sortedDurations(c.events), 0.95),
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
