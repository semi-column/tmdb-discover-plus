import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';

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
  cache: RequestCacheStats;
  obs: RequestObsState;
}

const asyncLocalStorage = new AsyncLocalStorage<RequestStore>();

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
  { requestId: string; path: string; cache: RequestCacheStats; obs: RequestObsState } | undefined {
  return asyncLocalStorage.getStore();
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
    asyncLocalStorage.run(
      {
        requestId,
        method: req.method,
        path: req.originalUrl || req.url,
        startedAt: Date.now(),
        cache: buildEmptyCacheStats(),
        obs: { upstreamCalls: 0, upstreamMs: 0, errorFingerprint: '' },
      },
      next
    );
  };
}
