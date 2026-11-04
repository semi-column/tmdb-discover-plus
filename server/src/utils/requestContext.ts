import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { config } from '../config.ts';
import type { CacheReadLayer, CacheReadMetrics, CacheReads } from '../types/cache.ts';

export interface RequestCacheStats {
  hits: number;
  misses: number;
  writes: number;
  deletes: number;
  errors: number;
}

export interface RequestContextSnapshot {
  requestId: string;
  method: string;
  path: string;
  startedAt: number;
  cache: RequestCacheStats;
}

export interface RequestObsState {
  upstreamCalls: number;
  upstreamMs: number;
  errorFingerprint: string;
}

interface RequestStore {
  requestId: string;
  method: string;
  path: string;
  startedAt: number;
  abortController: AbortController;
  cache: RequestCacheStats;
  obs: RequestObsState;
  cacheReads: CacheReads;
  opportunistic?: boolean;
}

const asyncLocalStorage = new AsyncLocalStorage<RequestStore>();
// ponytail: per-process cap; coordinate across replicas if background pressure remains measurable.
const BACKGROUND_LIMIT = 2;
const backgroundStats = { active: 0, started: 0, skipped: 0 };

const buildEmptyCacheStats = (): RequestCacheStats => ({
  hits: 0,
  misses: 0,
  writes: 0,
  deletes: 0,
  errors: 0,
});

export function getRequestId(): string | undefined {
  return asyncLocalStorage.getStore()?.requestId;
}

export function abortRequestContext(reason?: unknown): void {
  asyncLocalStorage.getStore()?.abortController.abort(reason);
}

export function isRequestAborted(): boolean {
  return getRequestSignal()?.aborted ?? false;
}

export function getRequestSignal(): AbortSignal | undefined {
  return asyncLocalStorage.getStore()?.abortController.signal;
}

export function withRequestAbortContext<T>(work: () => Promise<T>): Promise<T> {
  if (asyncLocalStorage.getStore()) return work();
  return asyncLocalStorage.run(
    {
      requestId: randomBytes(9).toString('base64url'),
      method: 'BACKGROUND',
      path: '',
      startedAt: Date.now(),
      abortController: new AbortController(),
      cache: buildEmptyCacheStats(),
      cacheReads: {},
      obs: { upstreamCalls: 0, upstreamMs: 0, errorFingerprint: '' },
    },
    work
  );
}

export function isOpportunisticWork(): boolean {
  return asyncLocalStorage.getStore()?.opportunistic === true;
}

export function skipOpportunisticWork(reason: string): never {
  backgroundStats.skipped++;
  const error = Object.assign(new Error(`Background work skipped: ${reason}`), {
    code: 'OPPORTUNISTIC_SKIPPED',
  });
  abortRequestContext(error);
  throw error;
}

export function getBackgroundWorkStats(): {
  active: number;
  started: number;
  skipped: number;
  limit: number;
  enabled: boolean;
} {
  return {
    ...backgroundStats,
    limit: BACKGROUND_LIMIT,
    enabled: config.features?.backgroundPriority !== false,
  };
}

export function startOpportunisticWork<T>(
  work: () => Promise<T>
): { promise: Promise<T>; signal: AbortSignal } | undefined {
  const parent = asyncLocalStorage.getStore();
  const parentSignal = parent?.abortController.signal;
  if (parentSignal?.aborted) return undefined;
  if (config.features?.backgroundPriority === false) {
    return { promise: work(), signal: parentSignal ?? new AbortController().signal };
  }
  if (backgroundStats.active >= BACKGROUND_LIMIT) {
    backgroundStats.skipped++;
    return undefined;
  }

  const controller = new AbortController();
  const onAbort = () => controller.abort(parentSignal?.reason);
  parentSignal?.addEventListener('abort', onAbort, { once: true });
  const store: RequestStore = parent
    ? { ...parent, startedAt: Date.now(), abortController: controller, opportunistic: true }
    : {
        requestId: randomBytes(9).toString('base64url'),
        method: 'BACKGROUND',
        path: '',
        startedAt: Date.now(),
        abortController: controller,
        cache: buildEmptyCacheStats(),
        cacheReads: {},
        obs: { upstreamCalls: 0, upstreamMs: 0, errorFingerprint: '' },
        opportunistic: true,
      };
  backgroundStats.active++;
  backgroundStats.started++;
  const promise = asyncLocalStorage.run(store, async () => {
    try {
      return await work();
    } finally {
      backgroundStats.active--;
      parentSignal?.removeEventListener('abort', onAbort);
    }
  });
  return { promise, signal: controller.signal };
}

