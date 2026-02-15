import { createLogger } from '../utils/logger.ts';
import { config } from '../config.ts';
import { getImdbQuotaStats } from './imdbQuota.ts';
import { getImdbCircuitBreakerState } from '../services/imdb/client.ts';
import { isImdbApiEnabled } from '../services/imdb/index.ts';

const log = createLogger('Metrics');

/**
 * Lightweight request & provider metrics tracker.
 *
 * Tracks:
 * - Per-endpoint request counts and latency
 * - Per-provider API call counts and latency
 * - Error counts by type
 * - Active user tracking (unique userIds in last hour)
 *
 * All in-memory — no Redis dependency. Optionally disabled via DISABLE_METRICS=true.
 */
class MetricsTracker {
  constructor() {
    this.disabled = config.features.disableMetrics;

    /** @type {Map<string, {count: number, totalMs: number, errors: number, lastMs: number}>} */
    this.endpoints = new Map();

    /** @type {Map<string, {count: number, totalMs: number, errors: number, lastMs: number}>} */
    this.providers = new Map();

    /** @type {Map<string, number>} errorType → count */
    this.errorCounts = new Map();

    /** @type {Map<string, number>} userId → last seen timestamp */
    this.activeUsers = new Map();

    this.startTime = Date.now();
    this.totalRequests = 0;

    this._cacheStatsProvider = null;

    // Cleanup stale active users every 10 minutes
    this._cleanupInterval = setInterval(() => this._cleanupActiveUsers(), 10 * 60 * 1000);
  }

  /**
   * Express middleware to track request metrics.
   */
  middleware() {
    return (req, res, next) => {
      if (this.disabled) return next();

      const start = Date.now();
      this.totalRequests++;

      // Track active user from URL path (/:userId/...)
      const userId = req.params?.userId;
      if (userId) {
        this.activeUsers.set(userId, Date.now());
      }

      // Track on response finish — wrapped in try-catch so metrics never crash the server
      const onFinish = () => {
        res.removeListener('finish', onFinish);
        try {
          const duration = Date.now() - start;
          const route = this._normalizeRoute(req);
          this._recordEndpoint(route, duration, res.statusCode >= 400);
        } catch {
          /* metrics are non-critical — never crash the process */
        }
      };

      res.on('finish', onFinish);
      next();
    };
  }

  /**
   * Track an outbound API call to a provider.
   * @param {string} provider - Provider name (e.g., 'tmdb', 'cinemeta', 'rpdb')
   * @param {number} durationMs - Call duration in milliseconds
   * @param {boolean} [isError=false] - Whether the call failed
   */
  trackProviderCall(provider, durationMs, isError = false) {
    if (this.disabled) return;

    const existing = this.providers.get(provider) || { count: 0, totalMs: 0, errors: 0, lastMs: 0 };
    existing.count++;
    existing.totalMs += durationMs;
    existing.lastMs = durationMs;
    if (isError) existing.errors++;
    this.providers.set(provider, existing);
  }

  /**
   * Track an error by type.
   * @param {string} errorType - e.g., 'RATE_LIMITED', 'NOT_FOUND', 'TEMPORARY_ERROR'
   */
  trackError(errorType) {
    if (this.disabled) return;
    if (this.errorCounts.size >= 500 && !this.errorCounts.has(errorType)) {
      return;
    }
    const count = this.errorCounts.get(errorType) || 0;
    this.errorCounts.set(errorType, count + 1);
  }

