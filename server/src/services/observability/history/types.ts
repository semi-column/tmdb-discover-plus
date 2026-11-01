import { hashIdentifier } from '../identity.ts';
import type { TimeRange } from '../liveQueries.ts';
import type { ErrorEvent, RequestEvent, SystemSample, UpstreamEvent } from '../types.ts';
import type { HistoryOverview, HistoryUpstreamOverview } from './overview.ts';

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
  maxMs?: number;
  minUpstreamCalls?: number;
  sort?: RequestSort;
  errorsOnly: boolean;
  pathContains?: string;
  cursor?: { ts: Date; requestId: string; value?: number };
}

export type RequestSort = 'newest' | 'oldest' | 'duration' | 'upstreamCalls';

export interface ErrorFilter {
  status?: string;
  active: boolean;
  level?: 'error' | 'warn';
  q?: string;
  classification?: string;
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
  /** Backend capability; individual overview results also flag sampled request distributions. */
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
  ): Promise<{
    rows: Record<string, unknown>[];
    /** Matching retained rows before cursor pagination, not a weighted traffic estimate. */
    total: number;
    nextCursor: string | null;
  }>;
  requestFacets(range: TimeRange): Promise<Record<string, Array<{ value: string; count: number }>>>;
  getTrace(requestId: string): Promise<{
    requests: Record<string, unknown>[];
    upstream: Record<string, unknown>[];
    errors: Record<string, unknown>[];
  }>;
  routeStats(range: TimeRange): Promise<Record<string, unknown>[]>;
  overview(range: TimeRange, slowMs: number): Promise<HistoryOverview>;
  upstreamOverview(range: TimeRange): Promise<HistoryUpstreamOverview>;
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

export class RequestFilterValidationError extends RangeError {
  constructor(field: string) {
    super(`Invalid request filter: ${field}`);
    this.name = 'RequestFilterValidationError';
  }
}

