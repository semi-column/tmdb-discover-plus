import { createLogger } from '../utils/logger.ts';
import { config } from '../config.ts';

const log = createLogger('TmdbThrottle');

/**
 * Token bucket rate limiter for outbound TMDB API calls.
 * Prevents burning through TMDB's ~40 req/s rate limit when many users
 * are active simultaneously.
 *
 */
class TokenBucket {
  /**
   * @param {object} options
   * @param {number} [options.maxTokens=35] - Max tokens (burst capacity)
   * @param {number} [options.refillRate=35] - Tokens refilled per second
   * @param {number} [options.maxQueueSize=500] - Max queued requests before rejecting
   */
  constructor(options = {}) {
    this.maxTokens = options.maxTokens || 35;
    this.refillRate = options.refillRate || 35;
    this.maxQueueSize = options.maxQueueSize || 500;

    this.tokens = this.maxTokens;
    this.lastRefill = Date.now();

    /** @type {Array<{resolve: Function, reject: Function, timer: NodeJS.Timeout}>} */
    this.queue = [];

    this.stats = {
      totalRequests: 0,
      immediateGrants: 0,
      queuedRequests: 0,
      rejectedRequests: 0,
      totalWaitMs: 0,
    };

    // Refill tokens periodically
    this._refillInterval = setInterval(() => this._refill(), 100);
  }

  /** @private */
  _refill() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.lastRefill = now;

    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);

    // Process queued requests
    while (this.queue.length > 0 && this.tokens >= 1) {
      const { resolve, timer, queuedAt } = this.queue.shift();
      clearTimeout(timer);
      this.tokens -= 1;
      const waitMs = Date.now() - queuedAt;
      this.stats.totalWaitMs += waitMs;
      resolve();
    }
  }

  /**
   * Acquire a token. Resolves when a token is available.
   * Rejects if the queue is full.
   *
   * @param {number} [timeoutMs=10000] - Max wait time before rejecting
   * @returns {Promise<void>}
   */
  async acquire(timeoutMs = 10000) {
    this.stats.totalRequests++;

    // Refill based on elapsed time
    this._refill();

    // Fast path: token available immediately
    if (this.tokens >= 1) {
      this.tokens -= 1;
      this.stats.immediateGrants++;
      return;
    }

    // Queue is full — reject
    if (this.queue.length >= this.maxQueueSize) {
      this.stats.rejectedRequests++;
      throw new Error('TMDB rate limiter queue full — too many concurrent requests');
    }

    // Queue the request
    this.stats.queuedRequests++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // Remove from queue on timeout
        const idx = this.queue.findIndex((item) => item.resolve === resolve);
        if (idx !== -1) this.queue.splice(idx, 1);
        reject(new Error('TMDB rate limiter timeout — waited too long for token'));
      }, timeoutMs);

      this.queue.push({ resolve, reject, timer, queuedAt: Date.now() });
    });
  }

  /**
   * Get stats for the /health endpoint.
   */
  getStats() {
    const avgWait =
      this.stats.queuedRequests > 0
        ? Math.round(this.stats.totalWaitMs / this.stats.queuedRequests)
        : 0;
    return {
      ...this.stats,
      currentTokens: Math.floor(this.tokens),
      queueDepth: this.queue.length,
      avgWaitMs: avgWait,
    };
  }

  /**
   * Cleanup interval on shutdown.
   */
  destroy() {
    clearInterval(this._refillInterval);
    // Reject all queued requests
    for (const { reject, timer } of this.queue) {
      clearTimeout(timer);
      reject(new Error('Rate limiter shutting down'));
    }
    this.queue = [];
  }
}

// Singleton
let instance = null;

export { TokenBucket };

export function getTmdbThrottle() {
  if (!instance) {
    const maxTokens = config.tmdb.rateLimit;
    instance = new TokenBucket({ maxTokens, refillRate: maxTokens });
    log.info('TMDB outbound throttle initialized', { maxTokens });
  }
  return instance;
}

export function destroyTmdbThrottle() {
  if (instance) {
    instance.destroy();
    instance = null;
  }
}