export function throwIfRequestAborted(): void {
  getRequestSignal()?.throwIfAborted();
}

export async function awaitWithRequestAbort<T>(promise: Promise<T>): Promise<T> {
  const signal = getRequestSignal();
  if (!signal) return promise;
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

/** Milliseconds left before a request started at `startedAt` hits `budgetMs`; Infinity outside a request. */
export function getRequestRemainingMs(budgetMs: number, now = Date.now()): number {
  const store = asyncLocalStorage.getStore();
  return store ? store.startedAt + budgetMs - now : Infinity;
}

export function getRequestContextSnapshot(): RequestContextSnapshot | undefined {
  const store = asyncLocalStorage.getStore();
  if (!store) return undefined;
  return {
    requestId: store.requestId,
    method: store.method,
    path: store.path,
    startedAt: store.startedAt,
    cache: { ...store.cache },
  };
}

export function getRequestCacheStats(): RequestCacheStats | undefined {
  const store = asyncLocalStorage.getStore();
  if (!store) return undefined;
  return { ...store.cache };
}

/** Live (mutable) references, safe to hold past the async context, e.g. in res 'finish'. */
export function getRequestLiveState():
  | {
      requestId: string;
      path: string;
      cache: RequestCacheStats;
      cacheReads: CacheReads;
      obs: RequestObsState;
    }
  | undefined {
  return asyncLocalStorage.getStore();
}

export function trackCacheRead(layer: CacheReadLayer, outcome: keyof CacheReadMetrics): void {
  const store = asyncLocalStorage.getStore();
  if (!store) return;
  const row = (store.cacheReads[layer] ??= {
    freshHits: 0,
    staleHits: 0,
    misses: 0,
    cachedErrors: 0,
    readErrors: 0,
  });
  row[outcome]++;
  store.cache[
    outcome === 'freshHits' || outcome === 'staleHits'
      ? 'hits'
      : outcome === 'misses'
        ? 'misses'
        : 'errors'
  ]++;
}

export function trackCacheOperation(op: keyof RequestCacheStats): void {
  const store = asyncLocalStorage.getStore();
  if (!store) return;
  store.cache[op] += 1;
}

const VALID_REQUEST_ID = /^[\w\-.]+$/;
const MAX_REQUEST_ID_LENGTH = 128;

export function requestIdMiddleware() {
  return (req: Request, res: Response, next: () => void): void => {
    const incoming = req.headers['x-request-id'] as string | undefined;
    const requestId =
      incoming && incoming.length <= MAX_REQUEST_ID_LENGTH && VALID_REQUEST_ID.test(incoming)
        ? incoming
        : randomBytes(9).toString('base64url');
    res.setHeader('X-Request-Id', requestId);
    const store: RequestStore = {
      requestId,
      method: req.method,
      path: req.originalUrl || req.url,
      startedAt: Date.now(),
      abortController: new AbortController(),
      cache: buildEmptyCacheStats(),
      cacheReads: {},
      obs: { upstreamCalls: 0, upstreamMs: 0, errorFingerprint: '' },
    };
    asyncLocalStorage.run(store, () => {
      res.once?.('close', () => {
        if (!res.writableFinished) store.abortController.abort();
      });
      next();
    });
  };
}
