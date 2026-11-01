import { LATENCY_BUCKETS } from './collector.ts';
import type { LiveStore } from './liveStore.ts';

const RANGES: Record<string, number> = {
  '15m': 15 * 60_000,
  '1h': 3_600_000,
  '6h': 6 * 3_600_000,
  '24h': 24 * 3_600_000,
  '7d': 7 * 24 * 3_600_000,
};

export interface TimeRange {
  from: number;
  to: number;
  kind: 'm' | 'h';
}

export function parseRange(query: Record<string, unknown>, maxDays: number): TimeRange {
  const to = Date.now();
  if (query.range === 'custom') {
    const hasFrom =
      typeof query.from === 'number' || (typeof query.from === 'string' && !!query.from.trim());
    const hasTo =
      typeof query.to === 'number' || (typeof query.to === 'string' && !!query.to.trim());
    const requestedFrom = hasFrom ? Number(query.from) : NaN;
    const requestedTo = hasTo ? Number(query.to) : NaN;
    if (
      Number.isFinite(requestedFrom) &&
      Number.isFinite(requestedTo) &&
      requestedTo > requestedFrom
    ) {
      const retentionStart = to - maxDays * 86_400_000;
      const from = Math.max(retentionStart, Math.min(requestedFrom, to));
      const boundedTo = Math.max(from, Math.min(requestedTo, to));
      const span = boundedTo - from;
      if (span <= 0) throw new RangeError('Custom time range is outside retained history');
      return { from, to: boundedTo, kind: span <= RANGES['24h'] ? 'm' : 'h' };
    }
    throw new RangeError('Custom time range requires valid from/to epoch milliseconds');
  }

  if (query.range !== undefined && !Object.hasOwn(RANGES, String(query.range))) {
    throw new RangeError('Unknown time range');
  }
  const span = RANGES[String(query.range)] ?? RANGES['1h'];
  const from = Math.max(to - span, to - maxDays * 86_400_000);
  // Minute buckets live 24h in the live store; anything longer uses hourly buckets.
  return { from, to, kind: span <= RANGES['24h'] ? 'm' : 'h' };
}

export function previousRangeIfRetained(
  range: TimeRange,
  retentionDays: number,
  now = Date.now()
): TimeRange | null {
  const span = range.to - range.from;
  const from = range.from - span;
  if (from < now - retentionDays * 86_400_000) return null;
  return { ...range, from, to: range.from - 1 };
}

function sumInto(target: Record<string, number>, source: Record<string, number>): void {
  for (const [k, v] of Object.entries(source)) target[k] = (target[k] ?? 0) + v;
}

function histogram(fields: Record<string, number>, prefix: string): number[] {
  return Array.from({ length: LATENCY_BUCKETS.length + 1 }, (_, i) => fields[`${prefix}${i}`] ?? 0);
}

/** Upper bound of the bucket holding the q-th percentile; approximate by design. */
export function histPercentile(hist: number[], q: number): number | null {
  const total = hist.reduce((a, b) => a + b, 0);
  if (!total) return null;
  let cum = 0;
  for (let i = 0; i < hist.length; i++) {
    cum += hist[i];
    if (cum >= q * total)
      return LATENCY_BUCKETS[i] ?? LATENCY_BUCKETS[LATENCY_BUCKETS.length - 1] * 2;
  }
  return null;
}

function byPrefix(fields: Record<string, number>, prefix: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
  }
  return out;
}

