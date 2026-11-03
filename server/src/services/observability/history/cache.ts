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
