import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getMetrics, destroyMetrics } from '../../src/infrastructure/metrics.ts';

describe('MetricsTracker', () => {
  beforeEach(() => {
    destroyMetrics();
  });

  afterEach(() => {
    destroyMetrics();
  });

  it('getSummary returns expected shape', () => {
    const metrics = getMetrics();
    const summary = metrics.getSummary();
    expect(summary).toHaveProperty('uptime');
    expect(summary).toHaveProperty('totalRequests');
    expect(summary).toHaveProperty('activeUsersLastHour');
    expect(summary).toHaveProperty('endpoints');
    expect(summary).toHaveProperty('providers');
    expect(summary).toHaveProperty('errors');
  });

  it('trackProviderCall records stats', () => {
    const metrics = getMetrics();
    metrics.trackProviderCall('tmdb', 150);
    metrics.trackProviderCall('tmdb', 200, true);

    const summary = metrics.getSummary() as Record<string, unknown>;
    const providers = summary.providers as Record<string, { count: number; errors: number }>;
    expect(providers.tmdb.count).toBe(2);
    expect(providers.tmdb.errors).toBe(1);
  });

  it('trackError records error counts', () => {
    const metrics = getMetrics();
    metrics.trackError('RATE_LIMITED');
    metrics.trackError('RATE_LIMITED');
    metrics.trackError('NOT_FOUND');

    const summary = metrics.getSummary() as Record<string, unknown>;
    const errors = summary.errors as Record<string, number>;
    expect(errors['RATE_LIMITED']).toBe(2);
    expect(errors['NOT_FOUND']).toBe(1);
  });

  it('toPrometheus returns valid format', () => {
    const metrics = getMetrics();
    metrics.trackProviderCall('rpdb', 50);

    const prom = metrics.toPrometheus();
    expect(prom).toContain('# HELP');
    expect(prom).toContain('# TYPE');
    expect(prom).toContain('tmdb_uptime_seconds');
    expect(prom).toContain('tmdb_requests_total');
    expect(prom).toContain('tmdb_provider_requests_total{provider="rpdb"} 1');
  });

  it('setCacheStatsProvider integrates cache stats', () => {
    const metrics = getMetrics();
    metrics.setCacheStatsProvider(() => ({
      hits: 100,
      misses: 20,
      staleServed: 5,
      cachedErrors: 2,
      adapter: { keys: 50, maxKeys: 1000, evictions: 3 },
    }));

    const prom = metrics.toPrometheus();
    expect(prom).toContain('tmdb_cache_hits_total 100');
    expect(prom).toContain('tmdb_cache_misses_total 20');
    expect(prom).toContain('tmdb_cache_keys 50');
  });

  it('singleton pattern returns same instance', () => {
    const a = getMetrics();
    const b = getMetrics();
    expect(a).toBe(b);
  });

  it('destroyMetrics resets singleton', () => {
    const a = getMetrics();
    destroyMetrics();
    const b = getMetrics();
    expect(a).not.toBe(b);
  });
});
