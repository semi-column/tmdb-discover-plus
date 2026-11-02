import { afterEach, describe, expect, it, vi } from 'vitest';
import { findIncidents, startHealthMonitor } from '../../src/services/observability/health.ts';
import { MemoryLiveStore } from '../../src/services/observability/liveStore.ts';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('observability health', () => {
  it('merges adjacent threshold breaches but excludes quiet and below-threshold buckets', () => {
    const incidents = findIncidents(
      {
        t: [60, 120, 180, 240],
        requests: [100, 100, 10, 100],
        errors5xx: [2, 3, 5, 1],
        errors4xx: [25, 30, 0, 0],
        slow: [0, 0, 0, 20],
      },
      60_000
    );
    expect(incidents).toHaveLength(3);
    expect(incidents.find((i) => i.kind === 'errors5xx')).toMatchObject({
      from: 60_000,
      to: 180_000,
      affected: 5,
      requests: 200,
    });
    expect(incidents.find((i) => i.kind === 'errors4xx')?.affected).toBe(55);
  });

  it('deduplicates across monitors and retries failed webhook delivery', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T10:00:00Z'));
    const live = new MemoryLiveStore();
    const minute = Math.floor(Date.now() / 60_000);
    await live.apply(
      {
        minutes: new Map([
          [
            minute,
            new Map([
              ['req', 100],
              ['sc:4xx', 25],
            ]),
          ],
        ]),
        hours: new Map(),
        users: new Map(),
        tail: [],
      },
      3600
    );
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    const stop = startHealthMonitor(live, 'https://alerts.example.test/hook');
    try {
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fetch).toHaveBeenCalledTimes(2);
      const stopPeer = startHealthMonitor(live, 'https://alerts.example.test/hook');
      try {
        await vi.advanceTimersByTimeAsync(60_000);
        expect(fetch).toHaveBeenCalledTimes(2);
      } finally {
        stopPeer();
      }
      const payload = JSON.parse(fetch.mock.calls[1][1].body);
      expect(payload.incidents[0].kind).toBe('errors4xx');
      expect(payload).not.toHaveProperty('paths');
    } finally {
      stop();
    }
  });

  it('rejects unsafe webhook transport rather than silently disabling delivery', () => {
    expect(() => startHealthMonitor(new MemoryLiveStore(), 'http://example.test')).toThrow('HTTPS');
  });
});
