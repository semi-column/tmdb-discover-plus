import type { Response } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { AsyncResource } from 'node:async_hooks';
import { createLogger } from './logger.ts';
import {
  abortRequestContext,
  getRequestSignal,
  isOpportunisticWork,
  measureRequestStage,
  skipOpportunisticWork,
  throwIfRequestAborted,
  withRequestAbortContext,
} from './requestContext.ts';
import {
  ADMISSION_PREFIX,
  AdmissionRedis,
  SharedAdmissionError,
  admissionAwaitCommand,
  admissionDelay,
  getAdmissionRedis,
  observeAdmissionMutation,
} from '../infrastructure/sharedAdmission.ts';

const log = createLogger('rateLimit');
const PER_USER_ACTIVE = 6;
const GLOBAL_ACTIVE = 60;
const PER_USER_QUEUED = 100;
const GLOBAL_QUEUED = 500;
const WAIT_MS = 5000;
const active = new Map<string, number>();
let totalActive = 0;
const queue: { userId: string; start: () => void }[] = [];

export class AddonWorkLimitError extends Error {
  readonly reason: 'queue' | 'wait';
  readonly scope?: 'global' | 'configuration';
  constructor(reason: 'queue' | 'wait' = 'queue', scope?: 'global' | 'configuration') {
    super('Addon work capacity exceeded');
    this.name = 'AddonWorkLimitError';
    this.reason = reason;
    this.scope = scope;
  }
}

function canStart(userId: string): boolean {
  return totalActive < GLOBAL_ACTIVE && (active.get(userId) || 0) < PER_USER_ACTIVE;
}

function startWork(userId: string): () => void {
  totalActive++;
  active.set(userId, (active.get(userId) || 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    totalActive--;
    const remaining = (active.get(userId) || 1) - 1;
    if (remaining) active.set(userId, remaining);
    else active.delete(userId);
    for (let i = 0; i < queue.length && totalActive < GLOBAL_ACTIVE;) {
      const waiting = queue[i];
      if (canStart(waiting.userId)) waiting.start();
      else i++;
    }
  };
}

export const ADDON_LEASE_MS = 30000;
export const ADDON_WORK_SCRIPT = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + tonumber(t[2]) / 1000
local id = ARGV[2]
local lease = tonumber(ARGV[3])
for i = 1, 2 do redis.call('ZREMRANGEBYSCORE', KEYS[i], '-inf', now) end
if ARGV[1] == 'release' then
  for i = 1, 2 do
    redis.call('ZREM', KEYS[i], id)
    if redis.call('ZCARD', KEYS[i]) == 0 then redis.call('DEL', KEYS[i]) end
  end
  return 1
end
if ARGV[1] == 'renew' then
  if not redis.call('ZSCORE', KEYS[1], id) or not redis.call('ZSCORE', KEYS[2], id) then return -1 end
elseif redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[4]) then return 2
elseif redis.call('ZCARD', KEYS[2]) >= tonumber(ARGV[5]) then return 0 end
for i = 1, 2 do
  redis.call('ZADD', KEYS[i], now + lease, id)
  redis.call('PEXPIRE', KEYS[i], lease)
