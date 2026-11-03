import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  ADMISSION_RECOVERY_MS,
  AdmissionRedis,
  SharedAdmissionError,
  admissionDelay,
} from '../../src/infrastructure/sharedAdmission.ts';
import { RedisTokenBucket } from '../../src/infrastructure/tmdbThrottle.ts';
import { withAddonWork, sendAddonWorkLimit } from '../../src/utils/addonWork.ts';
import {
  getRequestId,
  getRequestSignal,
  requestIdMiddleware,
} from '../../src/utils/requestContext.ts';

const selected = vi.hoisted(() => ({ redis: undefined as AdmissionRedis | undefined }));
vi.mock('../../src/infrastructure/sharedAdmission.ts', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/infrastructure/sharedAdmission.ts')>();
  return { ...actual, getAdmissionRedis: () => selected.redis };
});

vi.mock('../../src/utils/logger.ts', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

afterEach(() => {
  selected.redis?.close();
  selected.redis = undefined;
  vi.useRealTimers();
});

describe('addon work renewal context', () => {
  it('reports shared admission failures as explicit uncacheable 503 responses', async () => {
    const app = express();
    app.get('/', (_req, res) => {
      expect(sendAddonWorkLimit(new Error('unrelated'), res)).toBe(false);
      expect(sendAddonWorkLimit(new SharedAdmissionError(), res)).toBe(true);
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
