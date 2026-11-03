import { createClient } from 'redis';
import { config } from '../config.ts';
import { createLogger } from '../utils/logger.ts';

const log = createLogger('SharedAdmission');
export const ADMISSION_PREFIX = 'tmdb-discover-plus:{admission}:v1:';

export class SharedAdmissionError extends Error {
  readonly code = 'SHARED_ADMISSION_UNAVAILABLE';
  readonly statusCode = 503;
  constructor(message = 'Shared admission Redis unavailable', cause?: unknown) {
    super(message, { cause });
    this.name = 'SharedAdmissionError';
  }
}

/** Dedicated fail-closed connection: cache adapters intentionally swallow Redis errors. */
export class AdmissionRedis {
  private client;
  private connecting?: Promise<unknown>;
  private failure?: Error;
  private closed = false;
  readonly shutdown = new AbortController();

  constructor(url: string) {
    this.client = createClient({
      url,
      disableOfflineQueue: true,
      socket: { connectTimeout: 1000, reconnectStrategy: false },
    });
    this.client.on('error', () => this.fail(new Error('Shared admission Redis unavailable')));
  }

  fail(error: Error): void {
    this.failure ??=
      error instanceof SharedAdmissionError ? error : new SharedAdmissionError(undefined, error);
    this.shutdown.abort(this.failure);
    if (this.client.isOpen) this.client.destroy();
  }

  async eval(script: string, keys: string[], args: string[], timeoutMs = 1000): Promise<number> {
    if (this.closed) throw new SharedAdmissionError('Shared admission shutting down');
    if (this.failure) throw this.failure;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const command = async () => {
        this.connecting ??= this.client.connect();
        await this.connecting;
        if (this.failure) throw this.failure;
        const reply = await this.client.eval(script, { keys, arguments: args });
        if (typeof reply !== 'number' || !Number.isSafeInteger(reply)) {
          throw new SharedAdmissionError('Invalid shared admission Redis reply');
        }
        return reply;
      };
      return await Promise.race([
        command(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => {
              const error = new Error('Shared admission Redis command timeout');
              this.fail(error);
              reject(error);
            },
            Math.max(1, timeoutMs)
          );
        }),
      ]);
    } catch (error) {
      // An ambiguous write must not be retried as a new grant.
      const failure = new SharedAdmissionError(undefined, error);
      this.fail(failure);
      throw failure;
    } finally {
      clearTimeout(timer);
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.shutdown.abort(new Error('Shared admission shutting down'));
    if (this.client.isOpen) this.client.destroy();
  }
}

export async function admissionDelay(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export async function admissionAwait<T>(
  operation: Promise<T>,
  timeoutMs: number,
  signal: AbortSignal,
  timeoutError: Error
): Promise<T> {
  signal.throwIfAborted();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort = () => {};
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        onAbort = () => reject(signal.reason);
        timer = setTimeout(() => reject(timeoutError), Math.max(1, timeoutMs));
        signal.addEventListener('abort', onAbort, { once: true });
      }),
    ]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}

let instance: AdmissionRedis | undefined;
export function getAdmissionRedis(): AdmissionRedis | undefined {
  if (!config.cache?.redisUrl || config.cache.driver === 'memory') return undefined;
  return (instance ??= new AdmissionRedis(config.cache.redisUrl));
}

// Called by the existing TMDB shutdown hook; covers addon-only usage too.
export function closeAdmissionRedis(): void {
  instance?.close();
  instance = undefined;
}

export function observeAdmissionMutation(operation: Promise<unknown>): void {
  // Existing notification/release callers are synchronous. Never lose a rejection.
  void operation.catch(() => log.error('Shared admission mutation failed; admission is closed'));
}