export function parseRequestFilter(raw: Record<string, unknown>): RequestFilter {
  const text = (field: string, maxLength = MAX_TEXT) => {
    const value = raw[field];
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || !value.trim() || value.length > maxLength)
      throw new RequestFilterValidationError(field);
    return value.trim();
  };
  const filter: RequestFilter = { exact: {}, errorsOnly: false };
  if (raw.errorsOnly !== undefined) {
    if (!['true', 'false', true, false].includes(raw.errorsOnly as string | boolean))
      throw new RequestFilterValidationError('errorsOnly');
    filter.errorsOnly = raw.errorsOnly === 'true' || raw.errorsOnly === true;
  }
  const exactKeys: Array<[string, keyof RequestFilter['exact']]> = [
    ['route', 'route'],
    ['method', 'method'],
    ['source', 'source'],
    ['resource', 'resource'],
    ['client', 'client'],
    ['country', 'country'],
    ['instance', 'instance'],
    ['requestId', 'request_id'],
    ['userHash', 'user_hash'],
  ];
  for (const [param, field] of exactKeys) {
    const value = text(param);
    if (value) filter.exact[field] = value;
  }
  const userId = text('userId');
  if (userId) {
    const userHash = hashIdentifier(userId);
    if (filter.exact.user_hash && filter.exact.user_hash !== userHash)
      throw new RequestFilterValidationError('userHash');
    filter.exact.user_hash = userHash;
  }

  const status = text('status');
  if (status && /^[1-5]xx$/.test(status)) {
    filter.statusMin = Number(status[0]) * 100;
    filter.statusMax = filter.statusMin + 99;
  } else if (status && /^[1-5]\d{2}$/.test(status)) {
    filter.statusMin = filter.statusMax = Number(status);
  } else if (status !== undefined) {
    throw new RequestFilterValidationError('status');
  }

  for (const field of ['minMs', 'maxMs', 'minUpstreamCalls'] as const) {
    const value = text(field);
    if (value === undefined) continue;
    const number = Number(value);
    if (
      !/^\d+(?:\.\d+)?$/.test(value) ||
      !Number.isFinite(number) ||
      number > Number.MAX_SAFE_INTEGER ||
      (field === 'minUpstreamCalls' && !Number.isInteger(number))
    )
      throw new RequestFilterValidationError(field);
    filter[field] = number;
  }
  if (filter.minMs !== undefined && filter.maxMs !== undefined && filter.minMs > filter.maxMs)
    throw new RequestFilterValidationError('maxMs');

  filter.pathContains = text('q');
  const sortValue = text('sort') ?? 'newest';
  const sort = sortValue === 'upstream' ? 'upstreamCalls' : sortValue;
  if (!['newest', 'oldest', 'duration', 'upstreamCalls'].includes(sort))
    throw new RequestFilterValidationError('sort');
  filter.sort = sort as RequestSort;

  const cursor = text('cursor', 2048);
  if (cursor) {
    try {
      if (cursor.startsWith('v1:')) {
        const decoded = JSON.parse(Buffer.from(cursor.slice(3), 'base64url').toString());
        if (!Array.isArray(decoded) || decoded.length !== 4) throw new Error('cursor');
        const [cursorSort, ts, requestId, value] = decoded;
        if (
          cursorSort !== sort ||
          !Number.isSafeInteger(ts) ||
          typeof requestId !== 'string' ||
          !requestId ||
          requestId.length > MAX_TEXT ||
          !Number.isFinite(new Date(ts).getTime()) ||
          ((sort === 'duration' || sort === 'upstreamCalls') &&
            (typeof value !== 'number' || !Number.isFinite(value) || value < 0))
        )
          throw new Error('cursor');
        filter.cursor = { ts: new Date(ts), requestId, value };
      } else {
        const [ts, requestId, extra] = cursor.split('|');
        if (
          !['newest', 'oldest'].includes(sort) ||
          !requestId ||
          extra !== undefined ||
          !Number.isFinite(Date.parse(ts)) ||
          new Date(ts).toISOString() !== ts
        )
          throw new Error('cursor');
        filter.cursor = { ts: new Date(ts), requestId };
      }
    } catch {
      throw new RequestFilterValidationError('cursor');
    }
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
    classification: str(raw.classification),
  };
}

export function encodeCursor(
  rows: Record<string, unknown>[],
  limit: number,
  sort: RequestSort = 'newest'
): string | null {
  const last = rows[rows.length - 1];
  if (rows.length < limit || !last) return null;
  if (sort === 'newest' || sort === 'oldest')
    return `${new Date(last.ts as string | Date).toISOString()}|${last.request_id}`;
  return `v1:${Buffer.from(
    JSON.stringify([
      sort,
      new Date(last.ts as string | Date).getTime(),
      last.request_id,
      Number(last[sort === 'duration' ? 'duration_ms' : 'upstream_calls']),
    ])
  ).toString('base64url')}`;
}

/** Weighted nearest rank; identical to percentile_disc for unsampled (weight=1) rows. */
export function weightedPercentiles(values: Iterable<readonly [number, number]>) {
  const sorted = [...values].sort((a, b) => a[0] - b[0]);
  const total = sorted.reduce((sum, [, weight]) => sum + weight, 0);
  let cumulative = 0;
  const result: { p50Ms: number | null; p95Ms: number | null; p99Ms: number | null } = {
    p50Ms: null,
    p95Ms: null,
    p99Ms: null,
  };
  const quantiles = [
    ['p50Ms', 0.5],
    ['p95Ms', 0.95],
    ['p99Ms', 0.99],
  ] as const;
  for (const [value, weight] of sorted) {
    cumulative += weight;
    for (const [key, quantile] of quantiles) {
      if (total > 0 && result[key] === null && cumulative >= total * quantile) result[key] = value;
    }
  }
  return result;
}

/** Exact percentile over an ascending-sorted array. */
export function percentileSorted(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];
}

export function bucketForRange(range: TimeRange): number {
  return range.to - range.from > 48 * 3_600_000 ? 86_400_000 : 3_600_000;
}
