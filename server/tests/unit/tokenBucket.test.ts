import { describe, it, expect, afterEach } from 'vitest';
import { TokenBucket } from '../../src/infrastructure/tmdbThrottle.ts';

describe('TokenBucket', () => {
  let bucket: InstanceType<typeof TokenBucket>;

  afterEach(() => {
    bucket?.destroy();
  });

  it('grants tokens within rate limit', async () => {
    bucket = new TokenBucket({ maxTokens: 5, refillRate: 5 });
    bucket.endGracePeriod();
    for (let i = 0; i < 5; i++) {
      await bucket.acquire();
    }
    expect(bucket.stats.immediateGrants).toBe(5);
    expect(bucket.stats.totalRequests).toBe(5);
  });

  it('queues requests when depleted', async () => {
    bucket = new TokenBucket({ maxTokens: 1, refillRate: 100 });
    await bucket.acquire();

    const p = bucket.acquire(5000);
    expect(bucket.queue.length).toBe(1);

    await p;
    expect(bucket.stats.queuedRequests).toBe(1);
  });

  it('rejects when queue is full', async () => {
    bucket = new TokenBucket({ maxTokens: 0, refillRate: 0, maxQueueSize: 2 });
    bucket.tokens = 0;

    const promises: Promise<void>[] = [];
    promises.push(bucket.acquire(60000));
    promises.push(bucket.acquire(60000));

    await expect(bucket.acquire(1000)).rejects.toThrow('queue full');
    expect(bucket.stats.rejectedRequests).toBe(1);

    bucket.destroy();
    await Promise.allSettled(promises);
  });

  it('rejects on timeout', async () => {
    bucket = new TokenBucket({ maxTokens: 0, refillRate: 0 });
    bucket.tokens = 0;

    await expect(bucket.acquire(50)).rejects.toThrow('timeout');
  });

  it('drains queue on shutdown', async () => {
    bucket = new TokenBucket({ maxTokens: 0, refillRate: 0 });
    bucket.tokens = 0;

    const promises = [bucket.acquire(60000), bucket.acquire(60000)];
    expect(bucket.queue.length).toBe(2);

    bucket.destroy();

    const results = await Promise.allSettled(promises);
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    expect(bucket.queue.length).toBe(0);
  });

  it('reports accurate stats', async () => {
    bucket = new TokenBucket({ maxTokens: 3, refillRate: 100 });
    bucket.endGracePeriod();
    await bucket.acquire();
    await bucket.acquire();
    await bucket.acquire();

    const stats = bucket.getStats();
    expect(stats.totalRequests).toBe(3);
    expect(stats.immediateGrants).toBe(3);
    expect(stats.queuedRequests).toBe(0);
    expect(stats.rejectedRequests).toBe(0);
    expect(stats.currentTokens).toBe(0);
    expect(stats.queueDepth).toBe(0);
    expect(stats.globalPauses).toBe(0);
  });
});
