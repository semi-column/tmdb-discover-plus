import { CACHE_READ_LAYERS, type CacheReadMetrics, type CacheReads } from '../../../types/cache.ts';

export interface CacheMetrics {
  requests: number;
  hits: number;
  misses: number;
  allHits: number;
  mixed: number;
  missesOnly: number;
  missesWithUpstream: number;
}

export interface CacheStats {
  totals: CacheMetrics;
  groups: Array<CacheMetrics & { key: string }>;
  sampled: boolean;
  coverage: CacheCoverage;
  details: { totals: CacheReadMetrics; layers: Array<CacheReadMetrics & { key: string }> };
}

export interface CacheCoverage {
  /** Unweighted retained rows in the selected range and filters, including no-cache requests. */
  retainedRequests: number;
  detailedRequests: number;
  oldest: string | null;
  newest: string | null;
  detailedOldest: string | null;
}

export function cacheCoverage(row: Record<string, unknown> = {}): CacheCoverage {
  const date = (value: unknown) =>
    value instanceof Date || typeof value === 'string' || typeof value === 'number'
      ? new Date(value).toISOString()
      : null;
  return {
    retainedRequests: Number(row.retainedRequests ?? 0),
    detailedRequests: Number(row.detailedRequests ?? 0),
    oldest: date(row.oldest),
    newest: date(row.newest),
    detailedOldest: date(row.detailedOldest),
  };
}

export function cacheReadMetrics(
  row: Partial<CacheReadMetrics> | Record<string, unknown> = {}
): CacheReadMetrics {
  return {
    freshHits: Number(row.freshHits ?? 0),
    staleHits: Number(row.staleHits ?? 0),
    misses: Number(row.misses ?? 0),
    cachedErrors: Number(row.cachedErrors ?? 0),
    readErrors: Number(row.readErrors ?? 0),
  };
}

export function cacheDetails(reads: CacheReads): CacheStats['details'] {
  const totals = cacheReadMetrics();
  const layers = CACHE_READ_LAYERS.filter((key) => reads[key]).map((key) => {
    const row = cacheReadMetrics(reads[key]);
    for (const field of Object.keys(totals) as Array<keyof CacheReadMetrics>)
      totals[field] += row[field];
    return { key, ...row };
  });
  layers.sort((a, b) => b.misses - a.misses || a.key.localeCompare(b.key));
  return { totals, layers };
}

export function cacheMetrics(row: Record<string, unknown> = {}): CacheMetrics {
  return {
    requests: Number(row.requests ?? 0),
    hits: Number(row.hits ?? 0),
    misses: Number(row.misses ?? 0),
    allHits: Number(row.allHits ?? 0),
    mixed: Number(row.mixed ?? 0),
    missesOnly: Number(row.missesOnly ?? 0),
    missesWithUpstream: Number(row.missesWithUpstream ?? 0),
  };
}
