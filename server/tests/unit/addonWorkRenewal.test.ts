import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  ADMISSION_RECOVERY_MS,
  AdmissionRedis,
  SharedAdmissionError,
  admissionDelay,
  observeAdmissionMutation,
} from '../../src/infrastructure/sharedAdmission.ts';
import { RedisTokenBucket } from '../../src/infrastructure/tmdbThrottle.ts';
import {
  AddonWorkLimitError,
  RedisAddonWork,
  withAddonWork,
  sendAddonWorkLimit,
} from '../../src/utils/addonWork.ts';
import {
  getRequestId,
  getRequestSignal,
  requestIdMiddleware,
} from '../../src/utils/requestContext.ts';

const selected = vi.hoisted(() => ({ redis: undefined as AdmissionRedis | undefined }));
const logged = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn() }));
vi.mock('../../src/infrastructure/sharedAdmission.ts', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/infrastructure/sharedAdmission.ts')>();
  return { ...actual, getAdmissionRedis: () => selected.redis };
});

vi.mock('../../src/utils/logger.ts', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: logged.warn, error: logged.error }),
}));

afterEach(() => {
  selected.redis?.close();
  selected.redis = undefined;
  vi.useRealTimers();
});

describe('addon work renewal context', () => {
  it('responds promptly when Redis fails during an active build', async () => {
    const redis = new AdmissionRedis('redis://127.0.0.1:1');
    selected.redis = redis;
    vi.spyOn(redis, 'eval').mockImplementation(async () => {
      if (redis.shutdown.signal.aborted) throw new SharedAdmissionError();
      return 1;
    });
    const app = express();
    app.use(requestIdMiddleware());
    app.get('/', async (_req, res) => {
      try {
        await withAddonWork('active-request', async () => {
          setImmediate(() => redis.fail(new Error('Redis command timed out')));
          await admissionDelay(30000, getRequestSignal()!);
        });
        res.json({ unexpected: 'success' });
      } catch {
        // Providers can mask the thrown error; the request's abort reason must survive.
        sendAddonWorkLimit(new DOMException('Aborted', 'AbortError'), res);
      }
    });
    const response = await request(app).get('/').timeout(1000);
    expect(response.status).toBe(503);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.policy).toBe('addonWork');
  });

  it.each(['destroyed', 'headersSent'] as const)(
    'does not send an admission response when the response is %s',
    (state) => {
      const res = {
        [state]: true,
        set: vi.fn(),
        status: vi.fn(),
        json: vi.fn(),
      };
      expect(sendAddonWorkLimit(new SharedAdmissionError(), res as never)).toBe(false);
      expect(res.set).not.toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    }
  );

  it('reports shared admission failures as explicit uncacheable 503 responses', async () => {
    const cause = new Error('Shared admission Redis command timeout');
    logged.warn.mockClear();
    const app = express();
    app.get('/', (_req, res) => {
      expect(sendAddonWorkLimit(new Error('unrelated'), res)).toBe(false);
      expect(sendAddonWorkLimit(new SharedAdmissionError(undefined, cause), res)).toBe(true);
    });
    const response = await request(app).get('/');
    expect(response.status).toBe(503);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['retry-after']).toBe('5');
    expect(response.body).toEqual({
      error: 'Shared admission Redis unavailable',
      policy: 'addonWork',
      retryAfter: 5,
    });
    expect(logged.warn).toHaveBeenCalledWith(
      'Addon work admission rejected',
      expect.objectContaining({ reason: 'redis-unavailable', error: cause })
    );
  });

  it('aborts background upstream work on lease loss without a pre-existing request context', async () => {
    vi.useFakeTimers();
    expect(getRequestSignal()).toBeUndefined();
    const redis = new AdmissionRedis('redis://127.0.0.1:1');
    selected.redis = redis;
    let failed = false;
    const evalMock = vi.spyOn(redis, 'eval').mockImplementation(async (_script, _keys, args) => {
      if (failed) throw new SharedAdmissionError();
      return args[0] === 'renew' ? -1 : 1;
    });
    const realFail = redis.fail.bind(redis);
    vi.spyOn(redis, 'fail').mockImplementation((error) => {
      failed = true;
      realFail(error);
    });
    let callbackSignal: AbortSignal | undefined;
    let callbackId: string | undefined;
    const callback = vi.fn(async () => {
      callbackSignal = getRequestSignal();
      callbackId = getRequestId();
      await admissionDelay(60000, callbackSignal!);
      throw new Error('Background work must not continue after lease loss');
    });
    const pending = withAddonWork('background-prefetch', callback);
    const rejection = expect(pending).rejects.toBeInstanceOf(SharedAdmissionError);
    await vi.advanceTimersByTimeAsync(0);
    expect(callback).toHaveBeenCalledOnce();
    expect(callbackSignal?.aborted).toBe(false);
    expect(callbackId).toBeTruthy();
    await vi.advanceTimersByTimeAsync(10000);
    await rejection;
    expect(callbackSignal?.aborted).toBe(true);
    expect(callbackSignal?.reason).toBeInstanceOf(SharedAdmissionError);
    expect(evalMock.mock.calls.map((call) => call[2][0])).toEqual(['acquire', 'renew', 'release']);
    expect(getRequestSignal()).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves an existing request signal and request ID', async () => {
    const redis = new AdmissionRedis('redis://127.0.0.1:1');
    selected.redis = redis;
    vi.spyOn(redis, 'eval').mockResolvedValue(1);
    const app = express();
    app.use(requestIdMiddleware());
    app.get('/', async (_req, res) => {
      const signal = getRequestSignal();
      const id = getRequestId();
      const result = await withAddonWork('existing-request', async () => {
        expect(getRequestSignal()).toBe(signal);
        expect(getRequestId()).toBe(id);
        return 'done';
      });
      expect(getRequestSignal()).toBe(signal);
      expect(signal?.aborted).toBe(false);
      res.json({ result });
    });
    expect((await request(app).get('/')).body).toEqual({ result: 'done' });
  });
});

