import mongoose from 'mongoose';
import { createLogger } from '../../../utils/logger.ts';
import { UserConfig } from '../../../models/UserConfig.ts';
import { MarketplaceEntryModel } from '../../../models/MarketplaceEntry.ts';
import { LATENCY_BUCKETS } from '../collector.ts';
import { histPercentile, type TimeRange } from '../liveQueries.ts';
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

type Doc = Record<string, unknown>;
type Coll = mongoose.mongo.Collection<Doc>;

const log = createLogger('obs:mongo');

const C = {
  requests: 'obs_requests',
  upstream: 'obs_upstream',
  errorEvents: 'obs_error_events',
  errorGroups: 'obs_error_groups',
  system: 'obs_system_samples',
} as const;

const AGG_OPTS = { maxTimeMS: 20_000, allowDiskUse: true };
const DAY_MS = 86_400_000;

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Bucket index into LATENCY_BUCKETS, computed server-side. */
const LATENCY_BUCKET_EXPR = {
  $switch: {
    branches: LATENCY_BUCKETS.map((bound, i) => ({
      case: { $lte: ['$duration_ms', bound] },
      then: i,
    })),
    default: LATENCY_BUCKETS.length,
  },
};

/** Floors a date to `ms` without $dateTrunc, so it works on MongoDB 4.4. */
function floorTs(ms: number) {
  return { $subtract: [{ $toLong: '$ts' }, { $mod: [{ $toLong: '$ts' }, ms] }] };
}

function emptyHist(): number[] {
  return new Array(LATENCY_BUCKETS.length + 1).fill(0);
}

function utcDay(offset: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offset);
  return d;
}

export class MongoHistory implements HistoryStore {
  readonly kind = 'mongo' as const;
  readonly approximatePercentiles = true;
  private retentionDays: number;
  private capBytes: number | null;
  private version: string;
  private paused = false;

  constructor(opts: { retentionDays: number; capMb: number; version: string }) {
    this.retentionDays = opts.retentionDays;
    this.capBytes = opts.capMb > 0 ? opts.capMb * 1024 * 1024 : null;
    this.version = opts.version;
  }

  private get db() {
    const db = mongoose.connection.db;
    if (!db) throw new Error('MongoDB is not connected');
    return db;
  }

  private coll(name: string): Coll {
    return this.db.collection<Doc>(name);
  }

  isPaused(): boolean {
    return this.paused;
  }

  private async ensureTtl(name: string, field: string, seconds: number): Promise<void> {
    const indexName = `${field}_ttl`;
    try {
      await this.coll(name).createIndex(
        { [field]: 1 },
        { name: indexName, expireAfterSeconds: seconds }
      );
    } catch (err) {
      const code = (err as { code?: number }).code;
      // Retention changed since the index was created: update it in place.
      if (code === 85 || code === 86) {
        await this.db.command({
          collMod: name,
          index: { name: indexName, expireAfterSeconds: seconds },
        });
      } else {
        throw err;
      }
    }
  }

  async init(): Promise<void> {
    const retentionSec = this.retentionDays * 86_400;
    await this.ensureTtl(C.requests, 'ts', retentionSec);
    await this.ensureTtl(C.upstream, 'ts', retentionSec);
    await this.ensureTtl(C.errorEvents, 'ts', retentionSec);
    await this.ensureTtl(C.system, 'ts', retentionSec);
    await this.ensureTtl(C.errorGroups, 'last_seen', Math.max(this.retentionDays, 30) * 86_400);
    await Promise.all([
      this.coll(C.requests).createIndex({ route: 1, ts: -1 }),
      this.coll(C.requests).createIndex({ status: 1, ts: -1 }),
      this.coll(C.requests).createIndex({ request_id: 1 }),
      this.coll(C.requests).createIndex({ user_hash: 1, ts: -1 }),
      this.coll(C.upstream).createIndex({ provider: 1, ts: -1 }),
      this.coll(C.upstream).createIndex({ request_id: 1 }),
      this.coll(C.errorEvents).createIndex({ fingerprint: 1, ts: -1 }),
      this.coll(C.errorEvents).createIndex({ request_id: 1 }),
    ]);
  }

