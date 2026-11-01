import { LATENCY_BUCKETS } from '../collector.ts';
import { histPercentile, type TimeRange } from '../liveQueries.ts';

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
}

export function buildHistoryOverview(
  range: TimeRange,
  buckets: OverviewBucket[],
  routes: Record<string, unknown>[],
  statuses: Array<{ status: number; count: number }>,
  breakdownRows: OverviewBreakdown[],
  logBuckets: OverviewLogBucket[],
  logCounts: { errors: number; warnings: number },
  uniqueUsers: number
) {
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
    series.p95Ms.push(bucket ? histPercentile(bucket.histogram, 0.95) : null);
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
    range: { from: range.from, to: range.to, resolution: range.kind === 'm' ? 'minute' : 'hour' },
    totals: {
      requests: Math.round(totals.requests),
      errors5xx: Math.round(totals.errors5xx),
      errors4xx: Math.round(totals.errors4xx),
      errorRate: totals.requests ? totals.errors5xx / totals.requests : 0,
      slow: Math.round(totals.slow),
      avgMs: totals.requests ? Math.round(totals.duration / totals.requests) : null,
      p50Ms: histPercentile(histogram, 0.5),
      p95Ms: histPercentile(histogram, 0.95),
      p99Ms: histPercentile(histogram, 0.99),
      cacheHitRate: cacheLookups ? totals.cacheHits / cacheLookups : null,
      logErrors: logCounts.errors,
      logWarnings: logCounts.warnings,
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
    routes,
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

export type HistoryOverview = ReturnType<typeof buildHistoryOverview>;
