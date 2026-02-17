import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TokenBucket } from '../../src/infrastructure/tmdbThrottle.ts';

describe('TokenBucket', () => {
  let bucket: TokenBucket;

  afterEach(() => {
    bucket?.destroy();
  });

  it('grants tokens immediately when available', async () => {
    bucket = new TokenBucket({ maxTokens: 5, refillRate: 5 });
    await bucket.acquire();
    expect(bucket.getStats().immediateGrants).toBe(1);
  });

  it('tracks total requests', async () => {
    bucket = new TokenBucket({ maxTokens: 3, refillRate: 3 });
    await bucket.acquire();
    await bucket.acquire();
    expect(bucket.getStats().totalRequests).toBe(2);
  });

  it('queues requests when tokens exhausted', async () => {
    bucket = new TokenBucket({ maxTokens: 1, refillRate: 100 });
    await bucket.acquire(); // takes the only token

    // This should queue and then resolve after refill
    const start = Date.now();
    await bucket.acquire(2000);
    expect(bucket.getStats().queuedRequests).toBe(1);
  });

  it('rejects when queue is full', async () => {
    bucket = new TokenBucket({ maxTokens: 1, refillRate: 0, maxQueueSize: 1 });
    await bucket.acquire(); // drain the only token

    // Fill the queue
    const p1 = bucket.acquire(5000).catch(() => {});

    // This should reject immediately
    await expect(bucket.acquire(1000)).rejects.toThrow('queue full');
    expect(bucket.getStats().rejectedRequests).toBe(1);

    bucket.destroy(); // cleanup p1
  });

  it('destroy rejects all queued requests', async () => {
    bucket = new TokenBucket({ maxTokens: 1, refillRate: 0 });
    await bucket.acquire(); // drain the only token
    const p = bucket.acquire(5000);
    bucket.destroy();
    await expect(p).rejects.toThrow('shutting down');
  });

  it('getStats returns expected shape', () => {
    bucket = new TokenBucket({ maxTokens: 10, refillRate: 10 });
    const stats = bucket.getStats();
    expect(stats).toHaveProperty('totalRequests');
    expect(stats).toHaveProperty('immediateGrants');
    expect(stats).toHaveProperty('queuedRequests');
    expect(stats).toHaveProperty('rejectedRequests');
    expect(stats).toHaveProperty('currentTokens');
    expect(stats).toHaveProperty('queueDepth');
    expect(stats).toHaveProperty('avgWaitMs');
  });

  it('refills tokens over time', async () => {
    bucket = new TokenBucket({ maxTokens: 2, refillRate: 100 });

    // Drain all tokens
    await bucket.acquire();
    await bucket.acquire();

    // Wait for refill
    await new Promise((r) => setTimeout(r, 150));

    // Should be able to acquire again
    await bucket.acquire();
    expect(bucket.getStats().totalRequests).toBe(3);
  });
});