  /** Retention is handled by TTL indexes; this only enforces OBS_MAX_STORAGE_MB. */
  async maintain(): Promise<void> {
    if (!this.capBytes) return;
    const today = utcDay(0).getTime();
    for (let i = 0; i < this.retentionDays + 1; i++) {
      const { totalBytes } = await this.storageInfo();
      if (totalBytes <= this.capBytes) break;
      const oldest = await this.coll(C.requests)
        .find({}, { projection: { ts: 1 } })
        .sort({ ts: 1 })
        .limit(1)
        .next();
      const oldestTs = oldest?.ts instanceof Date ? oldest.ts.getTime() : null;
      if (oldestTs === null || oldestTs >= today) break;
      const cutoff = new Date(Math.floor(oldestTs / DAY_MS) * DAY_MS + DAY_MS);
      await Promise.all(
        [C.requests, C.upstream, C.errorEvents].map((name) =>
          this.coll(name).deleteMany({ ts: { $lt: cutoff } })
        )
      );
      log.info('Storage cap reached; deleted oldest day', { before: cutoff.toISOString() });
    }
    this.paused = (await this.storageInfo()).paused;
  }

  async insertRequests(events: RequestEvent[]): Promise<void> {
    if (!events.length) return;
    await this.coll(C.requests).insertMany(
      events.map((e) => ({
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
      })),
      { ordered: false }
    );
  }

  async insertUpstream(events: UpstreamEvent[]): Promise<void> {
    if (!events.length) return;
    await this.coll(C.upstream).insertMany(
      events.map((e) => ({
        ts: new Date(e.ts),
        request_id: e.requestId,
        instance: e.instance,
        provider: e.provider,
        host: e.host,
        method: e.method,
        path: e.path,
        status: e.status,
        duration_ms: e.durationMs,
        error: e.error,
        timed_out: e.timedOut,
      })),
      { ordered: false }
    );
  }

  async insertErrors(events: ErrorEvent[], groups: Map<string, ErrorGroupBatch>): Promise<void> {
    if (groups.size) {
      const lit = (value: unknown) => ({ $literal: value });
      await this.coll(C.errorGroups).bulkWrite(
        [...groups.entries()].map(([fp, g]) => ({
          updateOne: {
            filter: { _id: fp } as Doc,
            // Pipeline update: fields reference the pre-update document, so "resolved -> regressed" works atomically.
            update: [
              {
                $set: {
                  level: { $ifNull: ['$level', lit(g.first.level)] },
                  context: { $ifNull: ['$context', lit(g.first.context)] },
                  message: { $ifNull: ['$message', lit(g.first.message)] },
                  sample_route: { $ifNull: ['$sample_route', lit(g.first.route)] },
                  sample_stack: g.first.stack
                    ? lit(g.first.stack)
                    : { $ifNull: ['$sample_stack', ''] },
                  first_seen: { $ifNull: ['$first_seen', lit(new Date(g.first.ts))] },
                  last_seen: { $max: ['$last_seen', lit(new Date(g.lastTs))] },
                  count: { $add: [{ $ifNull: ['$count', 0] }, g.count] },
                  first_version: { $ifNull: ['$first_version', lit(this.version)] },
                  last_version: lit(this.version),
                  status: {
                    $cond: [
                      { $eq: ['$status', 'resolved'] },
                      'regressed',
                      { $ifNull: ['$status', 'open'] },
                    ],
                  },
                  status_changed_at: {
                    $cond: [
                      { $eq: ['$status', 'resolved'] },
                      '$$NOW',
                      { $ifNull: ['$status_changed_at', null] },
                    ],
                  },
                },
              },
            ],
            upsert: true,
          },
        })),
        { ordered: false }
      );
    }
    if (events.length) {
      await this.coll(C.errorEvents).insertMany(
        events.map((e) => ({
          ts: new Date(e.ts),
          fingerprint: e.fingerprint,
          level: e.level,
          request_id: e.requestId,
          instance: e.instance,
          route: e.route,
          message: e.message,
        })),
        { ordered: false }
      );
    }
  }

  async insertSystem(samples: SystemSample[]): Promise<void> {
    if (!samples.length) return;
    await this.coll(C.system).insertMany(
      samples.map((s) => ({ ts: new Date(s.ts), instance: s.instance, data: s.data })),
      { ordered: false }
    );
  }

