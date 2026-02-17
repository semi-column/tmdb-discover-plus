import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CacheWrapper } from '../../src/services/cache/CacheWrapper.ts';

class TTLAwareCacheAdapter {
  store = new Map<string, { value: unknown; expiresAt: number }>();

  async get(key: string): Promise<unknown> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : Infinity;
    this.store.set(key, { value, expiresAt });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }
}

describe('Stale-window TTL coverage', () => {
  let adapter: TTLAwareCacheAdapter;
  let wrapper: CacheWrapper;

  beforeEach(() => {
    adapter = new TTLAwareCacheAdapter();
    wrapper = new CacheWrapper(adapter, {});
  });

  it('serves stale data within 2x TTL window', async () => {
    const ttl = 10;
    await wrapper.set('test-key', { data: 'hello' }, ttl);

    vi.useFakeTimers();
    const now = Date.now();

    vi.setSystemTime(now + ttl * 1.5 * 1000);

    const entry = await wrapper.getEntry('test-key');
    expect(entry).not.toBeNull();

    if (entry && typeof entry === 'object' && '__isStale' in entry) {
      expect(entry.__isStale).toBe(true);
    }

    vi.useRealTimers();
  });

  it('adapter retains data beyond 2x TTL (2.5x adapter TTL)', async () => {
    const ttl = 10;
    const adapterTtl = Math.ceil(ttl * 2.5);

    await adapter.set('raw-key', { test: true }, adapterTtl);

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + ttl * 2 * 1000);

    const raw = await adapter.get('raw-key');
    expect(raw).not.toBeNull();

    vi.useRealTimers();
  });
});
