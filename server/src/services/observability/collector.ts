import { createLogger } from '../../utils/logger.ts';
import type {
  CounterBatch,
  ErrorEvent,
  LiveBatch,
  RequestEvent,
  SystemSample,
  TailItem,
  UpstreamEvent,
} from './types.ts';
import type { LiveStore } from './liveStore.ts';
import type { HistoryStore } from './history/types.ts';

const log = createLogger('obs:collector');

/** Upper bounds (ms) of the latency histogram buckets; the last bucket is open-ended. */
export const LATENCY_BUCKETS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000];
const MAX_TAIL_PER_FLUSH = 200;
const MAX_EVENTS_PER_FINGERPRINT_PER_FLUSH = 50;

export function latencyBucket(ms: number): number {
  const idx = LATENCY_BUCKETS.findIndex((bound) => ms <= bound);
  return idx === -1 ? LATENCY_BUCKETS.length : idx;
}

function bump(batch: CounterBatch, bucket: number, field: string, by = 1): void {
  let fields = batch.get(bucket);
  if (!fields) {
    fields = new Map();
    batch.set(bucket, fields);
  }
  fields.set(field, (fields.get(field) ?? 0) + by);
}

function utcDayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10).replace(/-/g, '');
}

export interface CollectorOptions {
  sampleRate: number;
  slowMs: number;
  maxBuffer: number;
  hourTtlSec: number;
}

export interface CollectorStats {
  dropped: Record<string, number>;
  lastFlushAt: number;
  lastFlushMs: number;
  lastFlushError: string;
  storagePaused: boolean;
}

export class Collector {
  private opts: CollectorOptions;
  private live: LiveStore | null = null;
  private history: HistoryStore | null = null;

  private minutes: CounterBatch = new Map();
  private hours: CounterBatch = new Map();
  private users = new Map<string, Set<string>>();
  private tail: TailItem[] = [];
  private requests: RequestEvent[] = [];
  private upstream: UpstreamEvent[] = [];
  private errorEvents: ErrorEvent[] = [];
  private errorGroups = new Map<string, { count: number; first: ErrorEvent; lastTs: number }>();
  private system: SystemSample[] = [];

  private flushing = false;
  private lastWarnAt = 0;
  readonly stats: CollectorStats = {
    dropped: { requests: 0, upstream: 0, errors: 0, live: 0, persist: 0, storageCap: 0 },
    lastFlushAt: 0,
    lastFlushMs: 0,
    lastFlushError: '',
    storagePaused: false,
  };

  constructor(opts: CollectorOptions) {
    this.opts = opts;
  }

  setLiveStore(live: LiveStore): void {
    this.live = live;
  }

  /** Raw events are buffered until this is called, so nothing is lost while storage initialises. */
  setHistory(history: HistoryStore): void {
    this.history = history;
  }

  /** True when raw rows must be skipped because OBS_MAX_STORAGE_MB is exceeded. */
  private capped(): boolean {
    this.stats.storagePaused = !!this.history?.isPaused();
    if (this.stats.storagePaused) this.stats.dropped.storageCap++;
    return this.stats.storagePaused;
  }

  recordRequest(event: Omit<RequestEvent, 'weight'>): void {
    const minute = Math.floor(event.ts / 60_000);
    const hour = Math.floor(event.ts / 3_600_000);
    const statusClass = `${Math.floor(event.status / 100)}xx`;
    const isServerError = event.status >= 500;
    const isSlow = event.durationMs >= this.opts.slowMs;

    bump(this.minutes, minute, 'req');
    bump(this.minutes, minute, `sc:${statusClass}`);
    bump(this.minutes, minute, 'dur', event.durationMs);
    bump(this.minutes, minute, `lat:${latencyBucket(event.durationMs)}`);
    if (isSlow) bump(this.minutes, minute, 'slow');
    if (event.cacheHits) bump(this.minutes, minute, 'ch', event.cacheHits);
    if (event.cacheMisses) bump(this.minutes, minute, 'cm', event.cacheMisses);
    bump(this.minutes, minute, `inst:${event.instance}`);

    bump(this.hours, hour, 'req');
    bump(this.hours, hour, `sc:${statusClass}`);
    bump(this.hours, hour, 'dur', event.durationMs);
    bump(this.hours, hour, `lat:${latencyBucket(event.durationMs)}`);
    if (isSlow) bump(this.hours, hour, 'slow');
    bump(this.hours, hour, `st:${event.status}`);
    bump(this.hours, hour, `r:${event.route}`);
    bump(this.hours, hour, `rd:${event.route}`, event.durationMs);
    if (isServerError) bump(this.hours, hour, `re:${event.route}`);
    if (event.status >= 400 && event.status < 500) bump(this.hours, hour, `r4:${event.route}`);
    if (event.resource) bump(this.hours, hour, `res:${event.resource}`);
    if (event.source) bump(this.hours, hour, `src:${event.source}`);
    if (event.contentType) bump(this.hours, hour, `ct:${event.contentType}`);
    bump(this.hours, hour, `cli:${event.client}`);
    if (event.country) bump(this.hours, hour, `cty:${event.country}`);
    if (event.colo) bump(this.hours, hour, `colo:${event.colo}`);

    if (event.userHash) {
      for (const key of [`d:${utcDayKey(event.ts)}`, `h:${hour}`]) {
        let set = this.users.get(key);
        if (!set) {
          set = new Set();
          this.users.set(key, set);
        }
        set.add(event.userHash);
      }
    }

    if (this.tail.length < MAX_TAIL_PER_FLUSH) {
      this.tail.push({
        ts: event.ts,
        requestId: event.requestId,
        instance: event.instance,
        method: event.method,
        path: event.path,
        route: event.route,
        status: event.status,
        durationMs: event.durationMs,
        source: event.source,
        resource: event.resource,
        client: event.client,
        country: event.country,
        cacheHits: event.cacheHits,
        cacheMisses: event.cacheMisses,
        upstreamCalls: event.upstreamCalls,
        errorFp: event.errorFp,
      });
    }

    const alwaysKeep = isServerError || isSlow || !!event.errorFp;
    if (!alwaysKeep && Math.random() >= this.opts.sampleRate) return;
    if (this.capped()) return;
    if (this.requests.length >= this.opts.maxBuffer) {
      this.stats.dropped.requests++;
      return;
    }
    const weight = alwaysKeep || this.opts.sampleRate <= 0 ? 1 : 1 / this.opts.sampleRate;
    this.requests.push({ ...event, weight });
  }

