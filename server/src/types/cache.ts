export interface ICacheAdapter {
  get(key: string): Promise<unknown | null>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
  connect?(): Promise<void>;
  getStats?(): Record<string, unknown>;
}

export type CacheErrorType =
  | 'EMPTY_RESULT'
  | 'RATE_LIMITED'
  | 'TEMPORARY_ERROR'
  | 'PERMANENT_ERROR'
  | 'NOT_FOUND'
  | 'CACHE_CORRUPTED';

export interface CacheWrapperEntry {
  __cacheWrapper: true;
  __storedAt: number;
  __ttl: number;
  data: unknown;
  __errorType?: CacheErrorType;
  __errorMessage?: string;
  __isStale?: boolean;
}

export interface CacheWrapperStats {
  hits: number;
  misses: number;
  errors: number;
  cachedErrors: number;
  corruptedEntries: number;
  deduplicatedRequests: number;
  staleServed: number;
  inFlightOverflows: number;
  writeValidationFailures: number;
  hitRate: string;
  inFlightRequests: number;
  inFlightMax: number;
  adapter: Record<string, unknown>;
}

export interface CacheWrapOptions {
  allowStale?: boolean;
}
