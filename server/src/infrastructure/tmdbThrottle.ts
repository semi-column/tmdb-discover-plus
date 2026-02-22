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
  maxTokens: number;
  refillRate: number;
  maxQueueSize: number;
  tokens: number;
  lastRefill: number;
  queue: Array<{
    resolve: () => void;
    reject: (reason?: unknown) => void;
    timer: ReturnType<typeof setTimeout>;
    queuedAt: number;
  }>;
  stats: {
    totalRequests: number;
    immediateGrants: number;
    queuedRequests: number;
    rejectedRequests: number;
    totalWaitMs: number;
    globalPauses: number;
  };
  private _refillInterval: ReturnType<typeof setInterval>;
  private _pausedUntil: number;
  private _graceMode: boolean;

  constructor(options: { maxTokens?: number; refillRate?: number; maxQueueSize?: number } = {}) {
    this.maxTokens = options.maxTokens || 35;
    this.refillRate = options.refillRate || 35;
    this.maxQueueSize = options.maxQueueSize || 500;

    this.tokens = this.maxTokens;
    this.lastRefill = Date.now();
    this._pausedUntil = 0;
    this._graceMode = true;

    this.queue = [];

    this.stats = {
      totalRequests: 0,
      immediateGrants: 0,
      queuedRequests: 0,
      rejectedRequests: 0,
      totalWaitMs: 0,
      globalPauses: 0,
    };

    this._refillInterval = setInterval(() => this._refill(), 100);
    this._refillInterval.unref();
  }

  _refill() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.lastRefill = now;

    if (now < this._pausedUntil) return;

    const rate = this._graceMode ? Math.ceil(this.refillRate / 2) : this.refillRate;
    const max = this._graceMode ? Math.ceil(this.maxTokens / 2) : this.maxTokens;
    this.tokens = Math.min(max, this.tokens + elapsed * rate);

    while (this.queue.length > 0 && this.tokens >= 1) {
      const item = this.queue.shift()!;
      clearTimeout(item.timer);
      this.tokens -= 1;
      const waitMs = Date.now() - item.queuedAt;
      this.stats.totalWaitMs += waitMs;
      item.resolve();
    }
  }

  notifyRateLimited(retryAfterMs: number): void {
    const pauseMs = Math.min(Math.max(retryAfterMs, 1000), 10000);
    this._pausedUntil = Date.now() + pauseMs;
    this.tokens = 0;
    this.stats.globalPauses++;
    log.warn('Global TMDB pause activated', { pauseMs, queueDepth: this.queue.length });
  }

  endGracePeriod(): void {
    if (!this._graceMode) return;
    this._graceMode = false;
    log.info('TMDB throttle grace period ended, full rate restored');
  }

  async acquire(timeoutMs: number = 10000): Promise<void> {
    this.stats.totalRequests++;

    const now = Date.now();
    if (now < this._pausedUntil) {
      const remaining = this._pausedUntil - now;
      this.stats.queuedRequests++;
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          const idx = this.queue.findIndex((item) => item.resolve === resolve);
          if (idx !== -1) this.queue.splice(idx, 1);
          reject(new Error('TMDB rate limiter timeout — waited too long for token'));
        }, timeoutMs);

        setTimeout(() => {
          this._refill();
        }, remaining);

        this.queue.push({ resolve, reject, timer, queuedAt: now });
      });
    }

    this._refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      this.stats.immediateGrants++;
      return;
    }

    if (this.queue.length >= this.maxQueueSize) {
      this.stats.rejectedRequests++;
      throw new Error('TMDB rate limiter queue full — too many concurrent requests');
    }

    this.stats.queuedRequests++;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.queue.findIndex((item) => item.resolve === resolve);
        if (idx !== -1) this.queue.splice(idx, 1);
        reject(new Error('TMDB rate limiter timeout — waited too long for token'));
      }, timeoutMs);

      this.queue.push({ resolve, reject, timer, queuedAt: Date.now() });
    });
  }

  getStats(): Record<string, unknown> {
    const avgWait =
      this.stats.queuedRequests > 0
        ? Math.round(this.stats.totalWaitMs / this.stats.queuedRequests)
        : 0;
    return {
      ...this.stats,
      currentTokens: Math.floor(this.tokens),
      queueDepth: this.queue.length,
      avgWaitMs: avgWait,
      graceMode: this._graceMode,
      pausedUntil: this._pausedUntil > Date.now() ? this._pausedUntil - Date.now() : 0,
    };
  }

  destroy(): void {
    clearInterval(this._refillInterval);
    for (const { reject, timer } of this.queue) {
      clearTimeout(timer);
      reject(new Error('Rate limiter shutting down'));
    }
    this.queue = [];
  }
}

// Singleton
let instance: TokenBucket | null = null;

export { TokenBucket };

export function getTmdbThrottle(): TokenBucket {
  if (!instance) {
    const maxTokens = config.tmdb.rateLimit;
    instance = new TokenBucket({ maxTokens, refillRate: maxTokens });
    log.info('TMDB outbound throttle initialized', { maxTokens });
  }
  return instance;
}

export function destroyTmdbThrottle(): void {
  if (instance) {
    instance.destroy();
    instance = null;
  }
}