  recordUpstream(event: UpstreamEvent): void {
    const minute = Math.floor(event.ts / 60_000);
    const hour = Math.floor(event.ts / 3_600_000);
    const p = event.provider;
    const failed = event.status === 0 || event.status >= 500;
    for (const [batch, bucket] of [
      [this.minutes, minute],
      [this.hours, hour],
    ] as const) {
      bump(batch, bucket, `u:${p}`);
      bump(batch, bucket, `ud:${p}`, event.durationMs);
      bump(batch, bucket, `ul:${p}:${latencyBucket(event.durationMs)}`);
      if (failed) bump(batch, bucket, `ue:${p}`);
      if (event.status === 429) bump(batch, bucket, `u429:${p}`);
      if (event.timedOut) bump(batch, bucket, `ut:${p}`);
    }

    if (this.capped()) return;
    if (this.upstream.length >= this.opts.maxBuffer) {
      this.stats.dropped.upstream++;
      return;
    }
    this.upstream.push(event);
  }

  recordError(event: ErrorEvent): void {
    const minute = Math.floor(event.ts / 60_000);
    bump(this.minutes, minute, event.level === 'error' ? 'err' : 'warn');
    bump(this.hours, Math.floor(event.ts / 3_600_000), event.level === 'error' ? 'err' : 'warn');

    const group = this.errorGroups.get(event.fingerprint);
    if (group) {
      group.count++;
      group.lastTs = event.ts;
      if (group.count > MAX_EVENTS_PER_FINGERPRINT_PER_FLUSH) return;
    } else {
      this.errorGroups.set(event.fingerprint, { count: 1, first: event, lastTs: event.ts });
    }
    if (this.errorEvents.length >= this.opts.maxBuffer) {
      this.stats.dropped.errors++;
      return;
    }
    this.errorEvents.push(event);
  }

  recordSystem(sample: SystemSample): void {
    this.system.push(sample);
    if (this.system.length > 1000) this.system.shift();
  }

  private warnThrottled(message: string, err: unknown): void {
    this.stats.lastFlushError = `${message}: ${(err as Error)?.message ?? String(err)}`;
    if (Date.now() - this.lastWarnAt < 60_000) return;
    this.lastWarnAt = Date.now();
    log.warn(message, { error: (err as Error)?.message ?? String(err) });
  }

  async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    const started = Date.now();

    const liveBatch: LiveBatch = {
      minutes: this.minutes,
      hours: this.hours,
      users: this.users,
      tail: this.tail,
    };
    this.minutes = new Map();
    this.hours = new Map();
    this.users = new Map();
    this.tail = [];

    // Keep raw buffers in place until a history store is attached.
    const history = this.history;
    const requests = history ? this.requests : [];
    const upstream = history ? this.upstream : [];
    const errorEvents = history ? this.errorEvents : [];
    const errorGroups = history ? this.errorGroups : new Map();
    const system = history ? this.system : [];
    if (history) {
      this.requests = [];
      this.upstream = [];
      this.errorEvents = [];
      this.errorGroups = new Map();
      this.system = [];
    }

    try {
      const hasLiveData = liveBatch.minutes.size || liveBatch.hours.size || liveBatch.tail.length;
      if (this.live && hasLiveData) {
        try {
          await this.live.apply(liveBatch, this.opts.hourTtlSec);
        } catch (err) {
          this.stats.dropped.live++;
          this.warnThrottled('Live store flush failed', err);
        }
      }
      if (history) {
        const results = await Promise.allSettled([
          requests.length ? history.insertRequests(requests) : null,
          upstream.length ? history.insertUpstream(upstream) : null,
          errorEvents.length || errorGroups.size
            ? history.insertErrors(errorEvents, errorGroups)
            : null,
          system.length ? history.insertSystem(system) : null,
        ]);
        for (const r of results) {
          if (r.status === 'rejected') {
            this.stats.dropped.persist++;
            this.warnThrottled(`History (${history.kind}) flush failed; batch dropped`, r.reason);
          }
        }
      }
      this.stats.lastFlushAt = Date.now();
      this.stats.lastFlushMs = Date.now() - started;
    } finally {
      this.flushing = false;
    }
  }
}
