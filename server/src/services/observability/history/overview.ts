import { LATENCY_BUCKETS } from '../collector.ts';
import { histPercentile, type TimeRange } from '../liveQueries.ts';

export interface ExactPercentiles {
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
}

export interface OverviewBucket {
  bucket: number;
  requests: number;
  errors5xx: number;
  errors4xx: number;
  slow: number;
  duration: number;
  cacheHits: number;
  cacheMisses: number;
  histogram: number[];
  p95Ms?: number | null;
  sampled?: boolean;
}

export interface OverviewBreakdown {
  kind: string;
  key: string;
  count: number;
}

export interface OverviewLogBucket {
  bucket: number;
  errors: number;
  warnings: number;
  userConfigErrors?: number;
  userConfigWarnings?: number;
}

export interface UpstreamOverviewBucket {
  provider: string;
  bucket: number;
  calls: number;
  errors: number;
  rateLimited: number;
  timeouts: number;
  rejected?: number;
  cancelled?: number;
  duration: number;
  histogram: number[];
  p95Ms?: number | null;
}

export function buildHistoryOverview(
  range: TimeRange,
  buckets: OverviewBucket[],
  routes: Record<string, unknown>[],
  statuses: Array<{ status: number; count: number }>,
  breakdownRows: OverviewBreakdown[],
  logBuckets: OverviewLogBucket[],
  logCounts: {
    errors: number;
    warnings: number;
    userConfigErrors?: number;
    userConfigWarnings?: number;
  },
  uniqueUsers: number,
  percentiles?: ExactPercentiles
) {
  const toNumber = (value: unknown, fallback = 0): number => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };
  const optionalNumber = (value: unknown): number | null => {
    if (value == null) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };
  const normalizedRoutes = routes.map((row) => ({
    route: String(row.route ?? ''),
    count: toNumber(row.count),
    errors5xx: toNumber(row.errors5xx ?? row.e5),
    errors4xx: toNumber(row.errors4xx ?? row.e4),
    avgMs: optionalNumber(row.avgMs ?? row.avg_ms),
    p50Ms: optionalNumber(row.p50Ms ?? row.p50_ms),
    p95Ms: optionalNumber(row.p95Ms ?? row.p95_ms),
    p99Ms: optionalNumber(row.p99Ms ?? row.p99_ms),
    maxMs: optionalNumber(row.maxMs ?? row.max_ms),
    avgUpstreamCalls: optionalNumber(row.avgUpstreamCalls ?? row.avg_upstream_calls),
    percentilesApproximate: Boolean(row.percentilesApproximate ?? row.approximatePercentiles),
  }));
  const bucketMs = range.kind === 'm' ? 60_000 : 3_600_000;
  const start = Math.floor(range.from / bucketMs);
  const end = Math.floor(range.to / bucketMs);
  const byBucket = new Map(buckets.map((bucket) => [Math.floor(bucket.bucket / bucketMs), bucket]));
  const logsByBucket = new Map(
    logBuckets.map((bucket) => [Math.floor(bucket.bucket / bucketMs), bucket])
  );
  const histogram = Array(LATENCY_BUCKETS.length + 1).fill(0) as number[];
  const totals = {
    requests: 0,
    errors5xx: 0,
    errors4xx: 0,
    slow: 0,
    duration: 0,
    cacheHits: 0,
    cacheMisses: 0,
  };
  const series = {
    t: [] as number[],
    requests: [] as number[],
    errors5xx: [] as number[],
    errors4xx: [] as number[],
    slow: [] as number[],
    avgMs: [] as Array<number | null>,
    p95Ms: [] as Array<number | null>,
    logErrors: [] as number[],
    logWarnings: [] as number[],
  };

  for (let index = start; index <= end; index++) {
    const bucket = byBucket.get(index);
    const time = index * bucketMs;
    series.t.push(time / 1000);
    series.requests.push(bucket?.requests ?? 0);
    series.errors5xx.push(bucket?.errors5xx ?? 0);
    series.errors4xx.push(bucket?.errors4xx ?? 0);
    series.slow.push(bucket?.slow ?? 0);
    series.avgMs.push(bucket?.requests ? Math.round(bucket.duration / bucket.requests) : null);
    series.p95Ms.push(bucket ? (bucket.p95Ms ?? histPercentile(bucket.histogram, 0.95)) : null);
    series.logErrors.push(logsByBucket.get(index)?.errors ?? 0);
    series.logWarnings.push(logsByBucket.get(index)?.warnings ?? 0);
    if (!bucket) continue;
    for (const key of [
      'requests',
      'errors5xx',
      'errors4xx',
      'slow',
      'duration',
      'cacheHits',
      'cacheMisses',
    ] as const)
      totals[key] += bucket[key];
    bucket.histogram.forEach((value, i) => {
      histogram[i] += value;
    });
  }

  const statusCodes = Object.fromEntries(
    statuses.map(({ status, count }) => [String(status), count])
  );
  const grouped = (kind: string, limit = 25) =>
    breakdownRows
      .filter((row) => row.kind === kind)
      .sort((a, b) => b.count - a.count)
      .slice(0, limit)
      .map(({ key, count }) => ({ key, count }));
  const cacheLookups = totals.cacheHits + totals.cacheMisses;

  return {
    percentilesApproximate: !percentiles || buckets.some((bucket) => bucket.sampled),
    // Legacy history retained capped samples; occurrences cannot recover events already discarded.
    logCountBasis: 'recorded_occurrences' as const,
    range: { from: range.from, to: range.to, resolution: range.kind === 'm' ? 'minute' : 'hour' },
    totals: {
      requests: Math.round(totals.requests),
      errors5xx: Math.round(totals.errors5xx),
      errors4xx: Math.round(totals.errors4xx),
      errorRate: totals.requests ? totals.errors5xx / totals.requests : 0,
      slow: Math.round(totals.slow),
      avgMs: totals.requests ? Math.round(totals.duration / totals.requests) : null,
      p50Ms: percentiles ? percentiles.p50Ms : histPercentile(histogram, 0.5),
      p95Ms: percentiles ? percentiles.p95Ms : histPercentile(histogram, 0.95),
      p99Ms: percentiles ? percentiles.p99Ms : histPercentile(histogram, 0.99),
      cacheHitRate: cacheLookups ? totals.cacheHits / cacheLookups : null,
      logErrors: logCounts.errors,
      logWarnings: logCounts.warnings,
      userConfigErrors: logCounts.userConfigErrors ?? 0,
      userConfigWarnings: logCounts.userConfigWarnings ?? 0,
      uniqueUsers,
    },
    latencyHistogram: { bounds: LATENCY_BUCKETS, counts: histogram },
    statusClasses: {
      '2xx': statuses
        .filter(({ status }) => status >= 200 && status < 300)
        .reduce((sum, row) => sum + row.count, 0),
      '3xx': statuses
        .filter(({ status }) => status >= 300 && status < 400)
        .reduce((sum, row) => sum + row.count, 0),
      '4xx': totals.errors4xx,
      '5xx': totals.errors5xx,
    },
    statusCodes,
    routes: normalizedRoutes,
    breakdowns: {
      resources: grouped('resource'),
      sources: grouped('source'),
      contentTypes: grouped('contentType'),
      clients: grouped('client'),
      countries: grouped('country', 60),
      colos: grouped('colo', 60),
      instances: grouped('instance'),
    },
    series,
  };
}

