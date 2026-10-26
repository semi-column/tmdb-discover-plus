import { hashIdentifier } from '../identity.ts';
import type { TimeRange } from '../liveQueries.ts';
import type { ErrorEvent, RequestEvent, SystemSample, UpstreamEvent } from '../types.ts';

export type HistoryKind = 'postgres' | 'mongo' | 'memory';

export interface ErrorGroupBatch {
  count: number;
  first: ErrorEvent;
  lastTs: number;
}

/** Backend-neutral request filters, parsed and validated once from the query string. */
export interface RequestFilter {
  exact: Partial<
    Record<
      | 'route'
      | 'method'
      | 'source'
      | 'resource'
      | 'client'
      | 'country'
      | 'instance'
      | 'request_id'
      | 'user_hash',
      string
    >
  >;
  statusMin?: number;
  statusMax?: number;
  minMs?: number;
  errorsOnly: boolean;
  pathContains?: string;
  cursor?: { ts: Date; requestId: string };
}

export interface ErrorFilter {
  status?: string;
  active: boolean;
  level?: 'error' | 'warn';
  q?: string;
}

export interface StorageInfo {
  tables: Array<{ table_name: string; partitions: number; bytes: number }>;
  totalBytes: number;
  capBytes: number | null;
  paused: boolean;
  /** In-memory history only: events held vs. capacity. */
  memory?: { requests: number; upstream: number; errorEvents: number; capacity: number };
}

export interface HistoryStore {
  readonly kind: HistoryKind;
  /** True when percentiles are bucket upper bounds rather than exact values. */
  readonly approximatePercentiles: boolean;
  init(): Promise<void>;
  maintain(): Promise<void>;
  close(): Promise<void>;
  /** Raw request/upstream rows are skipped while the storage cap is exceeded. */
  isPaused(): boolean;

  insertRequests(events: RequestEvent[]): Promise<void>;
  insertUpstream(events: UpstreamEvent[]): Promise<void>;
  insertErrors(events: ErrorEvent[], groups: Map<string, ErrorGroupBatch>): Promise<void>;
  insertSystem(samples: SystemSample[]): Promise<void>;

  listRequests(
    range: TimeRange,
    filter: RequestFilter,
    limit: number
  ): Promise<{ rows: Record<string, unknown>[]; nextCursor: string | null }>;
  requestFacets(range: TimeRange): Promise<Record<string, Array<{ value: string; count: number }>>>;
  getTrace(requestId: string): Promise<{
    requests: Record<string, unknown>[];
    upstream: Record<string, unknown>[];
    errors: Record<string, unknown>[];
  }>;
  routeStats(range: TimeRange): Promise<Record<string, unknown>[]>;
  listErrorGroups(range: TimeRange, filter: ErrorFilter): Promise<Record<string, unknown>[]>;
  getErrorGroup(fingerprint: string): Promise<{
    group: Record<string, unknown>;
    events: Record<string, unknown>[];
    routes: Record<string, unknown>[];
  } | null>;
  setErrorStatus(fingerprint: string, status: string): Promise<boolean>;
  upstreamEndpoints(
    range: TimeRange,
    provider?: string
  ): Promise<{ endpoints: Record<string, unknown>[]; recentErrors: Record<string, unknown>[] }>;
  usageStats(range: TimeRange): Promise<{
    topCatalogs: Record<string, unknown>[];
    daily: Record<string, unknown>[];
  }>;
  systemSeries(range: TimeRange): Promise<Record<string, unknown>[]>;
  storageInfo(): Promise<StorageInfo>;
  businessAnalytics(): Promise<Record<string, unknown> | null>;
}

export const SETTABLE_ERROR_STATUSES = new Set(['open', 'resolved', 'ignored']);
const ERROR_STATUSES = new Set(['open', 'resolved', 'ignored', 'regressed']);
const MAX_TEXT = 300;

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, MAX_TEXT) : undefined;
}

export function parseRequestFilter(raw: Record<string, unknown>): RequestFilter {
  const filter: RequestFilter = { exact: {}, errorsOnly: raw.errorsOnly === 'true' };
  const exactKeys: Array<[string, keyof RequestFilter['exact']]> = [
    ['route', 'route'],
    ['method', 'method'],
    ['source', 'source'],
    ['resource', 'resource'],
    ['client', 'client'],
    ['country', 'country'],
    ['instance', 'instance'],
    ['requestId', 'request_id'],
  ];
  for (const [param, field] of exactKeys) {
    const value = str(raw[param]);
    if (value) filter.exact[field] = value;
  }
  const userId = str(raw.userId);
  if (userId) filter.exact.user_hash = hashIdentifier(userId);

  const status = str(raw.status);
  if (status && /^[1-5]xx$/.test(status)) {
    filter.statusMin = Number(status[0]) * 100;
    filter.statusMax = filter.statusMin + 99;
  } else if (status && /^\d{3}$/.test(status)) {
    filter.statusMin = filter.statusMax = Number(status);
  }

  const minMs = Number(raw.minMs);
  if (Number.isFinite(minMs) && minMs > 0) filter.minMs = Math.floor(minMs);

  filter.pathContains = str(raw.q);

  const cursor = str(raw.cursor);
  if (cursor) {
    const [ts, requestId] = cursor.split('|');
    const parsed = Date.parse(ts);
    if (Number.isFinite(parsed) && requestId) filter.cursor = { ts: new Date(parsed), requestId };
  }
  return filter;
}

export function parseErrorFilter(raw: Record<string, unknown>): ErrorFilter {
  const status = str(raw.status);
  const level = str(raw.level);
  return {
    status: status && ERROR_STATUSES.has(status) ? status : undefined,
    active: status === 'active',
    level: level === 'error' || level === 'warn' ? level : undefined,
    q: str(raw.q),
  };
}

export function encodeCursor(rows: Record<string, unknown>[], limit: number): string | null {
  const last = rows[rows.length - 1];
  if (rows.length < limit || !last) return null;
  return `${new Date(last.ts as string | Date).toISOString()}|${last.request_id}`;
}

/** Exact percentile over an ascending-sorted array. */
export function percentileSorted(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];
}

export function bucketForRange(range: TimeRange): number {
  return range.to - range.from > 48 * 3_600_000 ? 86_400_000 : 3_600_000;
}