  /**
   * Get a summary for the /health endpoint.
   */
  getSummary() {
    if (this.disabled) return { disabled: true };

    const uptimeMs = Date.now() - this.startTime;
    const hourAgo = Date.now() - 60 * 60 * 1000;

    // Count active users in last hour
    let activeUserCount = 0;
    for (const ts of this.activeUsers.values()) {
      if (ts > hourAgo) activeUserCount++;
    }

    const endpointSummary = {};
    for (const [route, stats] of this.endpoints) {
      endpointSummary[route] = {
        count: stats.count,
        avgMs: stats.count > 0 ? Math.round(stats.totalMs / stats.count) : 0,
        errors: stats.errors,
      };
    }

    const providerSummary = {};
    for (const [name, stats] of this.providers) {
      providerSummary[name] = {
        count: stats.count,
        avgMs: stats.count > 0 ? Math.round(stats.totalMs / stats.count) : 0,
        errors: stats.errors,
        lastMs: stats.lastMs,
      };
    }

    return {
      uptime: Math.round(uptimeMs / 1000),
      totalRequests: this.totalRequests,
      activeUsersLastHour: activeUserCount,
      endpoints: endpointSummary,
      providers: providerSummary,
      errors: Object.fromEntries(this.errorCounts),
    };
  }

