import { createLogger } from '../utils/logger.ts';
import { config } from '../config.ts';
import {
  getRequestSignal,
  isOpportunisticWork,
  skipOpportunisticWork,
} from '../utils/requestContext.ts';
import {
  ADMISSION_PREFIX,
  AdmissionRedis,
  admissionDelay,
  admissionAwait,
  admissionAwaitCommand,
  getAdmissionRedis,
  closeAdmissionRedis,
  observeAdmissionMutation,
} from './sharedAdmission.ts';

const log = createLogger('TmdbThrottle');
export const RATE_LIMITER_TIMEOUT_CODE = 'RATE_LIMITER_TIMEOUT';

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
  private _warmupActive: boolean;

  constructor(options: { maxTokens?: number; refillRate?: number; maxQueueSize?: number } = {}) {
    this.maxTokens = options.maxTokens || 35;
    this.refillRate = options.refillRate || 35;
    this.maxQueueSize = options.maxQueueSize || 500;

    this.tokens = this.maxTokens;
    this.lastRefill = Date.now();
    this._pausedUntil = 0;
    this._warmupActive = true;

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

    const rate = this._warmupActive ? Math.ceil(this.refillRate / 2) : this.refillRate;
    const max = this._warmupActive ? Math.ceil(this.maxTokens / 2) : this.maxTokens;
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

  endWarmup(): void {
    if (!this._warmupActive) return;
    this._warmupActive = false;
    log.info('TMDB throttle warmup phase ended, full rate restored');
  }

  async acquire(timeoutMs: number = 10000, signal = getRequestSignal()): Promise<void> {
    signal?.throwIfAborted();
    this.stats.totalRequests++;
    this._refill();

    const opportunistic = isOpportunisticWork();
    const capacity = this._warmupActive ? Math.ceil(this.maxTokens / 2) : this.maxTokens;
    const required = opportunistic ? Math.min(2, capacity) : 1;
    if (
      Date.now() >= this._pausedUntil &&
      this.tokens >= required &&
      (!opportunistic || this.queue.length === 0)
    ) {
      this.tokens -= 1;
      this.stats.immediateGrants++;
      return;
    }

    if (opportunistic) {
      this.stats.rejectedRequests++;
      skipOpportunisticWork('provider budget is busy');
    }

    if (this.queue.length >= this.maxQueueSize) {
      this.stats.rejectedRequests++;
      throw new Error('TMDB rate limiter queue full — too many concurrent requests');
    }

    this.stats.queuedRequests++;
    return new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(item.timer);
        signal?.removeEventListener('abort', onAbort);
        const index = this.queue.indexOf(item);
        if (index !== -1) this.queue.splice(index, 1);
      };
      const onAbort = () => item.reject(signal?.reason);
      const item = {
        resolve: () => {
          cleanup();
          resolve();
        },
        reject: (reason?: unknown) => {
          cleanup();
          reject(reason);
        },
        queuedAt: Date.now(),
        timer: setTimeout(() => {
          item.reject(
            Object.assign(new Error('Rate limiter timeout — waited too long for token'), {
              code: RATE_LIMITER_TIMEOUT_CODE,
            })
          );
        }, timeoutMs),
      };
      this.queue.push(item);
      signal?.addEventListener('abort', onAbort, { once: true });
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
      warmupActive: this._warmupActive,
      pausedUntil: this._pausedUntil > Date.now() ? this._pausedUntil - Date.now() : 0,
    };
  }

  destroy(): void {
    clearInterval(this._refillInterval);
    for (const { reject, timer } of [...this.queue]) {
      clearTimeout(timer);
      reject(new Error('Rate limiter shutting down'));
    }
    this.queue = [];
  }
}

export const TMDB_BUDGET_SCRIPT = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + tonumber(t[2]) / 1000
local key = KEYS[1]
local state = redis.call('HMGET', key, 'tokens', 'last', 'pause', 'full')
local full = state[4] == '1'
local capacity = tonumber(ARGV[2])
local rate = tonumber(ARGV[3])
if not full then capacity = math.ceil(capacity / 2); rate = math.ceil(rate / 2) end
local tokens = tonumber(state[1]) or capacity
local last = tonumber(state[2]) or now
local pause = tonumber(state[3]) or 0
-- Paused time earns no tokens, including when nobody polls during the pause.
tokens = math.min(capacity, tokens + math.max(0, now - math.max(last, pause)) * rate / 1000)
local result = 0
if ARGV[1] == 'pause' then
  pause = math.max(pause, now + tonumber(ARGV[4]))
  tokens = 0
elseif ARGV[1] == 'warm' then
  redis.call('HSET', key, 'full', '1')
else
  if now < pause then result = math.ceil(pause - now)
  elseif tokens >= 1 then tokens = tokens - 1
  else result = math.ceil((1 - tokens) * 1000 / rate) end