describe('shared admission recovery', () => {
  it('logs the cause when a background admission mutation fails', async () => {
    const error = new Error('release failed');
    logged.warn.mockClear();
    observeAdmissionMutation(Promise.reject(error));
    await Promise.resolve();
    expect(logged.warn).toHaveBeenCalledWith('Shared admission mutation failed', { error });
  });

  it('does not report a Redis failure after admission is closed', () => {
    const redis = new AdmissionRedis('redis://127.0.0.1:1');
    selected.redis = redis;
    redis.close();
    logged.error.mockClear();
    redis.fail(new Error('Connection closed during shutdown'));
    expect(logged.error).not.toHaveBeenCalled();
  });

  it('releases a work grant that arrives after the command wait deadline', async () => {
    vi.useFakeTimers();
    const redis = new AdmissionRedis('redis://127.0.0.1:1');
    selected.redis = redis;
    let resolveGrant!: (value: number) => void;
    const grant = new Promise<number>((resolve) => {
      resolveGrant = resolve;
    });
    const command = vi.spyOn(redis, 'eval').mockImplementation((_script, _keys, args) => {
      return args[0] === 'acquire' ? grant : Promise.resolve(1);
    });
    const waiting = new RedisAddonWork(redis).acquire('late-grant');
    const rejection = expect(waiting).rejects.toBeInstanceOf(SharedAdmissionError);
    await vi.advanceTimersByTimeAsync(1000);
    await rejection;
    expect(command.mock.calls.map((call) => call[2][0])).toEqual(['acquire']);
    resolveGrant(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(command.mock.calls.map((call) => call[2][0])).toEqual(['acquire', 'release']);
    expect(redis.shutdown.signal.aborted).toBe(false);
  });

  it('counts timed-out work until its pending Redis commands settle', async () => {
    vi.useFakeTimers();
    const redis = new AdmissionRedis('redis://127.0.0.1:1');
    selected.redis = redis;
    let resolveGrant!: (value: number) => void;
    const grant = new Promise<number>((resolve) => {
      resolveGrant = resolve;
    });
    const command = vi.spyOn(redis, 'eval').mockReturnValue(grant);
    const work = new RedisAddonWork(redis);
    const waiting = Array.from({ length: 100 }, () =>
      work.acquire('timed-out-user').catch((error: unknown) => error)
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(
      (await Promise.all(waiting)).every((error) => error instanceof SharedAdmissionError)
    ).toBe(true);
    await expect(work.acquire('timed-out-user')).rejects.toBeInstanceOf(AddonWorkLimitError);
    expect(command).toHaveBeenCalledTimes(100);

    resolveGrant(0);
    await vi.advanceTimersByTimeAsync(0);
    command.mockResolvedValue(1);
    const release = await work.acquire('timed-out-user');
    await release();
  });

  it('counts cancelled work until its pending Redis commands settle', async () => {
    vi.useFakeTimers();
    const redis = new AdmissionRedis('redis://127.0.0.1:1');
    selected.redis = redis;
    let resolveGrant!: (value: number) => void;
    const grant = new Promise<number>((resolve) => {
      resolveGrant = resolve;
    });
    const command = vi.spyOn(redis, 'eval').mockReturnValue(grant);
    const work = new RedisAddonWork(redis);
    const controller = new AbortController();
    const waiting = Array.from({ length: 100 }, () =>
      work.acquire('cancelled-user', controller.signal).catch((error: unknown) => error)
    );
    controller.abort();
    expect(
      (await Promise.all(waiting)).every(
        (error) => error instanceof Error && error.name === 'AbortError'
      )
    ).toBe(true);
    await expect(work.acquire('cancelled-user')).rejects.toBeInstanceOf(AddonWorkLimitError);
    expect(command).toHaveBeenCalledTimes(100);

    resolveGrant(0);
    await vi.advanceTimersByTimeAsync(0);
    command.mockResolvedValue(1);
    const release = await work.acquire('cancelled-user');
    await release();
  });

  it('counts a cancelled token request until its Redis command settles', async () => {
    vi.useFakeTimers();
    const redis = new AdmissionRedis('redis://127.0.0.1:1');
    selected.redis = redis;
    let resolveToken!: (value: number) => void;
    const token = new Promise<number>((resolve) => {
      resolveToken = resolve;
    });
    const command = vi.spyOn(redis, 'eval').mockReturnValue(token);
    const bucket = new RedisTokenBucket(redis, { maxTokens: 5, refillRate: 5, maxQueueSize: 1 });
    const controller = new AbortController();
    const waiting = bucket.acquire(5000, controller.signal);
    const rejection = expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(0);
    expect(command).toHaveBeenCalledOnce();
    controller.abort();
    await rejection;
    expect(bucket.getStats().queueDepth).toBe(1);
    await expect(bucket.acquire()).rejects.toThrow('queue full');

    resolveToken(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(bucket.getStats().queueDepth).toBe(0);
    bucket.destroy();
  });

  it.each(['addon', 'tmdb'] as const)(
    'recovers %s admission before capturing its cancellation signal',
    async (kind) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const redis = new AdmissionRedis('redis://127.0.0.1:1');
      selected.redis = redis;
      const bucket = new RedisTokenBucket(redis, { maxTokens: 5, refillRate: 5 });
      const work = new RedisAddonWork(redis);
      const acquire = () => (kind === 'addon' ? work.acquire('recovery') : bucket.acquire());
      const first = redis.shutdown.signal;
      redis.fail(new Error('Transient Redis failure'));
      const command = vi.spyOn(redis, 'eval').mockResolvedValue(kind === 'addon' ? 1 : 0);
      try {
        await expect(acquire()).rejects.toBeInstanceOf(SharedAdmissionError);
        expect(command).not.toHaveBeenCalled();
        vi.setSystemTime(Date.now() + ADMISSION_RECOVERY_MS);
        const release = await acquire();
        expect(redis.shutdown.signal).not.toBe(first);
        expect(redis.shutdown.signal.aborted).toBe(false);
        expect(first.aborted).toBe(true);
        expect(command).toHaveBeenCalledOnce();
        if (release) await release();
        redis.close();
        await expect(acquire()).rejects.toThrow('shutting down');
      } finally {
        bucket.destroy();
      }
    }
  );

  it('rejects during the cooldown, then opens a fresh connection generation', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const redis = new AdmissionRedis('redis://127.0.0.1:1');
    selected.redis = redis;
    const first = redis.shutdown.signal;
    await expect(redis.eval('return 1', [], [])).rejects.toBeInstanceOf(SharedAdmissionError);
    expect(first.aborted).toBe(true);
    await expect(redis.eval('return 1', [], [])).rejects.toBe(first.reason);
    expect(redis.shutdown.signal).toBe(first);

    vi.setSystemTime(Date.now() + ADMISSION_RECOVERY_MS);
    const retry = redis.eval('return 1', [], []);
    const second = redis.shutdown.signal;
    expect(second).not.toBe(first);
    await expect(retry).rejects.toBeInstanceOf(SharedAdmissionError);
    expect(second.aborted).toBe(true);
  });

  it('keeps TMDB acquire usable after a failed shared pause', async () => {
    const redis = new AdmissionRedis('redis://127.0.0.1:1');
    selected.redis = redis;
    vi.spyOn(redis, 'eval').mockImplementation(async (_script, _keys, args) => {
      if (args[0] === 'pause') throw new SharedAdmissionError();
      return 0;
    });
    const bucket = new RedisTokenBucket(redis, { maxTokens: 5, refillRate: 5 });
    await expect(bucket.notifyRateLimited(1000)).rejects.toBeInstanceOf(SharedAdmissionError);
    await expect(bucket.acquire()).resolves.toBeUndefined();
    bucket.destroy();
  });
});
