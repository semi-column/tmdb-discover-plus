import type { Response } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { AsyncResource } from 'node:async_hooks';
import { createLogger } from './logger.ts';
import {
  abortRequestContext,
  getRequestSignal,
  throwIfRequestAborted,
  withRequestAbortContext,
} from './requestContext.ts';
import {
  ADMISSION_PREFIX,
  AdmissionRedis,
  SharedAdmissionError,
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
  constructor() {
    super('Addon work capacity exceeded');
    this.name = 'AddonWorkLimitError';
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
elseif redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[4])
  or redis.call('ZCARD', KEYS[2]) >= tonumber(ARGV[5]) then return 0 end
for i = 1, 2 do
  redis.call('ZADD', KEYS[i], now + lease, id)
  redis.call('PEXPIRE', KEYS[i], lease)
end
return 1
`;

type WorkRelease = () => void | Promise<void>;

export class RedisAddonWork {
  private waiting = new Map<string, number>();
  private totalWaiting = 0;

  constructor(
    private redis: AdmissionRedis,
    private leaseMs = ADDON_LEASE_MS
  ) {}

  async acquire(userId: string, requestSignal = getRequestSignal()): Promise<WorkRelease> {
    const signal = AbortSignal.any([
      this.redis.shutdown.signal,
      ...(requestSignal ? [requestSignal] : []),
    ]);
    signal.throwIfAborted();
    if (this.totalWaiting >= GLOBAL_QUEUED || (this.waiting.get(userId) ?? 0) >= PER_USER_QUEUED)
      throw new AddonWorkLimitError();
    // Queue bounds are local, including requests currently attempting admission.
    this.totalWaiting++;
    this.waiting.set(userId, (this.waiting.get(userId) ?? 0) + 1);
    const id = randomUUID();
    const keys = [
      `${ADMISSION_PREFIX}addon:global`,
      `${ADMISSION_PREFIX}addon:user:${createHash('sha256').update(userId).digest('hex')}`,
    ];
    const command = (action: string, timeout = 1000) =>
      this.redis.eval(
        ADDON_WORK_SCRIPT,
        keys,
        [action, id, String(this.leaseMs), String(GLOBAL_ACTIVE), String(PER_USER_ACTIVE)],
        timeout
      );
    const deadline = Date.now() + WAIT_MS;
    try {
      for (;;) {
        signal.throwIfAborted();
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new AddonWorkLimitError();
        const granted = await command('acquire', Math.min(1000, remaining));
        if (granted === 1) {
          if (signal.aborted || Date.now() >= deadline) {
            await command('release');
            signal.throwIfAborted();
            throw new AddonWorkLimitError();
          }
          let released = false;
          let releasing: Promise<void> | undefined;
          let renewing: Promise<unknown> = Promise.resolve();
          const abortWork = AsyncResource.bind((reason: unknown) => abortRequestContext(reason));
          const stop = () => {
            clearInterval(timer);
            this.redis.shutdown.signal.removeEventListener('abort', onShutdown);
          };
          const onShutdown = () => {
            stop();
            abortWork(this.redis.shutdown.signal.reason);
          };
          const timer = setInterval(
            () => {
              renewing = renewing
                .then(async () => {
                  if (released) return;
                  if ((await command('renew')) !== 1) throw new Error('Addon work lease expired');
                })
                .catch((error: unknown) => {
                  stop();
                  const failure = new SharedAdmissionError(
                    'Addon work lease renewal failed',
                    error
                  );
                  this.redis.fail(failure);
                  abortWork(failure);
                  log.error('Addon work lease renewal failed; admission is closed');
                });
            },
            Math.max(1, Math.floor(this.leaseMs / 3))
          );
          timer.unref();
          this.redis.shutdown.signal.addEventListener('abort', onShutdown, { once: true });
          return () => {
            if (releasing) return releasing;
            released = true;
            stop();
            releasing = renewing.then(async () => {
              await command('release');
            });
            observeAdmissionMutation(releasing);
            return releasing;
          };
        }
        await admissionDelay(Math.min(50, Math.max(1, deadline - Date.now())), signal);
      }
    } finally {
      this.totalWaiting--;
      const remaining = (this.waiting.get(userId) ?? 1) - 1;
      if (remaining) this.waiting.set(userId, remaining);
      else this.waiting.delete(userId);
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
  if (canStart(userId)) return startWork(userId);
  const capacityError = () => {
    log.warn('Addon work limit exceeded', {
      policy: 'addonWork',
      userIdPrefix: userId.slice(0, 8),
      active: active.get(userId) || 0,
      totalActive,
      queued: queue.length,
    });
    return new AddonWorkLimitError();
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
      reject(capacityError());
    }, WAIT_MS);
    queue.push(waiting);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function withAddonWork<T>(userId: string, work: () => Promise<T>): Promise<T> {
  return withRequestAbortContext(async () => {
    const release = await acquireAddonWork(userId);
    try {
      throwIfRequestAborted();
      return await work();
    } finally {
      await release();
    }
  });
}

export function sendAddonWorkLimit(error: unknown, res: Response): boolean {
  if (!(error instanceof SharedAdmissionError) && !(error instanceof AddonWorkLimitError))
    return false;
  res.set('Cache-Control', 'no-store');
  res.set('Retry-After', '5');
  res
    .status(error instanceof SharedAdmissionError ? 503 : 429)
    .json({ error: error.message, policy: 'addonWork', retryAfter: 5 });
  return true;
}