  private rangeMatch(range: TimeRange): Doc {
    return { ts: { $gte: new Date(range.from), $lte: new Date(range.to) } };
  }

  private requestMatch(range: TimeRange, filter: RequestFilter): Doc {
    const and: Doc[] = [this.rangeMatch(range)];
    // Values are plain strings from parseRequestFilter, so they can't carry query operators.
    for (const [field, value] of Object.entries(filter.exact)) and.push({ [field]: value });
    if (filter.statusMin !== undefined)
      and.push({ status: { $gte: filter.statusMin, $lte: filter.statusMax } });
    if (filter.minMs !== undefined) and.push({ duration_ms: { $gte: filter.minMs } });
    if (filter.errorsOnly)
      and.push({ $or: [{ status: { $gte: 500 } }, { error_fp: { $ne: '' } }] });
    if (filter.pathContains)
      and.push({ path: { $regex: escapeRegex(filter.pathContains), $options: 'i' } });
    if (filter.cursor) {
      and.push({
        $or: [
          { ts: { $lt: filter.cursor.ts } },
          { ts: filter.cursor.ts, request_id: { $lt: filter.cursor.requestId } },
        ],
      });
    }
    return { $and: and };
  }

  async listRequests(range: TimeRange, filter: RequestFilter, limit: number) {
    const rows = await this.coll(C.requests)
      .find(this.requestMatch(range, filter), { projection: { _id: 0 } })
      .sort({ ts: -1, request_id: -1 })
      .limit(limit)
      .toArray();
    return { rows, nextCursor: encodeCursor(rows, limit) };
  }

  async requestFacets(range: TimeRange) {
    const group = (field: string) => [
      { $group: { _id: `$${field}`, count: { $sum: '$weight' } } },
      { $sort: { count: -1 } },
      { $limit: 200 },
    ];
    const [result] = await this.coll(C.requests)
      .aggregate(
        [
          { $match: this.rangeMatch(range) },
          {
            $facet: {
              route: group('route'),
              client: group('client'),
              instance: group('instance'),
              country: [{ $match: { country: { $ne: '' } } }, ...group('country')],
            },
          },
        ],
        AGG_OPTS
      )
      .toArray();
    const facets: Record<string, Array<{ value: string; count: number }>> = {};
    for (const [facet, list] of Object.entries(result ?? {})) {
      facets[facet] = (list as Array<{ _id: string; count: number }>).map((r) => ({
        value: r._id,
        count: Math.round(r.count),
      }));
    }
    return facets;
  }

  async getTrace(requestId: string) {
    const [requests, upstream, events] = await Promise.all([
      this.coll(C.requests)
        .find({ request_id: requestId }, { projection: { _id: 0 } })
        .sort({ ts: -1 })
        .limit(5)
        .toArray(),
      this.coll(C.upstream)
        .find({ request_id: requestId }, { projection: { _id: 0 } })
        .sort({ ts: 1 })
        .limit(500)
        .toArray(),
      this.coll(C.errorEvents)
        .find({ request_id: requestId }, { projection: { _id: 0 } })
        .sort({ ts: 1 })
        .limit(200)
        .toArray(),
    ]);
    const groups = await this.coll(C.errorGroups)
      .find({ _id: { $in: [...new Set(events.map((e) => e.fingerprint))] } } as Doc)
      .project({ context: 1, status: 1 })
      .toArray();
    const byFp = new Map(groups.map((g) => [g._id, g]));
    const errors = events.map((e) => ({
      ...e,
      context: byFp.get(e.fingerprint)?.context ?? '',
      status: byFp.get(e.fingerprint)?.status ?? '',
    }));
    return { requests, upstream, errors };
  }

