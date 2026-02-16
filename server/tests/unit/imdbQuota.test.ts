import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordImdbApiCall,
  isQuotaExceeded,
  getImdbQuotaStats,
  resetImdbQuota,
  initImdbQuota,
} from '../../src/infrastructure/imdbQuota.ts';

describe('imdbQuota', () => {
  beforeEach(() => {
    resetImdbQuota();
  });

  it('starts with zero counts', () => {
    const stats = getImdbQuotaStats();
    expect(stats.requestsToday).toBe(0);
    expect(stats.requestsThisMonth).toBe(0);
    expect(stats.requestsTotal).toBe(0);
    expect(stats.quotaExceeded).toBe(false);
  });

  it('increments counts on recordImdbApiCall', () => {
    recordImdbApiCall('/v1/titles/search');
    recordImdbApiCall('/v1/titles/search');
    recordImdbApiCall('/v1/titles/details');

    const stats = getImdbQuotaStats();
    expect(stats.requestsToday).toBe(3);
    expect(stats.requestsThisMonth).toBe(3);
    expect(stats.requestsTotal).toBe(3);
  });

  it('tracks per-endpoint counts', () => {
    recordImdbApiCall('/v1/titles/search');
    recordImdbApiCall('/v1/titles/search');
    recordImdbApiCall('/v1/titles/details');

    const stats = getImdbQuotaStats();
    expect(stats.perEndpoint['/v1/titles/search']).toBe(2);
    expect(stats.perEndpoint['/v1/titles/details']).toBe(1);
  });

  it('reports budget usage percentage', () => {
    recordImdbApiCall('/test');
    const stats = getImdbQuotaStats();
    expect(stats.budgetMonthly).toBeGreaterThan(0);
    expect(stats.budgetUsedPercent).toMatch(/\d+\.\d+%/);
  });

  it('resets quota', () => {
    recordImdbApiCall('/test');
    recordImdbApiCall('/test');
    resetImdbQuota();

    const stats = getImdbQuotaStats();
    expect(stats.requestsToday).toBe(0);
    expect(stats.requestsThisMonth).toBe(0);
    expect(stats.requestsTotal).toBe(0);
    expect(Object.keys(stats.perEndpoint)).toHaveLength(0);
  });

  it('does not exceed quota with normal usage', () => {
    for (let i = 0; i < 10; i++) {
      recordImdbApiCall('/test');
    }
    expect(isQuotaExceeded()).toBe(false);
  });

  it('exports initImdbQuota for startup loading', () => {
    expect(typeof initImdbQuota).toBe('function');
  });
});