  /** @private */
  _normalizeRoute(req) {
    // Normalize /:userId/ to /:userId/ without revealing actual ID
    const raw = req.route?.path || req.path || req.url || '/unknown';
    const path = typeof raw === 'string' ? raw : String(raw);
    return path
      .replace(/\/[a-zA-Z0-9_-]{6,30}\//g, '/:userId/')
      .replace(/\/tt\d+/g, '/:imdbId')
      .replace(/\/tmdb:\d+/g, '/:tmdbId')
      .replace(/\?.*/g, '');
  }

  /** @private */
  _recordEndpoint(route, durationMs, isError) {
    if (this.endpoints.size >= 500 && !this.endpoints.has(route)) {
      return;
    }
    const existing = this.endpoints.get(route) || { count: 0, totalMs: 0, errors: 0, lastMs: 0 };
    existing.count++;
    existing.totalMs += durationMs;
    existing.lastMs = durationMs;
    if (isError) existing.errors++;
    this.endpoints.set(route, existing);
  }

  /** @private */
  _cleanupActiveUsers() {
    const hourAgo = Date.now() - 60 * 60 * 1000;
    for (const [userId, ts] of this.activeUsers) {
      if (ts < hourAgo) this.activeUsers.delete(userId);
    }
  }

  setCacheStatsProvider(fn) {
    this._cacheStatsProvider = fn;
  }

  destroy() {
    clearInterval(this._cleanupInterval);
  }

  toPrometheus() {
    if (this.disabled) return '# Metrics disabled\n';

    const lines = [];
    const uptimeMs = Date.now() - this.startTime;
    const hourAgo = Date.now() - 60 * 60 * 1000;

    let activeUserCount = 0;
    for (const ts of this.activeUsers.values()) {
      if (ts > hourAgo) activeUserCount++;
    }

    lines.push('# HELP tmdb_uptime_seconds Server uptime in seconds');
    lines.push('# TYPE tmdb_uptime_seconds gauge');
    lines.push(`tmdb_uptime_seconds ${Math.round(uptimeMs / 1000)}`);

    lines.push('# HELP tmdb_requests_total Total number of requests');
    lines.push('# TYPE tmdb_requests_total counter');
    lines.push(`tmdb_requests_total ${this.totalRequests}`);

    lines.push('# HELP tmdb_active_users Active users in the last hour');
    lines.push('# TYPE tmdb_active_users gauge');
    lines.push(`tmdb_active_users ${activeUserCount}`);

    lines.push('# HELP tmdb_endpoint_requests_total Requests per endpoint');
    lines.push('# TYPE tmdb_endpoint_requests_total counter');
    lines.push('# HELP tmdb_endpoint_duration_avg_ms Average request duration per endpoint');
    lines.push('# TYPE tmdb_endpoint_duration_avg_ms gauge');
    lines.push('# HELP tmdb_endpoint_errors_total Errors per endpoint');
    lines.push('# TYPE tmdb_endpoint_errors_total counter');
    for (const [route, stats] of this.endpoints) {
      const label = `route="${route}"`;
      lines.push(`tmdb_endpoint_requests_total{${label}} ${stats.count}`);
      lines.push(
        `tmdb_endpoint_duration_avg_ms{${label}} ${stats.count > 0 ? Math.round(stats.totalMs / stats.count) : 0}`
      );
      lines.push(`tmdb_endpoint_errors_total{${label}} ${stats.errors}`);
    }

    lines.push('# HELP tmdb_provider_requests_total API calls per provider');
    lines.push('# TYPE tmdb_provider_requests_total counter');
    lines.push('# HELP tmdb_provider_duration_avg_ms Average call duration per provider');
    lines.push('# TYPE tmdb_provider_duration_avg_ms gauge');
    lines.push('# HELP tmdb_provider_errors_total Errors per provider');
    lines.push('# TYPE tmdb_provider_errors_total counter');
    for (const [name, stats] of this.providers) {
      const label = `provider="${name}"`;
      lines.push(`tmdb_provider_requests_total{${label}} ${stats.count}`);
      lines.push(
        `tmdb_provider_duration_avg_ms{${label}} ${stats.count > 0 ? Math.round(stats.totalMs / stats.count) : 0}`
      );
      lines.push(`tmdb_provider_errors_total{${label}} ${stats.errors}`);
    }

    lines.push('# HELP tmdb_errors_total Errors by type');
    lines.push('# TYPE tmdb_errors_total counter');
    for (const [errorType, count] of this.errorCounts) {
      lines.push(`tmdb_errors_total{type="${errorType}"} ${count}`);
    }

    if (this._cacheStatsProvider) {
      const cs = this._cacheStatsProvider();
      if (cs?.adapter) {
        if (typeof cs.adapter.keys === 'number') {
          lines.push('# HELP tmdb_cache_keys Current number of cached keys');
          lines.push('# TYPE tmdb_cache_keys gauge');
          lines.push(`tmdb_cache_keys ${cs.adapter.keys}`);
        }
        if (typeof cs.adapter.maxKeys === 'number') {
          lines.push('# HELP tmdb_cache_max_keys Maximum cache capacity');
          lines.push('# TYPE tmdb_cache_max_keys gauge');
          lines.push(`tmdb_cache_max_keys ${cs.adapter.maxKeys}`);
        }
        if (typeof cs.adapter.evictions === 'number') {
          lines.push('# HELP tmdb_cache_evictions_total Total cache evictions');
          lines.push('# TYPE tmdb_cache_evictions_total counter');
          lines.push(`tmdb_cache_evictions_total ${cs.adapter.evictions}`);
        }
      }
      if (typeof cs.hits === 'number') {
        lines.push('# HELP tmdb_cache_hits_total Cache wrapper hits');
        lines.push('# TYPE tmdb_cache_hits_total counter');
        lines.push(`tmdb_cache_hits_total ${cs.hits}`);
      }
      if (typeof cs.misses === 'number') {
        lines.push('# HELP tmdb_cache_misses_total Cache wrapper misses');
        lines.push('# TYPE tmdb_cache_misses_total counter');
        lines.push(`tmdb_cache_misses_total ${cs.misses}`);
      }
      if (typeof cs.hits === 'number' && typeof cs.misses === 'number') {
        const total = cs.hits + cs.misses;
        const ratio = total > 0 ? cs.hits / total : 0;
        lines.push('# HELP tmdb_cache_hit_ratio Cache hit ratio (0-1)');
        lines.push('# TYPE tmdb_cache_hit_ratio gauge');
        lines.push(`tmdb_cache_hit_ratio ${ratio.toFixed(4)}`);
      }
      if (
        cs?.adapter &&
        typeof cs.adapter.keys === 'number' &&
        typeof cs.adapter.maxKeys === 'number' &&
        cs.adapter.maxKeys > 0
      ) {
        const pct = (cs.adapter.keys / cs.adapter.maxKeys) * 100;
        lines.push('# HELP tmdb_cache_capacity_percent Cache usage as percentage of max capacity');
        lines.push('# TYPE tmdb_cache_capacity_percent gauge');
        lines.push(`tmdb_cache_capacity_percent ${pct.toFixed(2)}`);
      }
      if (typeof cs.staleServed === 'number') {
        lines.push('# HELP tmdb_cache_stale_served_total Stale cache entries served');
        lines.push('# TYPE tmdb_cache_stale_served_total counter');
        lines.push(`tmdb_cache_stale_served_total ${cs.staleServed}`);
      }
      if (typeof cs.cachedErrors === 'number') {
        lines.push('# HELP tmdb_cache_cached_errors_total Cached error responses served');
        lines.push('# TYPE tmdb_cache_cached_errors_total counter');
        lines.push(`tmdb_cache_cached_errors_total ${cs.cachedErrors}`);
      }
    }

    if (isImdbApiEnabled()) {
      const iq = getImdbQuotaStats();
      const cb = getImdbCircuitBreakerState();

      lines.push('# HELP imdb_api_requests_today IMDb API requests today');
      lines.push('# TYPE imdb_api_requests_today gauge');
      lines.push(`imdb_api_requests_today ${iq.requestsToday}`);

      lines.push('# HELP imdb_api_requests_month IMDb API requests this month');
      lines.push('# TYPE imdb_api_requests_month gauge');
      lines.push(`imdb_api_requests_month ${iq.requestsThisMonth}`);

      lines.push('# HELP imdb_api_requests_total IMDb API requests total');
      lines.push('# TYPE imdb_api_requests_total counter');
      lines.push(`imdb_api_requests_total ${iq.requestsTotal}`);

      lines.push('# HELP imdb_api_budget_monthly IMDb API monthly budget');
      lines.push('# TYPE imdb_api_budget_monthly gauge');
      lines.push(`imdb_api_budget_monthly ${iq.budgetMonthly}`);

      lines.push('# HELP imdb_api_quota_exceeded Whether IMDb quota is exceeded');
      lines.push('# TYPE imdb_api_quota_exceeded gauge');
      lines.push(`imdb_api_quota_exceeded ${iq.quotaExceeded ? 1 : 0}`);

      lines.push('# HELP imdb_api_circuit_breaker_open Whether IMDb circuit breaker is open');
      lines.push('# TYPE imdb_api_circuit_breaker_open gauge');
      lines.push(`imdb_api_circuit_breaker_open ${cb.state === 'open' ? 1 : 0}`);

      lines.push('# HELP imdb_api_circuit_breaker_failures IMDb circuit breaker failure count');
      lines.push('# TYPE imdb_api_circuit_breaker_failures gauge');
      lines.push(`imdb_api_circuit_breaker_failures ${cb.recentFailures}`);

      lines.push('# HELP imdb_api_endpoint_requests IMDb requests per endpoint');
      lines.push('# TYPE imdb_api_endpoint_requests counter');
      for (const [ep, count] of Object.entries(iq.perEndpoint)) {
        lines.push(`imdb_api_endpoint_requests{endpoint="${ep}"} ${count}`);
      }
    }

    const mem = process.memoryUsage();
    lines.push('# HELP tmdb_memory_heap_used_bytes Heap memory used');
    lines.push('# TYPE tmdb_memory_heap_used_bytes gauge');
    lines.push(`tmdb_memory_heap_used_bytes ${mem.heapUsed}`);
    lines.push('# HELP tmdb_memory_heap_total_bytes Heap memory total');
    lines.push('# TYPE tmdb_memory_heap_total_bytes gauge');
    lines.push(`tmdb_memory_heap_total_bytes ${mem.heapTotal}`);

    return lines.join('\n') + '\n';
  }
}

// Singleton
let instance = null;

export function getMetrics() {
  if (!instance) {
    instance = new MetricsTracker();
  }
  return instance;
}

export function destroyMetrics() {
  if (instance) {
    instance.destroy();
    instance = null;
  }
}