  /** Groups by `key` plus latency bucket, then folds buckets into a histogram per key. */
  private async groupedWithHistogram(
    name: string,
    match: Doc,
    key: Doc,
    sums: Doc
  ): Promise<Array<{ key: Doc; hist: number[]; sums: Record<string, number>; max: number }>> {
    const rows = await this.coll(name)
      .aggregate(
        [
          { $match: match },
          {
            $group: {
              _id: { k: key, b: LATENCY_BUCKET_EXPR },
              n: { $sum: 1 },
              max: { $max: '$duration_ms' },
              ...sums,
            },
          },
        ],
        AGG_OPTS
      )
      .toArray();
    const merged = new Map<
      string,
      { key: Doc; hist: number[]; sums: Record<string, number>; max: number }
    >();
    for (const row of rows) {
      const id = row._id as { k: Doc; b: number };
      const mapKey = JSON.stringify(id.k);
      let entry = merged.get(mapKey);
      if (!entry) {
        entry = { key: id.k, hist: emptyHist(), sums: {}, max: 0 };
        merged.set(mapKey, entry);
      }
      entry.hist[id.b] += Number(row.n);
      entry.max = Math.max(entry.max, Number(row.max) || 0);
      for (const field of ['n', ...Object.keys(sums)]) {
        entry.sums[field] = (entry.sums[field] ?? 0) + (Number(row[field]) || 0);
      }
    }
    return [...merged.values()];
  }