end
redis.call('HSET', key, 'tokens', tokens, 'last', now, 'pause', pause)
return result
`;

export class RedisTokenBucket {
  private redis: AdmissionRedis;
  private options: { maxTokens: number; refillRate: number; maxQueueSize?: number };
  private pending: Promise<unknown> = Promise.resolve();
  private controller = new AbortController();
  private queued = 0;
  private warmup = true;
  private stats = {
    totalRequests: 0,
    immediateGrants: 0,
    queuedRequests: 0,
    rejectedRequests: 0,
    totalWaitMs: 0,
    globalPauses: 0,
  };

  constructor(
    redis: AdmissionRedis,
    options: { maxTokens: number; refillRate: number; maxQueueSize?: number }
  ) {
    this.redis = redis;
    this.options = options;
    if (!(options.maxTokens >= 1) || !(options.refillRate > 0)) {
      throw new Error('Shared TMDB budget requires positive capacity and refill rate');
    }
  }

  private command(action: string, pause = 0): Promise<number> {
    return this.redis.eval(
      TMDB_BUDGET_SCRIPT,
      [`${ADMISSION_PREFIX}tmdb`],
      [action, String(this.options.maxTokens), String(this.options.refillRate), String(pause)]
    );
  }

  // Keep the queue chain usable after a failed mutation so Redis recovery also recovers acquire().
  private mutate(action: string, pause = 0): Promise<number> {
    const operation = this.pending.then(() => this.command(action, pause));
    this.pending = operation.catch(() => {});
    observeAdmissionMutation(operation);
    return operation;
  }

  notifyRateLimited(retryAfterMs: number): Promise<unknown> {
    const pause = Math.min(
      Math.max(Number.isFinite(retryAfterMs) ? retryAfterMs : 1000, 1000),
      10000
    );
    this.stats.globalPauses++;
    return this.mutate('pause', pause);
  }

  endWarmup(): Promise<unknown> {
    this.warmup = false;
    return this.mutate('warm');
  }

  async acquire(timeoutMs = 10000, requestSignal = getRequestSignal()): Promise<void> {
    const opportunistic = isOpportunisticWork();
    const signal = AbortSignal.any([
      this.controller.signal,
      this.redis.getSignal(),
      ...(requestSignal ? [requestSignal] : []),
    ]);
    signal.throwIfAborted();
    this.stats.totalRequests++;
    if (opportunistic && this.queued > 0) {
      this.stats.rejectedRequests++;
      skipOpportunisticWork('provider work is waiting');
    }
    if (this.queued >= (this.options.maxQueueSize ?? 500)) {
      this.stats.rejectedRequests++;
      throw new Error('TMDB rate limiter queue full — too many concurrent requests');
    }
    this.queued++;
    const started = Date.now();
    const deadline = started + timeoutMs;
    const timeoutError = Object.assign(
      new Error('Rate limiter timeout — waited too long for token'),
      { code: RATE_LIMITER_TIMEOUT_CODE }
    );
    let waited = false;
    let command: Promise<number> | undefined;
    try {
      await admissionAwait(this.pending, timeoutMs, signal, timeoutError);
      for (;;) {
        signal.throwIfAborted();
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw timeoutError;
        command = this.command('acquire');
        const wait = await admissionAwaitCommand(command, remaining, signal, timeoutError);
        command = undefined;
        signal.throwIfAborted();
        if (Date.now() >= deadline) throw timeoutError;
        if (wait === 0) {
          if (!waited) this.stats.immediateGrants++;
          else this.stats.totalWaitMs += Date.now() - started;
          return;
        }
        if (opportunistic) skipOpportunisticWork('provider budget is busy');
        if (!waited) {
          waited = true;
          this.stats.queuedRequests++;
        }
        await admissionDelay(Math.min(wait, 100, Math.max(1, deadline - Date.now())), signal);
      }
    } catch (error) {
      this.stats.rejectedRequests++;
      throw error;
    } finally {
      const removeWaiting = () => this.queued--;
      // A caller can stop waiting before its Redis command settles.
      if (command) void command.then(removeWaiting, removeWaiting);
      else removeWaiting();
    }
  }

  getStats(): Record<string, unknown> {
    return {
      ...this.stats,
      driver: 'redis',
      scope: 'shared',
      queueDepth: this.queued,
      warmupActive: this.warmup,
      avgWaitMs: this.stats.queuedRequests
        ? Math.round(this.stats.totalWaitMs / this.stats.queuedRequests)
        : 0,
    };
  }

  destroy(): void {
    this.controller.abort(new Error('Rate limiter shutting down'));
  }
}

let instance: TokenBucket | RedisTokenBucket | null = null;

export { TokenBucket };

export function getTmdbThrottle(): TokenBucket | RedisTokenBucket {
  if (!instance) {
    const maxTokens = config.tmdb.rateLimit;
    const redis = getAdmissionRedis();
    instance = redis
      ? new RedisTokenBucket(redis, { maxTokens, refillRate: maxTokens })
      : new TokenBucket({ maxTokens, refillRate: maxTokens });
    log.info('TMDB outbound throttle initialized', { maxTokens });
  }
  return instance;
}

export function destroyTmdbThrottle(): void {
  if (instance) {
    instance.destroy();
    instance = null;
  }
  closeAdmissionRedis();
}