function topEntries(
  map: Record<string, number>,
  limit = 25
): Array<{ key: string; count: number }> {
  return Object.entries(map)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function bucketSpan(range: TimeRange): { size: number; from: number; to: number } {
  const size = range.kind === 'm' ? 60_000 : 3_600_000;
  return { size, from: Math.floor(range.from / size), to: Math.floor(range.to / size) };
}

function userKeys(range: TimeRange): string[] {
  if (range.to - range.from <= 48 * 3_600_000) {
    const keys: string[] = [];
    for (let h = Math.floor(range.from / 3_600_000); h <= Math.floor(range.to / 3_600_000); h++) {
      keys.push(`h:${h}`);
    }
    return keys;
  }
  const keys: string[] = [];
  for (let t = range.from; t <= range.to + 86_400_000; t += 86_400_000) {
    if (t > range.to && keys.length) break;
    keys.push(`d:${new Date(t).toISOString().slice(0, 10).replace(/-/g, '')}`);
  }
  return keys;
}

export async function liveOverview(live: LiveStore, range: TimeRange) {
  // Live minute buckets expire by age, not by the width of the selected interval.
  if (range.kind === 'm' && range.from < Date.now() - 24 * 3_600_000) {
    range = { ...range, kind: 'h' };
  }
  const span = bucketSpan(range);
  const buckets = await live.readBuckets(range.kind, span.from, span.to);
  // Breakdowns only exist in hourly buckets.
  const hourBuckets =
    range.kind === 'h'
      ? buckets
      : await live.readBuckets(
          'h',
          Math.floor(range.from / 3_600_000),
          Math.floor(range.to / 3_600_000)
        );

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
  const totals: Record<string, number> = {};
  for (let b = span.from; b <= span.to; b++) {
    const f = buckets.get(b) ?? {};
    sumInto(totals, f);
    const req = f.req ?? 0;
    series.t.push((b * span.size) / 1000);
    series.requests.push(req);
    series.errors5xx.push(f['sc:5xx'] ?? 0);
    series.errors4xx.push(f['sc:4xx'] ?? 0);
    series.slow.push(f.slow ?? 0);
    series.avgMs.push(req ? Math.round((f.dur ?? 0) / req) : null);
    series.p95Ms.push(histPercentile(histogram(f, 'lat:'), 0.95));
    series.logErrors.push(f.err ?? 0);
    series.logWarnings.push(f.warn ?? 0);
  }

  const hourTotals: Record<string, number> = {};
  for (const f of hourBuckets.values()) sumInto(hourTotals, f);

  const hist = histogram(totals, 'lat:');
  const req = totals.req ?? 0;
  const cacheOps = (totals.ch ?? 0) + (totals.cm ?? 0);

  const routeCounts = byPrefix(hourTotals, 'r:');
  const routeErrors = byPrefix(hourTotals, 're:');
  const route4xx = byPrefix(hourTotals, 'r4:');
  const routeDur = byPrefix(hourTotals, 'rd:');
  const routes = Object.entries(routeCounts)
    .map(([route, count]) => ({
      route,
      count,
      errors5xx: routeErrors[route] ?? 0,
      errors4xx: route4xx[route] ?? 0,
      avgMs: count ? Math.round((routeDur[route] ?? 0) / count) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    range: { from: range.from, to: range.to, resolution: range.kind === 'm' ? 'minute' : 'hour' },
    totalsResolution: range.kind === 'm' ? 'minute' : 'hour',
    breakdownResolution: 'hour',
    totals: {
      requests: req,
      errors5xx: totals['sc:5xx'] ?? 0,
      errors4xx: totals['sc:4xx'] ?? 0,
      errorRate: req ? (totals['sc:5xx'] ?? 0) / req : 0,
      slow: totals.slow ?? 0,
      avgMs: req ? Math.round((totals.dur ?? 0) / req) : null,
      p50Ms: histPercentile(hist, 0.5),
      p95Ms: histPercentile(hist, 0.95),
      p99Ms: histPercentile(hist, 0.99),
      cacheHitRate: cacheOps ? (totals.ch ?? 0) / cacheOps : null,
      logErrors: totals.err ?? 0,
      logWarnings: totals.warn ?? 0,
      uniqueUsers: await live.countUsers(userKeys(range)),
    },
    latencyHistogram: { bounds: LATENCY_BUCKETS, counts: hist },
    statusClasses: byPrefix(totals, 'sc:'),
    statusCodes: byPrefix(hourTotals, 'st:'),
    routes,
    breakdowns: {
      resources: topEntries(byPrefix(hourTotals, 'res:')),
      sources: topEntries(byPrefix(hourTotals, 'src:')),
      contentTypes: topEntries(byPrefix(hourTotals, 'ct:')),
      clients: topEntries(byPrefix(hourTotals, 'cli:')),
      countries: topEntries(byPrefix(hourTotals, 'cty:'), 60),
      colos: topEntries(byPrefix(hourTotals, 'colo:'), 60),
      instances: topEntries(byPrefix(totals, 'inst:')),
    },
    series,
  };
}

export async function liveUpstreams(live: LiveStore, range: TimeRange) {
  if (range.kind === 'm' && range.from < Date.now() - 24 * 3_600_000) {
    range = { ...range, kind: 'h' };
  }
  const span = bucketSpan(range);
  const buckets = await live.readBuckets(range.kind, span.from, span.to);
  const totals: Record<string, number> = {};
  for (const f of buckets.values()) sumInto(totals, f);

  const providers = Object.keys(byPrefix(totals, 'u:'));
  const series: Record<
    string,
    { t: number[]; calls: number[]; errors: number[]; avgMs: Array<number | null> }
  > = {};
  for (const p of providers) series[p] = { t: [], calls: [], errors: [], avgMs: [] };
  for (let b = span.from; b <= span.to; b++) {
    const f = buckets.get(b) ?? {};
    for (const p of providers) {
      const calls = f[`u:${p}`] ?? 0;
      series[p].t.push((b * span.size) / 1000);
      series[p].calls.push(calls);
      series[p].errors.push(f[`ue:${p}`] ?? 0);
      series[p].avgMs.push(calls ? Math.round((f[`ud:${p}`] ?? 0) / calls) : null);
    }
  }

  return providers
    .map((p) => {
      const calls = totals[`u:${p}`] ?? 0;
      const hist = histogram(totals, `ul:${p}:`);
      return {
        provider: p,
        calls,
        errors: totals[`ue:${p}`] ?? 0,
        rateLimited: totals[`u429:${p}`] ?? 0,
        timeouts: totals[`ut:${p}`] ?? 0,
        cancelled: totals[`uc:${p}`] ?? 0,
        rejected: totals[`u4:${p}`] ?? 0,
        percentilesApproximate: true,
        errorRate: calls ? (totals[`ue:${p}`] ?? 0) / calls : 0,
        avgMs: calls ? Math.round((totals[`ud:${p}`] ?? 0) / calls) : null,
        p50Ms: histPercentile(hist, 0.5),
        p95Ms: histPercentile(hist, 0.95),
        p99Ms: histPercentile(hist, 0.99),
        series: series[p],
      };
    })
    .sort((a, b) => b.calls - a.calls);
}