  async routeStats(range: TimeRange) {
    const groups = await this.groupedWithHistogram(
      C.requests,
      this.rangeMatch(range),
      { route: '$route' },
      {
        count: { $sum: '$weight' },
        e5: { $sum: { $cond: [{ $gte: ['$status', 500] }, '$weight', 0] } },
        e4: {
          $sum: {
            $cond: [
              { $and: [{ $gte: ['$status', 400] }, { $lt: ['$status', 500] }] },
              '$weight',
              0,
            ],
          },
        },
        dur: { $sum: '$duration_ms' },
        up: { $sum: '$upstream_calls' },
      }
    );
    return groups
      .map((g) => ({
        route: g.key.route,
        count: Math.round(g.sums.count),
        errors5xx: Math.round(g.sums.e5),
        errors4xx: Math.round(g.sums.e4),
        avg_ms: Math.round(g.sums.dur / g.sums.n),
        p50_ms: histPercentile(g.hist, 0.5),
        p95_ms: histPercentile(g.hist, 0.95),
        p99_ms: histPercentile(g.hist, 0.99),
        max_ms: g.max,
        avg_upstream_calls: (g.sums.up / g.sums.n).toFixed(1),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 200);
  }

  async listErrorGroups(range: TimeRange, filter: ErrorFilter) {
    const query: Doc = { last_seen: { $gte: new Date(range.from) } };
    if (filter.status) query.status = filter.status;
    else if (filter.active) query.status = { $in: ['open', 'regressed'] };
    if (filter.level) query.level = filter.level;
    if (filter.q) {
      const regex = { $regex: escapeRegex(filter.q), $options: 'i' };
      query.$or = [{ message: regex }, { context: regex }];
    }
    const groups = await this.coll(C.errorGroups)
      .find(query)
      .sort({ last_seen: -1 })
      .limit(200)
      .toArray();
    if (!groups.length) return [];
    const bucketMs = bucketForRange(range);
    const spark = await this.coll(C.errorEvents)
      .aggregate(
        [
          { $match: { ...this.rangeMatch(range), fingerprint: { $in: groups.map((g) => g._id) } } },
          { $group: { _id: { fp: '$fingerprint', b: floorTs(bucketMs) }, n: { $sum: 1 } } },
        ],
        AGG_OPTS
      )
      .toArray();
    const sparkByFp = new Map<unknown, Array<[number, number]>>();
    for (const row of spark) {
      const id = row._id as { fp: string; b: number };
      const list = sparkByFp.get(id.fp) ?? [];
      list.push([Math.floor(Number(id.b) / 1000), Number(row.n)]);
      sparkByFp.set(id.fp, list);
    }
    return groups.map(({ _id, ...g }) => ({
      fingerprint: _id,
      ...g,
      spark: (sparkByFp.get(_id) ?? []).sort((a, b) => a[0] - b[0]),
    }));
  }

  async getErrorGroup(fingerprint: string) {
    const [group, events, routes] = await Promise.all([
      this.coll(C.errorGroups).findOne({ _id: fingerprint } as Doc),
      this.coll(C.errorEvents)
        .find({ fingerprint }, { projection: { _id: 0 } })
        .sort({ ts: -1 })
        .limit(100)
        .toArray(),
      this.coll(C.errorEvents)
        .aggregate(
          [
            { $match: { fingerprint } },
            { $group: { _id: '$route', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 20 },
          ],
          AGG_OPTS
        )
        .toArray(),
    ]);
    if (!group) return null;
    const { _id, ...rest } = group;
    return {
      group: { fingerprint: _id, ...rest },
      events,
      routes: routes.map((r) => ({ route: r._id, count: r.count })),
    };
  }

  async setErrorStatus(fingerprint: string, status: string) {
    if (!SETTABLE_ERROR_STATUSES.has(status)) return false;
    const res = await this.coll(C.errorGroups).updateOne({ _id: fingerprint } as Doc, {
      $set: { status, status_changed_at: new Date() },
    });
    return res.matchedCount > 0;
  }

  async upstreamEndpoints(range: TimeRange, provider?: string) {
    const match: Doc = { ...this.rangeMatch(range), ...(provider ? { provider } : {}) };
    const [groups, recentErrors] = await Promise.all([
      this.groupedWithHistogram(
        C.upstream,
        match,
        { provider: '$provider', method: '$method', path: '$path' },
        {
          errors: {
            $sum: { $cond: [{ $or: [{ $eq: ['$status', 0] }, { $gte: ['$status', 500] }] }, 1, 0] },
          },
          rl: { $sum: { $cond: [{ $eq: ['$status', 429] }, 1, 0] } },
          to: { $sum: { $cond: ['$timed_out', 1, 0] } },
          dur: { $sum: '$duration_ms' },
        }
      ),
      this.coll(C.upstream)
        .find(
          { ...match, $or: [{ status: 0 }, { status: { $gte: 400 } }] },
          {
            projection: {
              _id: 0,
              ts: 1,
              provider: 1,
              method: 1,
              path: 1,
              status: 1,
              duration_ms: 1,
              error: 1,
              request_id: 1,
            },
          }
        )
        .sort({ ts: -1 })
        .limit(50)
        .toArray(),
    ]);
    const endpoints = groups
      .map((g) => ({
        ...g.key,
        calls: g.sums.n,
        errors: g.sums.errors,
        rate_limited: g.sums.rl,
        timeouts: g.sums.to,
        avg_ms: Math.round(g.sums.dur / g.sums.n),
        p95_ms: histPercentile(g.hist, 0.95),
        max_ms: g.max,
      }))
      .sort((a, b) => b.calls - a.calls)
      .slice(0, 100);
    return { endpoints, recentErrors };
  }

  async usageStats(range: TimeRange) {
    const [catalogGroups, daily] = await Promise.all([
      this.groupedWithHistogram(
        C.requests,
        { ...this.rangeMatch(range), resource: 'catalog' },
        { catalog_id: '$catalog_id', source: '$source', content_type: '$content_type' },
        {
          requests: { $sum: '$weight' },
          errors: { $sum: { $cond: [{ $gte: ['$status', 500] }, '$weight', 0] } },
        }
      ),
      this.coll(C.requests)
        .aggregate(
          [
            { $match: this.rangeMatch(range) },
            {
              $group: {
                _id: floorTs(DAY_MS),
                users: {
                  $addToSet: { $cond: [{ $ne: ['$user_hash', ''] }, '$user_hash', '$$REMOVE'] },
                },
                requests: { $sum: '$weight' },
                manifest_fetches: {
                  $sum: { $cond: [{ $eq: ['$resource', 'manifest'] }, '$weight', 0] },
                },
              },
            },
            { $sort: { _id: 1 } },
          ],
          AGG_OPTS
        )
        .toArray(),
    ]);
    const topCatalogs = catalogGroups
      .map((g) => ({
        ...g.key,
        catalog_id: String(g.key.catalog_id ?? ''),
        requests: Math.round(g.sums.requests),
        errors: Math.round(g.sums.errors),
        p95_ms: histPercentile(g.hist, 0.95),
      }))
      .sort((a, b) => b.requests - a.requests)
      .slice(0, 50);
    // Distinct configs per top catalog, only for the 50 we show.
    const users = await this.coll(C.requests)
      .aggregate(
        [
          {
            $match: {
              ...this.rangeMatch(range),
              resource: 'catalog',
              catalog_id: { $in: topCatalogs.map((c) => c.catalog_id) },
            },
          },
          { $group: { _id: '$catalog_id', users: { $addToSet: '$user_hash' } } },
          { $project: { users: { $size: '$users' } } },
        ],
        AGG_OPTS
      )
      .toArray();
    const usersByCatalog = new Map(users.map((u) => [u._id, u.users]));
    return {
      topCatalogs: topCatalogs.map((c) => ({ ...c, users: usersByCatalog.get(c.catalog_id) ?? 0 })),
      daily: daily.map((d) => ({
        day: new Date(Number(d._id)),
        users: (d.users as unknown[]).length,
        requests: Math.round(Number(d.requests)),
        manifest_fetches: Math.round(Number(d.manifest_fetches)),
      })),
    };
  }

  async systemSeries(range: TimeRange) {
    const stepMs = Math.max(30, Math.floor((range.to - range.from) / 1000 / 300)) * 1000;
    const rows = await this.coll(C.system)
      .find(this.rangeMatch(range), { projection: { _id: 0 } })
      .sort({ ts: 1 })
      .toArray();
    const latest = new Map<string, Doc>();
    for (const row of rows) {
      const bucket = Math.floor((row.ts as Date).getTime() / stepMs) * stepMs;
      latest.set(`${row.instance}|${bucket}`, {
        instance: row.instance,
        bucket: new Date(bucket),
        data: row.data,
      });
    }
    return [...latest.values()];
  }

  async storageInfo(): Promise<StorageInfo> {
    const tables = await Promise.all(
      Object.values(C).map(async (name) => {
        try {
          const stats = await this.coll(name)
            .aggregate([{ $collStats: { storageStats: {} } }])
            .toArray();
          // Logical size, not on-disk size: deletes reduce it immediately, which the cap loop relies on.
          const bytes = stats.reduce((sum, s) => {
            const st = (s.storageStats ?? {}) as { size?: number; totalIndexSize?: number };
            return sum + (st.size ?? 0) + (st.totalIndexSize ?? 0);
          }, 0);
          return { table_name: name, partitions: 0, bytes };
        } catch {
          return { table_name: name, partitions: 0, bytes: 0 };
        }
      })
    );
    const totalBytes = tables.reduce((sum, t) => sum + t.bytes, 0);
    return {
      tables,
      totalBytes,
      capBytes: this.capBytes,
      paused: !!this.capBytes && totalBytes > this.capBytes,
    };
  }

  async businessAnalytics() {
    const configs = UserConfig.collection as unknown as Coll;
    const market = MarketplaceEntryModel.collection as unknown as Coll;
    const now = Date.now();
    const since = (days: number) => new Date(now - days * DAY_MS);
    const isObject = (path: string) => ({ $eq: [{ $type: path }, 'object'] });
    const count = (cond: unknown) => ({ $sum: { $cond: [cond, 1, 0] } });

    const [summary, bySource, filterKeys, prefs, activity, marketTotals, marketTop] =
      await Promise.all([
        configs
          .aggregate(
            [
              {
                $group: {
                  _id: null,
                  configs: { $sum: 1 },
                  api_keys: { $addToSet: '$apiKeyId' },
                  catalogs: { $sum: { $size: { $ifNull: ['$catalogs', []] } } },
                  updated_1d: count({ $gt: ['$updatedAt', since(1)] }),
                  updated_7d: count({ $gt: ['$updatedAt', since(7)] }),
                  updated_30d: count({ $gt: ['$updatedAt', since(30)] }),
                },
              },
              {
                $project: {
                  _id: 0,
                  configs: 1,
                  catalogs: 1,
                  updated_1d: 1,
                  updated_7d: 1,
                  updated_30d: 1,
                  api_keys: { $size: '$api_keys' },
                },
              },
            ],
            AGG_OPTS
          )
          .toArray(),
        configs
          .aggregate(
            [
              { $unwind: '$catalogs' },
              {
                $group: {
                  _id: {
                    source: { $ifNull: ['$catalogs.source', 'tmdb'] },
                    type: { $ifNull: ['$catalogs.type', '?'] },
                  },
                  count: { $sum: 1 },
                },
              },
              { $sort: { count: -1 } },
            ],
            AGG_OPTS
          )
          .toArray(),
        configs
          .aggregate(
            [
              { $unwind: '$catalogs' },
              {
                $project: {
                  kv: {
                    $cond: [
                      isObject('$catalogs.filters'),
                      { $objectToArray: '$catalogs.filters' },
                      [],
                    ],
                  },
                },
              },
              { $unwind: '$kv' },
              { $group: { _id: '$kv.k', count: { $sum: 1 } } },
              { $sort: { count: -1 } },
              { $limit: 40 },
            ],
            AGG_OPTS
          )
          .toArray(),
        configs
          .aggregate(
            [
              {
                $group: {
                  _id: null,
                  show_adult: count({ $eq: ['$preferences.showAdultContent', true] }),
                  shuffle: count({ $eq: ['$preferences.shuffleCatalogs', true] }),
                  search_disabled: count({ $eq: ['$preferences.disableSearch', true] }),
                  has_mal_key: count({
                    $gt: [{ $strLenCP: { $ifNull: ['$malClientIdEncrypted', ''] } }, 0],
                  }),
                  has_simkl_key: count({
                    $gt: [{ $strLenCP: { $ifNull: ['$simklApiKeyEncrypted', ''] } }, 0],
                  }),
                  has_artwork_keys: count({
                    $and: [
                      isObject('$preferences.apiKeysEncrypted'),
                      {
                        $gt: [
                          {
                            $size: {
                              $objectToArray: { $ifNull: ['$preferences.apiKeysEncrypted', {}] },
                            },
                          },
                          0,
                        ],
                      },
                    ],
                  }),
                },
              },
              { $project: { _id: 0 } },
            ],
            AGG_OPTS
          )
          .toArray(),
        configs
          .aggregate(
            [
              { $match: { updatedAt: { $gt: since(30) } } },
              {
                $group: {
                  _id: {
                    $subtract: [
                      { $toLong: '$updatedAt' },
                      { $mod: [{ $toLong: '$updatedAt' }, DAY_MS] },
                    ],
                  },
                  updated: { $sum: 1 },
                },
              },
              { $sort: { _id: 1 } },
            ],
            AGG_OPTS
          )
          .toArray(),
        market
          .aggregate(
            [
              { $match: { visibility: 'public', moderation: 'active' } },
              {
                $group: {
                  _id: null,
                  entries: { $sum: 1 },
                  installs: { $sum: '$engagement.installs' },
                  likes: { $sum: '$engagement.likes' },
                  views: { $sum: '$engagement.views' },
                },
              },
              { $project: { _id: 0 } },
            ],
            AGG_OPTS
          )
          .toArray(),
        market
          .find(
            { visibility: 'public', moderation: 'active' },
            { projection: { _id: 0, name: 1, source: 1, type: 1, engagement: 1, publishedAt: 1 } }
          )
          .sort({ 'engagement.installs': -1 })
          .limit(15)
          .toArray(),
      ]);

    return {
      summary: summary[0] ?? {
        configs: 0,
        api_keys: 0,
        catalogs: 0,
        updated_1d: 0,
        updated_7d: 0,
        updated_30d: 0,
      },
      catalogsBySource: bySource.map((r) => ({ ...(r._id as Doc), count: r.count })),
      popularFilters: filterKeys.map((r) => ({ key: r._id, count: r.count })),
      preferences: prefs[0] ?? {},
      configActivity: activity.map((r) => ({ day: new Date(Number(r._id)), updated: r.updated })),
      marketplace: {
        totals: marketTotals[0] ?? { entries: 0, installs: 0, likes: 0, views: 0 },
        top: marketTop.map((m) => {
          const e = (m.engagement ?? {}) as Record<string, number>;
          return {
            name: m.name,
            source: m.source,
            type: m.type,
            installs: e.installs ?? 0,
            likes: e.likes ?? 0,
            views: e.views ?? 0,
            published_at: m.publishedAt,
          };
        }),
      },
    };
  }

  async close(): Promise<void> {
    // Shares the app's mongoose connection, which the storage adapter closes.
  }
}
