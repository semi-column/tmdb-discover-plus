import { describe, it, expect } from 'vitest';
import {
  requestIdMiddleware,
  getRequestId,
  abortRequestContext,
  isRequestAborted,
  getRequestSignal,
  getRequestContextSnapshot,
  getRequestCacheStats,
  trackCacheOperation,
  withRequestAbortContext,
} from '../../src/utils/requestContext.ts';

describe('withRequestAbortContext', () => {
  it('creates an isolated cancellable context for background work', async () => {
    const reason = new Error('lease lost');
    await withRequestAbortContext(async () => {
      expect(getRequestSignal()).toBeDefined();
      expect(getRequestContextSnapshot()?.method).toBe('BACKGROUND');
      abortRequestContext(reason);
      expect(getRequestSignal()?.reason).toBe(reason);
    });
    expect(getRequestSignal()).toBeUndefined();
  });

  it('preserves the existing signal and accounting across nested work', async () => {
    await withRequestAbortContext(async () => {
      const signal = getRequestSignal();
      trackCacheOperation('hits');
      await withRequestAbortContext(async () => {
        expect(getRequestSignal()).toBe(signal);
        expect(getRequestCacheStats()?.hits).toBe(1);
      });
    });
  });
});

describe('requestIdMiddleware', () => {
  const middleware = requestIdMiddleware();

  it('generates a request ID and sets header', async () => {
    let headerId: string | undefined;
    const req = { headers: {} };
    const res = {
      setHeader: (_name: string, value: string) => {
        headerId = value;
      },
    };

    await new Promise<void>((resolve) => {
      middleware(req, res, () => {
        resolve();
      });
    });

    expect(headerId).toBeDefined();
    expect(typeof headerId).toBe('string');
    expect(headerId!.length).toBeGreaterThan(0);
  });

  it('reuses valid incoming X-Request-Id', async () => {
    let headerId: string | undefined;
    const req = { headers: { 'x-request-id': 'my-custom-id-123' } };
    const res = {
      setHeader: (_name: string, value: string) => {
        headerId = value;
      },
    };

    await new Promise<void>((resolve) => {
      middleware(req, res, () => {
        resolve();
      });
    });

    expect(headerId).toBe('my-custom-id-123');
  });

  it('rejects overly long request IDs', async () => {
    let headerId: string | undefined;
    const longId = 'a'.repeat(200);
    const req = { headers: { 'x-request-id': longId } };
    const res = {
      setHeader: (_name: string, value: string) => {
        headerId = value;
      },
    };

    await new Promise<void>((resolve) => {
      middleware(req, res, () => {
        resolve();
      });
    });

    expect(headerId).not.toBe(longId);
  });

  it('rejects request IDs with invalid characters', async () => {
    let headerId: string | undefined;
    const req = { headers: { 'x-request-id': '<script>alert(1)</script>' } };
    const res = {
      setHeader: (_name: string, value: string) => {
        headerId = value;
      },
    };

    await new Promise<void>((resolve) => {
      middleware(req, res, () => {
        resolve();
      });
    });

    expect(headerId).not.toContain('<');
  });
});

describe('getRequestId', () => {
  it('returns undefined outside of request context', () => {
    expect(getRequestId()).toBeUndefined();
    expect(isRequestAborted()).toBe(false);
  });

  it('returns the request ID inside middleware context', async () => {
    const middleware = requestIdMiddleware();
    let capturedId: string | undefined;
    const req = { headers: {} };
    const res = { setHeader: () => {} };

    await new Promise<void>((resolve) => {
      middleware(req, res, () => {
        capturedId = getRequestId();
        resolve();
      });
    });

    expect(capturedId).toBeDefined();
    expect(typeof capturedId).toBe('string');
  });

  it('marks the active request context as aborted', async () => {
    let aborted = false;
    const req = { headers: {} };
    const res = { setHeader: () => {} };

    await new Promise<void>((resolve) => {
      requestIdMiddleware()(req as any, res as any, () => {
        abortRequestContext();
        aborted = isRequestAborted();
        resolve();
      });
    });

    expect(aborted).toBe(true);
  });

  it('preserves a timeout reason separately from explicit cancellation', async () => {
    const reason = new DOMException('Request timed out', 'TimeoutError');
    await new Promise<void>((resolve) => {
      requestIdMiddleware()({ headers: {} } as any, { setHeader() {} } as any, () => {
        abortRequestContext(reason);
        expect(getRequestSignal()?.reason).toBe(reason);
        expect(isRequestAborted()).toBe(true);
        resolve();
      });
    });
  });

  it('captures request metadata in context snapshot', async () => {
    const middleware = requestIdMiddleware();
    let snapshot = getRequestContextSnapshot();
    const req = {
      headers: {},
      method: 'GET',
      originalUrl: '/api/catalog?foo=bar',
      url: '/api/catalog?foo=bar',
    };
    const res = { setHeader: () => {} };

    await new Promise<void>((resolve) => {
      middleware(req as any, res as any, () => {
        snapshot = getRequestContextSnapshot();
        resolve();
      });
    });

    expect(snapshot).toBeDefined();
    expect(snapshot?.method).toBe('GET');
    expect(snapshot?.path).toBe('/api/catalog?foo=bar');
    expect(snapshot?.startedAt).toBeTypeOf('number');
    expect(snapshot?.cache).toEqual({
      hits: 0,
      misses: 0,
      writes: 0,
      deletes: 0,
      errors: 0,
    });
  });

  it('tracks cache operation counters in request scope', async () => {
    const middleware = requestIdMiddleware();
    let cacheStats = getRequestCacheStats();
    const req = {
      headers: {},
      method: 'GET',
      originalUrl: '/api/discover',
      url: '/api/discover',
    };
    const res = { setHeader: () => {} };

    await new Promise<void>((resolve) => {
      middleware(req as any, res as any, () => {
        trackCacheOperation('hits');
        trackCacheOperation('misses');
        trackCacheOperation('writes');
        trackCacheOperation('deletes');
        trackCacheOperation('errors');
        cacheStats = getRequestCacheStats();
        resolve();
      });
    });

    expect(cacheStats).toEqual({
      hits: 1,
      misses: 1,
      writes: 1,
      deletes: 1,
      errors: 1,
    });
  });

  it('does not track cache operation outside request context', () => {
    trackCacheOperation('hits');
    expect(getRequestCacheStats()).toBeUndefined();
  });
});
