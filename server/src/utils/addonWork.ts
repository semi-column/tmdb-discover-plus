import type { Response } from 'express';
import { createLogger } from './logger.ts';
import { getRequestSignal, throwIfRequestAborted } from './requestContext.ts';

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

// ponytail: concurrency is per process; use distributed admission if deploying multiple workers.
export async function acquireAddonWork(userId: string): Promise<() => void> {
  throwIfRequestAborted();
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
  const release = await acquireAddonWork(userId);
  try {
    throwIfRequestAborted();
    return await work();
  } finally {
    release();
  }
}

export function sendAddonWorkLimit(error: unknown, res: Response): boolean {
  if (!(error instanceof AddonWorkLimitError)) return false;
  res.set('Cache-Control', 'no-store');
  res.set('Retry-After', '5');
  res.status(429).json({ error: error.message, policy: 'addonWork', retryAfter: 5 });
  return true;
}
