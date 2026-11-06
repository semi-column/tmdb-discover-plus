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

export const ADMISSION_RECOVERY_MS = 5000;
const ADMISSION_COMMAND_WAIT_MS = 1000;

const createAdmissionClient = (url: string) =>
  createClient({
    url,
    disableOfflineQueue: true,
    socket: { connectTimeout: 1000, reconnectStrategy: false },
  });

/**
 * Dedicated fail-closed connection: cache adapters intentionally swallow Redis errors.
 * A failure aborts the current generation (in-flight waiters and leases) and rejects
 * commands for ADMISSION_RECOVERY_MS; the next command then opens a fresh connection.
 * Ambiguous grants are never retried; orphaned leases expire on their own.
 */
export class AdmissionRedis {
  private url: string;
  private client!: ReturnType<typeof createAdmissionClient>;
  private connecting?: Promise<unknown>;
  private failure?: SharedAdmissionError;
  private failedAt = 0;
  private closed = false;
  shutdown = new AbortController();

  constructor(url: string) {
    this.url = url;
    this.open();
  }

  private open(): void {
    const client = createAdmissionClient(this.url);
    client.on('error', (error: Error) => {
      if (client === this.client) this.fail(error);
    });
    this.client = client;
    this.connecting = undefined;
  }

  fail(error: Error): void {
    if (this.closed || this.failure) return;
    this.failure =
      error instanceof SharedAdmissionError ? error : new SharedAdmissionError(undefined, error);
    this.failedAt = Date.now();
    const cause = this.failure.cause instanceof Error ? this.failure.cause : this.failure;
    log.error('Shared admission Redis failed; retrying with a new connection', {
      error: cause.message,
      retryInMs: ADMISSION_RECOVERY_MS,
    });
    this.shutdown.abort(this.failure);
    if (this.client.isOpen) this.client.destroy();
  }

  getSignal(): AbortSignal {
    if (this.closed) throw new SharedAdmissionError('Shared admission shutting down');
    if (this.failure) {
      if (Date.now() - this.failedAt < ADMISSION_RECOVERY_MS) throw this.failure;
      this.failure = undefined;
      this.shutdown = new AbortController();
      this.open();
    }
    return this.shutdown.signal;
  }

  async eval(
    script: string,
    keys: string[],
    args: string[],
    timeoutMs = 2 * ADMISSION_COMMAND_WAIT_MS
  ): Promise<number> {
    this.getSignal();
    const client = this.client;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const command = async () => {
        this.connecting ??= client.connect();
        await this.connecting;
        if (this.failure) throw this.failure;
        const reply = await client.eval(script, { keys, arguments: args });
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
              if (client === this.client) this.fail(error);
              reject(error);
            },
            Math.max(1, timeoutMs)
          );
        }),
      ]);
    } catch (error) {
      // An ambiguous write must not be retried as a new grant.
      const failure = new SharedAdmissionError(undefined, error);
      if (client === this.client) this.fail(failure);
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

export function admissionAwaitCommand<T>(
  operation: Promise<T>,
  remainingMs: number,
  signal: AbortSignal,
  deadlineError: Error
): Promise<T> {
  const timeoutError =
    remainingMs <= ADMISSION_COMMAND_WAIT_MS
      ? deadlineError
      : new SharedAdmissionError(undefined, new Error('Shared admission Redis command timeout'));
  return admissionAwait(
    operation,
    Math.min(remainingMs, ADMISSION_COMMAND_WAIT_MS),
    signal,
    timeoutError
  );
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
  void operation.catch((error: unknown) => log.warn('Shared admission mutation failed', { error }));
}
