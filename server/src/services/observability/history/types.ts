import { hashIdentifier } from '../identity.ts';
import type { TimeRange } from '../liveQueries.ts';
import type { ErrorEvent, RequestEvent, SystemSample, UpstreamEvent } from '../types.ts';
import type { HistoryOverview, HistoryUpstreamOverview } from './overview.ts';
import type { CacheStats } from './cache.ts';

export type HistoryKind = 'postgres' | 'mongo' | 'memory';

export interface ErrorGroupBatch {
  count: number;
  first: ErrorEvent;
  lastTs: number;
}

export type ExcludableColumn =
  'route' | 'method' | 'source' | 'resource' | 'content_type' | 'client' | 'country' | 'instance';

/** Backend-neutral request filters, parsed and validated once from the query string. */
export interface RequestFilter {
  exact: Partial<Record<ExcludableColumn | 'request_id' | 'user_hash', string>>;
  /** "is not" filters: rows whose column equals any listed value are dropped. */
  exclude: Partial<Record<ExcludableColumn, string[]>>;
  statusMin?: number;
  statusMax?: number;
  /** Inclusive [min, max] status ranges to drop, e.g. 4xx = [400, 499]. */
  excludeStatus: Array<[number, number]>;
  minMs?: number;
  maxMs?: number;
  minUpstreamCalls?: number;
  sort?: RequestSort;
  errorsOnly: boolean;
  pathContains?: string;
  cursor?: { ts: Date; requestId: string; value?: number };
}

export const EMPTY_REQUEST_FILTER: RequestFilter = Object.freeze({
  exact: {},
  exclude: {},
  excludeStatus: [],
  errorsOnly: false,
}) as RequestFilter;

/** True when the filter narrows rows (sort and cursor only order them). */
export function hasRequestConditions(filter: RequestFilter): boolean {
  return Boolean(
    Object.keys(filter.exact).length ||
    Object.keys(filter.exclude).length ||
    filter.excludeStatus.length ||
    filter.statusMin !== undefined ||
    filter.minMs !== undefined ||
    filter.maxMs !== undefined ||
    filter.minUpstreamCalls !== undefined ||
    filter.errorsOnly ||
    filter.pathContains
  );
}

/** Request columns the explorer can group by; values are interpolated into SQL, so keep this a closed set. */
export const REQUEST_GROUP_COLUMNS = {
  route: 'route',
  path: 'path',
  method: 'method',
  status: 'status',
  source: 'source',
  resource: 'resource',
  contentType: 'content_type',
  catalog: 'catalog_id',
  client: 'client',
  country: 'country',
  colo: 'colo',
  instance: 'instance',
} as const;
export type RequestGroupColumn = (typeof REQUEST_GROUP_COLUMNS)[keyof typeof REQUEST_GROUP_COLUMNS];
export const REQUEST_GROUP_LIMIT = 50;
/** Groups that get their own line in the per-group traffic chart. */
export const REQUEST_GROUP_SERIES = 6;

export function parseGroupBy(raw: unknown): RequestGroupColumn {
  const key = typeof raw === 'string' && raw ? raw : 'route';
  if (!Object.hasOwn(REQUEST_GROUP_COLUMNS, key)) throw new RequestFilterValidationError('by');
  return REQUEST_GROUP_COLUMNS[key as keyof typeof REQUEST_GROUP_COLUMNS];
}

export interface RequestGroupRow {
  key: string;
  count: number;
  errors5xx: number;
  errors4xx: number;
  avg_ms: number;
  p50_ms: number | null;
  p95_ms: number | null;
  p99_ms: number | null;
  avg_upstream_calls: number;
  users: number;
}

/** Normalises driver output (bigint strings, floats) to the API row shape. */
export function toGroupRow(raw: Record<string, unknown>): RequestGroupRow {
  const num = (value: unknown) => (value === null || value === undefined ? null : Number(value));
  return {
    key: String(raw.key ?? ''),
    count: Math.round(Number(raw.count) || 0),
    errors5xx: Math.round(Number(raw.errors5xx) || 0),
    errors4xx: Math.round(Number(raw.errors4xx) || 0),
    avg_ms: Number(raw.avg_ms) || 0,
    p50_ms: num(raw.p50_ms),
    p95_ms: num(raw.p95_ms),
    p99_ms: num(raw.p99_ms),
    avg_upstream_calls: Math.round((Number(raw.avg_upstream_calls) || 0) * 10) / 10,
    users: Number(raw.users) || 0,
  };
}

export interface RequestGroups {
  groups: RequestGroupRow[];
  /** Total matching weighted requests, including groups beyond the limit. */
  total: number;
  series: { t: number[]; keys: string[]; values: number[][] };
}

export function groupSeriesBucketMs(range: TimeRange): number {
  return range.kind === 'm' ? 60_000 : 3_600_000;
}

/** Zero-filled per-group counts for the top groups, aligned to the overview's buckets. */
export function buildGroupSeries(
  range: TimeRange,
  groups: RequestGroupRow[],
  points: Array<{ bucket: number; key: string; n: number }>
): RequestGroups['series'] {
  const bucketMs = groupSeriesBucketMs(range);
  const keys = groups.slice(0, REQUEST_GROUP_SERIES).map((g) => g.key);
  const start = Math.floor(range.from / bucketMs);
  const end = Math.floor(range.to / bucketMs);
  const t: number[] = [];
  for (let index = start; index <= end; index++) t.push((index * bucketMs) / 1000);
  const values = keys.map(() => t.map(() => 0));
  for (const point of points) {
    const row = keys.indexOf(point.key);
    const col = Math.floor(point.bucket / bucketMs) - start;
    if (row >= 0 && col >= 0 && col < t.length) values[row][col] += point.n;
  }
  return { t, keys, values: values.map((list) => list.map(Math.round)) };
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
  cacheStats(range: TimeRange, filter: RequestFilter, by: 'route' | 'path'): Promise<CacheStats>;
  groupRequests(
    range: TimeRange,
    filter: RequestFilter,
    by: RequestGroupColumn
  ): Promise<RequestGroups>;
  overview(range: TimeRange, slowMs: number, filter?: RequestFilter): Promise<HistoryOverview>;
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
  /** Comma-separated values; filter values (route templates, labels) never contain commas. */
  const list = (field: string) => {
    const value = text(field, MAX_TEXT * 4);
    if (!value) return [];
    const values = [
      ...new Set(
        value
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean)
      ),
    ];
    if (values.length > 20) throw new RequestFilterValidationError(field);
    return values;
  };
  const filter: RequestFilter = { exact: {}, exclude: {}, excludeStatus: [], errorsOnly: false };
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
    ['contentType', 'content_type'],
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

  const excludeKeys: Array<[string, ExcludableColumn]> = [
    ['notRoute', 'route'],
    ['notMethod', 'method'],
    ['notSource', 'source'],
    ['notResource', 'resource'],
    ['notContentType', 'content_type'],
    ['notClient', 'client'],
    ['notCountry', 'country'],
    ['notInstance', 'instance'],
  ];
  for (const [param, field] of excludeKeys) {
    const values = list(param);
    if (values.length) filter.exclude[field] = values;
  }
  for (const value of list('notStatus')) {
    if (/^[1-5]xx$/.test(value)) {
      const min = Number(value[0]) * 100;
      filter.excludeStatus.push([min, min + 99]);
    } else if (/^[1-5]\d{2}$/.test(value)) {
      filter.excludeStatus.push([Number(value), Number(value)]);
    } else throw new RequestFilterValidationError('notStatus');
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
