import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/services/cache/index.ts', () => ({
  getCache: vi.fn(() => ({
    getEntry: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    setError: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
  })),
}));

vi.mock('../../src/infrastructure/tmdbThrottle.ts', () => ({
  getTmdbThrottle: vi.fn(() => ({
    acquire: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../src/infrastructure/metrics.ts', () => ({
  getMetrics: vi.fn(() => ({
    trackProviderCall: vi.fn(),
    trackError: vi.fn(),
  })),
}));

vi.mock('node-fetch', () => ({
  default: vi.fn(),
}));

import fetch from 'node-fetch';
import {
  tmdbFetch,
  getCircuitBreakerState,
  resetCircuitBreaker,
} from '../../src/services/tmdb/client.ts';

const mockFetch = vi.mocked(fetch);

describe('TMDB Circuit Breaker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCircuitBreaker();
  });

  it('starts in closed state', () => {
    expect(getCircuitBreakerState().state).toBe('closed');
  });

  it('opens after threshold failures', async () => {
    mockFetch.mockRejectedValue(Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' }));

    for (let i = 0; i < 10; i++) {
      try {
        await tmdbFetch('/movie/popular', 'test-key', {}, 0);
      } catch {
        // expected
      }
    }

    const state = getCircuitBreakerState();
    expect(state.state).toBe('open');
    expect(state.recentFailures).toBeGreaterThanOrEqual(10);
  });

  it('throws immediately when circuit is open', async () => {
    mockFetch.mockRejectedValue(Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' }));

    for (let i = 0; i < 10; i++) {
      try {
        await tmdbFetch('/movie/popular', 'k', {}, 0);
      } catch {
        // expected
      }
    }

    expect(getCircuitBreakerState().state).toBe('open');
    mockFetch.mockClear();

    await expect(tmdbFetch('/movie/popular', 'test-key', {}, 0)).rejects.toThrow(
      'circuit breaker is open'
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not trip on 404 errors', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ status_message: 'Not Found' }),
    } as any);

    for (let i = 0; i < 12; i++) {
      try {
        await tmdbFetch('/movie/missing', 'test-key', {}, 0);
      } catch {
        // expected
      }
    }

    expect(getCircuitBreakerState().state).toBe('closed');
  });

  it('does not trip on 400 errors', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ status_message: 'Bad Request' }),
    } as any);

    for (let i = 0; i < 12; i++) {
      try {
        await tmdbFetch('/bad', 'test-key', {}, 0);
      } catch {
        // expected
      }
    }

    expect(getCircuitBreakerState().state).toBe('closed');
  });

  it('trips on 500 errors', async () => {
    mockFetch.mockRejectedValue(new Error('TMDB API retryable error: 500'));

    for (let i = 0; i < 10; i++) {
      try {
        await tmdbFetch('/movie/popular', 'test-key', {}, 0);
      } catch {
        // expected
      }
    }

    expect(getCircuitBreakerState().state).toBe('open');
  });

  it('resets after successful request', async () => {
    mockFetch.mockRejectedValue(Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' }));

    for (let i = 0; i < 5; i++) {
      try {
        await tmdbFetch('/fail', 'k', {}, 0);
      } catch {
        // expected
      }
    }

    expect(getCircuitBreakerState().recentFailures).toBeGreaterThan(0);

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ id: 1 }] }),
    } as any);

    await tmdbFetch('/movie/popular', 'test-key', {}, 0);

    const state = getCircuitBreakerState();
    expect(state.state).toBe('closed');
    expect(state.recentFailures).toBe(0);
  });
});