end
return 1
`;

type WorkRelease = () => void | Promise<void>;

export class RedisAddonWork {
  private waiting = new Map<string, number>();
  private heads = new Map<string, Set<string>>();
  private probing = new Set<string>();
  private globalBlocked = false;
  private globalRetryAt = 0;
  private globalProbing = false;
  private changed = new AbortController();
  private totalWaiting = 0;
  private redis: AdmissionRedis;
  private leaseMs: number;

  constructor(redis: AdmissionRedis, leaseMs = ADDON_LEASE_MS) {
    this.redis = redis;
    this.leaseMs = leaseMs;
  }

  private notify(): void {
    const previous = this.changed;
    this.changed = new AbortController();
    previous.abort();
  }

  private async wait(ms: number, signal: AbortSignal): Promise<void> {
    const changed = this.changed.signal;
    try {
      await admissionDelay(ms, AbortSignal.any([signal, changed]));
    } catch (error) {
      signal.throwIfAborted();
      if (!changed.aborted) throw error;
    }
  }

  async acquire(userId: string, requestSignal = getRequestSignal()): Promise<WorkRelease> {
    const opportunistic = isOpportunisticWork();
    const generation = this.redis.getSignal();
    const signal = AbortSignal.any([generation, ...(requestSignal ? [requestSignal] : [])]);
    signal.throwIfAborted();
    if (opportunistic && this.totalWaiting > 0) {
      skipOpportunisticWork('addon work is waiting');
    }
    if (this.totalWaiting >= GLOBAL_QUEUED || (this.waiting.get(userId) ?? 0) >= PER_USER_QUEUED)
      throw new AddonWorkLimitError();
    // Queue bounds are local, including requests currently attempting admission.
    this.totalWaiting++;
    this.waiting.set(userId, (this.waiting.get(userId) ?? 0) + 1);
    const id = randomUUID();
    const heads = this.heads.get(userId) ?? new Set<string>();
    heads.add(id);
    this.heads.set(userId, heads);
    const keys = [
      `${ADMISSION_PREFIX}addon:global`,
      `${ADMISSION_PREFIX}addon:user:${createHash('sha256').update(userId).digest('hex')}`,
    ];
    const command = (action: string) =>
      this.redis.eval(ADDON_WORK_SCRIPT, keys, [
        action,
        id,
        String(this.leaseMs),
        String(opportunistic ? GLOBAL_ACTIVE - 1 : GLOBAL_ACTIVE),
        String(opportunistic ? PER_USER_ACTIVE - 1 : PER_USER_ACTIVE),
      ]);
    const deadline = Date.now() + WAIT_MS;
    let cleanup: Promise<unknown> | undefined;
    let scope: AddonWorkLimitError['scope'];
    try {
      for (;;) {
        signal.throwIfAborted();
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new AddonWorkLimitError('wait', scope);
        // Only the configuration's FIFO head probes. Once global capacity is
        // exhausted, rotate configurations through one shared probe per tick.
        if (
          heads.values().next().value !== id ||
          this.probing.has(userId) ||
          (this.globalBlocked &&
            (this.globalProbing ||
              Date.now() < this.globalRetryAt ||
              this.heads.keys().next().value !== userId))
        ) {
          if (this.globalBlocked) scope = 'global';
          await this.wait(Math.min(50, remaining), signal);
          continue;
        }
        const started = performance.now();
        this.probing.add(userId);
        const globalProbe = this.globalBlocked;
        if (globalProbe) this.globalProbing = true;
        const pending = measureRequestStage('addon_admission_redis', () => command('acquire'));
        const settled = () => {
          this.probing.delete(userId);
          if (globalProbe) this.globalProbing = false;
        };
        pending.then(settled, settled);
        let granted: number;
        try {
          granted = await admissionAwaitCommand(
            pending,
            remaining,
            signal,
            new AddonWorkLimitError('wait', scope)
          );
        } catch (error) {
          // A grant can arrive after the caller has stopped waiting.
          cleanup = pending.then((result) => (result === 1 ? command('release') : undefined));
          throw error;
        }
        if (granted === 1) {
          this.globalBlocked = false;
          if (signal.aborted || Date.now() >= deadline) {
            cleanup = command('release');
            signal.throwIfAborted();
            throw new AddonWorkLimitError('wait');
          }
          const validityMs = this.leaseMs * 0.99;
          let validUntil = started + validityMs;
          if (performance.now() >= validUntil) {
            cleanup = command('release');
            throw new SharedAdmissionError('Addon work lease expired before acquisition completed');
          }
          let released = false;
          let leaseLost = false;
          let releasing: Promise<void> | undefined;
          let renewing: Promise<unknown> = Promise.resolve();
          const abortWork = AsyncResource.bind((reason: unknown) => abortRequestContext(reason));
          const stop = () => {
            clearInterval(timer);
            clearTimeout(expiry);
            generation.removeEventListener('abort', onShutdown);
          };
          const failLease = (error: unknown) => {
            if (leaseLost) return;
            leaseLost = true;
            stop();
            if (released) {
              log.warn('Addon work renewal failed during release', { error });
              return;
            }
            abortWork(new SharedAdmissionError('Addon work lease renewal failed', error));
            log.error('Addon work lease renewal failed; work aborted', {
              error: error instanceof Error ? error.message : String(error),
            });
          };
          const expire = () => failLease(new Error('Addon work lease expired'));
          let expiry = setTimeout(expire, Math.max(1, validUntil - performance.now()));
          expiry.unref();
          const onShutdown = () => {
            leaseLost = true;
            stop();
            abortWork(generation.reason);
          };
          const timer = setInterval(
            () => {
              renewing = renewing
                .then(async () => {
                  if (released || leaseLost) return;
                  const renewalStarted = performance.now();
                  if (renewalStarted >= validUntil) throw new Error('Addon work lease expired');
                  if ((await command('renew')) !== 1) throw new Error('Addon work lease expired');
                  if (released) return;
                  if (leaseLost || performance.now() >= validUntil)
                    throw new Error('Addon work lease expired');
                  validUntil = renewalStarted + validityMs;
                  if (!released) {
                    clearTimeout(expiry);
                    expiry = setTimeout(expire, Math.max(1, validUntil - performance.now()));
                    expiry.unref();
                  }
                })
                .catch(failLease);
            },
            Math.max(1, Math.floor(this.leaseMs / 3))
          );
          timer.unref();
          generation.addEventListener('abort', onShutdown, { once: true });
          return () => {
            if (releasing) return releasing;
            if (!leaseLost && performance.now() >= validUntil)
              failLease(new Error('Addon work lease expired'));
            released = true;
            stop();
            releasing = renewing.then(async () => {
              await command('release');
              this.globalRetryAt = 0;
              this.notify();
            });
            observeAdmissionMutation(releasing);
            return releasing;
          };
        }
        if (granted !== 0 && granted !== 2)
          throw new SharedAdmissionError('Invalid addon work admission result');
        scope = granted === 2 ? 'global' : 'configuration';
        this.globalBlocked = granted === 2;
        if (this.globalBlocked) this.globalRetryAt = Date.now() + 50;
        this.heads.delete(userId);
        this.heads.set(userId, heads);
        if (opportunistic) skipOpportunisticWork('addon work is at capacity');
        await this.wait(Math.min(50, Math.max(1, deadline - Date.now())), signal);
      }
    } finally {
      heads.delete(id);
      if (!heads.size) this.heads.delete(userId);
      if (!this.heads.size) this.globalBlocked = false;
      this.notify();
      const removeWaiting = () => {
        this.totalWaiting--;
        const remaining = (this.waiting.get(userId) ?? 1) - 1;
        if (remaining) this.waiting.set(userId, remaining);
        else this.waiting.delete(userId);
      };
      // Keep late Redis work within the queue bounds until cleanup finishes.
      if (cleanup) observeAdmissionMutation(cleanup.finally(removeWaiting));
      else removeWaiting();
    }
  }
}

let shared: RedisAddonWork | undefined;
let sharedConnection: AdmissionRedis | undefined;

export async function acquireAddonWork(userId: string): Promise<WorkRelease> {
  throwIfRequestAborted();
  const redis = getAdmissionRedis();
  if (redis) {
    if (redis !== sharedConnection) {
      sharedConnection = redis;
      shared = new RedisAddonWork(redis);
    }
    return shared!.acquire(userId);
  }
  if (isOpportunisticWork()) {
    if (
      queue.length > 0 ||
      totalActive >= GLOBAL_ACTIVE - 1 ||
      (active.get(userId) || 0) >= PER_USER_ACTIVE - 1
    ) {
      skipOpportunisticWork('addon work is at capacity');
    }
    return startWork(userId);
  }
  if (canStart(userId)) return startWork(userId);
  const capacityError = (reason: 'queue' | 'wait' = 'queue') => {
    log.warn('Addon work limit exceeded', {
      policy: 'addonWork',
      userIdPrefix: userId.slice(0, 8),
      active: active.get(userId) || 0,
      totalActive,
      queued: queue.length,
    });
    return new AddonWorkLimitError(reason);
  };
  if (
    queue.length >= GLOBAL_QUEUED ||
    queue.filter((entry) => entry.userId === userId).length >= PER_USER_QUEUED
  ) {
    throw capacityError();
  }
  return new Promise<() => void>((resolve, reject) => {
    const signal = getRequestSignal();
    const remove = () => {
      const index = queue.indexOf(waiting);
      if (index !== -1) queue.splice(index, 1);
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      remove();
      reject(signal?.reason);
    };
    const waiting = {
      userId,
      start: () => {
        remove();
        resolve(startWork(userId));
      },
    };
    const timer = setTimeout(() => {
      remove();
      reject(capacityError('wait'));
    }, WAIT_MS);
    queue.push(waiting);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function withAddonWork<T>(userId: string, work: () => Promise<T>): Promise<T> {
  return withRequestAbortContext(async () => {
    const release = await measureRequestStage('addon_admission', () => acquireAddonWork(userId));
    let result: T;
    try {
      throwIfRequestAborted();
      result = await work();
      throwIfRequestAborted();
    } finally {
      try {
        await release();
      } catch (error) {
        if (!(error instanceof SharedAdmissionError)) throw error;
        log.warn('Addon work release failed after execution; lease will expire', { error });
      }
    }
    throwIfRequestAborted();
    return result;
  });
}

export function sendAddonWorkLimit(error: unknown, res: Response): boolean {
  if (res.headersSent || res.destroyed) return false;
  const reason = getRequestSignal()?.reason;
  if (reason instanceof SharedAdmissionError) error = reason;
  if (!(error instanceof SharedAdmissionError) && !(error instanceof AddonWorkLimitError))
    return false;
  log.warn('Addon work admission rejected', {
    policy: 'addonWork',
    reason: error instanceof AddonWorkLimitError ? error.reason : 'redis-unavailable',
    statusCode: error instanceof SharedAdmissionError ? 503 : 429,
    waitBudgetMs: WAIT_MS,
    ...(error instanceof AddonWorkLimitError && error.scope ? { scope: error.scope } : {}),
    ...(error instanceof SharedAdmissionError && error.cause ? { error: error.cause } : {}),
  });
  res.set('Cache-Control', 'no-store');
  res.set('Retry-After', '5');
  res
    .status(error instanceof SharedAdmissionError ? 503 : 429)
    .json({ error: error.message, policy: 'addonWork', retryAfter: 5 });
  return true;
}