export function buildHistoryUpstreamOverview(
  range: TimeRange,
  rows: UpstreamOverviewBucket[],
  percentiles?: Map<string, ExactPercentiles>
) {
  const bucketMs = range.kind === 'm' ? 60_000 : 3_600_000;
  const start = Math.floor(range.from / bucketMs);
  const end = Math.floor(range.to / bucketMs);
  const providers = new Map<string, Map<number, UpstreamOverviewBucket>>();

  for (const row of rows) {
    let buckets = providers.get(row.provider);
    if (!buckets) {
      buckets = new Map();
      providers.set(row.provider, buckets);
    }
    buckets.set(Math.floor(row.bucket / bucketMs), row);
  }

  return [...providers.entries()]
    .map(([provider, buckets]) => {
      const histogram = Array(LATENCY_BUCKETS.length + 1).fill(0) as number[];
      let calls = 0;
      let errors = 0;
      let rateLimited = 0;
      let timeouts = 0;
      let rejected = 0;
      let cancelled = 0;
      let duration = 0;
      const series = {
        t: [] as number[],
        calls: [] as number[],
        errors: [] as number[],
        rejected: [] as number[],
        cancelled: [] as number[],
        avgMs: [] as Array<number | null>,
        p95Ms: [] as Array<number | null>,
      };

      for (let index = start; index <= end; index++) {
        const bucket = buckets.get(index);
        series.t.push((index * bucketMs) / 1000);
        series.calls.push(bucket?.calls ?? 0);
        series.errors.push(bucket?.errors ?? 0);
        series.rejected.push(bucket?.rejected ?? 0);
        series.cancelled.push(bucket?.cancelled ?? 0);
        series.avgMs.push(bucket?.calls ? Math.round(bucket.duration / bucket.calls) : null);
        series.p95Ms.push(bucket ? (bucket.p95Ms ?? histPercentile(bucket.histogram, 0.95)) : null);
        if (!bucket) continue;
        calls += bucket.calls;
        errors += bucket.errors;
        rateLimited += bucket.rateLimited;
        timeouts += bucket.timeouts;
        rejected += bucket.rejected ?? 0;
        cancelled += bucket.cancelled ?? 0;
        duration += bucket.duration;
        bucket.histogram.forEach((value, i) => {
          histogram[i] += value;
        });
      }

      return {
        provider,
        percentilesApproximate: !percentiles?.has(provider),
        calls,
        errors,
        rateLimited,
        timeouts,
        rejected,
        cancelled,
        errorRate: calls ? errors / calls : 0,
        avgMs: calls ? Math.round(duration / calls) : null,
        p50Ms: percentiles?.get(provider)?.p50Ms ?? histPercentile(histogram, 0.5),
        p95Ms: percentiles?.get(provider)?.p95Ms ?? histPercentile(histogram, 0.95),
        p99Ms: percentiles?.get(provider)?.p99Ms ?? histPercentile(histogram, 0.99),
        series,
      };
    })
    .sort((a, b) => b.calls - a.calls);
}

export type HistoryOverview = ReturnType<typeof buildHistoryOverview>;
export type HistoryUpstreamOverview = ReturnType<typeof buildHistoryUpstreamOverview>;
