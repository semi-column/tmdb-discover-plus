import { describe, it, expect } from 'vitest';
import { requestIdMiddleware, getRequestId } from '../../src/utils/requestContext.ts';

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
});
