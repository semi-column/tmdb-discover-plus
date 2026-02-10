import { createLogger } from '../utils/logger.js';

const log = createLogger('Metrics');

/**
 * Lightweight request & provider metrics tracker.
 * Inspired by AIOMetadata's requestTracker.js and timing-metrics.js.
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
    this.disabled = process.env.DISABLE_METRICS === 'true';

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

  destroy() {
    clearInterval(this._cleanupInterval);
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
