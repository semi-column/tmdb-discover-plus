import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import { createClient } from 'redis';
import express from 'express';
import request from 'supertest';
import {
  ADMISSION_PREFIX,
  ADMISSION_RECOVERY_MS,
  AdmissionRedis,
  SharedAdmissionError,
  admissionAwait,
  admissionDelay,
} from '../../src/infrastructure/sharedAdmission.ts';
import {
  RATE_LIMITER_TIMEOUT_CODE,
  RedisTokenBucket,
  TMDB_BUDGET_SCRIPT,
} from '../../src/infrastructure/tmdbThrottle.ts';
import {
  RedisAddonWork,
  ADDON_WORK_SCRIPT,
  AddonWorkLimitError,
  sendAddonWorkLimit,
} from '../../src/utils/addonWork.ts';
import {
  getRequestSignal,
  requestIdMiddleware,
  startOpportunisticWork,
} from '../../src/utils/requestContext.ts';
import { AnilistThrottle } from '../../src/infrastructure/anilistThrottle.ts';

// Never connect to REDIS_URL: all destructive operations target our own disposable server.
const binary = process.env.ADMISSION_REDIS_SERVER || 'redis-server';
const available = spawnSync(binary, ['--version']).status === 0;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe.skipIf(!available)('isolated Redis shared admission (two replicas)', () => {
  let process: ChildProcess;
  let directory: string;
  let url: string;
  let inspector: ReturnType<typeof createClient>;
  const connections: AdmissionRedis[] = [];
  const releases: (() => void | Promise<void>)[] = [];
  const buckets: RedisTokenBucket[] = [];
  const connection = () => {
    const client = new AdmissionRedis(url);
    connections.push(client);
    return client;
  };
  const bucket = (client: AdmissionRedis, maxTokens = 35, refillRate = 35, maxQueueSize = 500) => {
    const limiter = new RedisTokenBucket(client, { maxTokens, refillRate, maxQueueSize });
    buckets.push(limiter);
    return limiter;
  };
  const occupy = async (work: RedisAddonWork, user: string, count: number) => {
    for (let i = 0; i < count; i++) releases.push(await work.acquire(user));
  };

  beforeAll(async () => {
    const reservation = createServer();
    await new Promise<void>((resolve) => reservation.listen(0, '127.0.0.1', resolve));
    const port = (reservation.address() as { port: number }).port;
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
    directory = resolve(`.admission-redis-${randomUUID().slice(0, 8)}`);
    mkdirSync(directory);
    process = spawn(
      binary,
      [
        '--bind',
        '127.0.0.1',
        '--port',
        String(port),
        '--save',
        '',
        '--appendonly',
        'no',
        '--dir',
        directory,
      ],
      { stdio: 'ignore' }
    );
    url = `redis://127.0.0.1:${port}`;
    inspector = createClient({ url, socket: { reconnectStrategy: false, connectTimeout: 100 } });
    inspector.on('error', () => {});
    for (let i = 0; i < 100; i++) {
      try {
        await inspector.connect();
        break;
      } catch {
        await sleep(20);
      }
    }
    expect(await inspector.ping()).toBe('PONG');
  });
  beforeEach(async () => {
    await inspector.flushDb();
  });
  afterEach(async () => {
    await Promise.all(
      releases.splice(0).map((release) => Promise.resolve(release()).catch(() => {}))
    );
    buckets.splice(0).forEach((limiter) => limiter.destroy());
    connections.splice(0).forEach((client) => client.close());
  });
  afterAll(async () => {
    if (inspector?.isOpen) inspector.destroy();
    if (process && process.exitCode === null) {
      const exited = new Promise<void>((resolve) => process.once('exit', () => resolve()));
      process.kill('SIGTERM');
      await exited;
    }
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  it('uses one warmup burst and one 35/s refill, not a budget per replica', async () => {
    const a = bucket(connection());
    const b = bucket(connection());
    await Promise.all(Array.from({ length: 18 }, (_, i) => (i % 2 ? a : b).acquire()));
    await expect(b.acquire(10)).rejects.toMatchObject({ code: 'RATE_LIMITER_TIMEOUT' });
    await a.endWarmup();
    const start = Date.now();
    await Promise.all(Array.from({ length: 35 }, (_, i) => (i % 2 ? a : b).acquire(3000)));
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(850);
    expect(elapsed).toBeLessThan(2000);
  });

  it('keeps cancelled AniList commands inside the queue bound until Redis settles', async () => {
    const client = connection();
    const command = Promise.withResolvers<number>();
    const evaluate = vi.spyOn(client, 'eval').mockImplementation(() => command.promise);
    const throttle = new AnilistThrottle(client);
    const controller = new AbortController();
    const waiting = Array.from({ length: 100 }, () =>
      throttle.acquire(controller.signal).catch((error) => error)
    );
    controller.abort();
    await Promise.all(waiting);
    await expect(throttle.acquire()).rejects.toMatchObject({ statusCode: 429 });
    expect(evaluate).toHaveBeenCalledTimes(100);
    command.resolve(0);
    await command.promise;
    await expect(throttle.acquire()).resolves.toBeUndefined();
    throttle.destroy();
  });

  it('shares AniList spacing and the longest cooldown across replicas without an idle burst', async () => {
    const a = new AnilistThrottle(connection());
    const b = new AnilistThrottle(connection());
    await a.acquire();
    const started = Date.now();
    await b.acquire();
    expect(Date.now() - started).toBeGreaterThanOrEqual(2000);
    await a.pause(1200);
    await b.pause(500);
    const paused = Date.now();
    await b.acquire();
    expect(Date.now() - paused).toBeGreaterThanOrEqual(2000);
    const controller = new AbortController();
    const pending = a.acquire(controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    a.destroy();
    b.destroy();
  });

  it('keeps AniList fail closed and recovers after Redis reconnects', async () => {
    const client = connection();
    const throttle = new AnilistThrottle(client);
    await throttle.acquire();
    client.fail(new Error('simulated AniList outage'));
    await expect(throttle.acquire()).rejects.toBeInstanceOf(SharedAdmissionError);
    await expect(throttle.pause(1000)).rejects.toBeInstanceOf(SharedAdmissionError);
    await sleep(ADMISSION_RECOVERY_MS);
    await expect(throttle.acquire()).resolves.toBeUndefined();
    throttle.destroy();
  });

  it('shares the maximum pause and earns no tokens during idle paused time', async () => {
    const a = bucket(connection(), 10, 10);
    const b = bucket(connection(), 10, 10);
    await a.endWarmup();
    await a.notifyRateLimited(1300);
    await b.notifyRateLimited(1000); // Must not shorten the other replica's pause.
    const started = Date.now();
    await b.acquire(3000);
    expect(Date.now() - started).toBeGreaterThanOrEqual(1350);
    await a.notifyRateLimited(1000);
    await sleep(1050);
    const tokens = Number(await inspector.hGet(`${ADMISSION_PREFIX}tmdb`, 'tokens'));
    expect(tokens).toBe(0);
    await expect(b.acquire(10)).rejects.toMatchObject({ code: 'RATE_LIMITER_TIMEOUT' });
  });

  it('bounds token queues and cleans up abort, timeout and shutdown waiters', async () => {
    const a = bucket(connection(), 1, 1, 1);
    await a.notifyRateLimited(1000);
    const controller = new AbortController();
    const pending = a.acquire(5000, controller.signal);
    await expect(a.acquire()).rejects.toThrow('queue full');
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(a.getStats().queueDepth).toBe(0), {
      interval: 10,
      timeout: 1000,
    });
    await expect(a.acquire(20)).rejects.toMatchObject({ code: 'RATE_LIMITER_TIMEOUT' });
    const shuttingDown = a.acquire();
    a.destroy();
    await expect(shuttingDown).rejects.toThrow('shutting down');
    await vi.waitFor(() => expect(a.getStats().queueDepth).toBe(0), {
      interval: 10,
      timeout: 1000,
    });
  });

  it('does not close admission when only a token wait deadline expires', async () => {
    const client = connection();
    const throttle = bucket(client);
    await client.eval('return 1', [], []);
    await inspector.sendCommand(['CLIENT', 'PAUSE', '250', 'ALL']);
    await expect(throttle.acquire(30)).rejects.toMatchObject({ code: RATE_LIMITER_TIMEOUT_CODE });
    expect(client.shutdown.signal.aborted).toBe(false);
    await sleep(300);
    await expect(throttle.acquire()).resolves.toBeUndefined();
  });

  it('shares six per user and sixty global active slots; release is idempotent', async () => {
    const a = new RedisAddonWork(connection());
    const b = new RedisAddonWork(connection());
    await occupy(a, 'same-secret-user', 3);
    await occupy(b, 'same-secret-user', 3);
    const abort = new AbortController();
    const blocked = b.acquire('same-secret-user', abort.signal);
    await sleep(100);
    expect(await inspector.zCard(`${ADMISSION_PREFIX}addon:global`)).toBe(6);
    abort.abort();
    await expect(blocked).rejects.toMatchObject({ name: 'AbortError' });
    for (let i = 0; i < 9; i++) {
      await occupy(i % 2 ? a : b, `global-${i}`, 6);
    }
    expect(await inspector.zCard(`${ADMISSION_PREFIX}addon:global`)).toBe(60);
    const waiting = a.acquire('new-user');
    const release = releases.shift()!;
    await Promise.all([release(), release()]);
    releases.push(await waiting);
    expect(await inspector.zCard(`${ADMISSION_PREFIX}addon:global`)).toBe(60);
    const queuedAbort = new AbortController();
    const fullQueue = Array.from({ length: 500 }, (_, i) =>
      b.acquire(`waiting-${i}`, queuedAbort.signal).catch((error: unknown) => error)
    );
    await expect(b.acquire('overflow')).rejects.toBeInstanceOf(AddonWorkLimitError);
    queuedAbort.abort();
    expect((await Promise.all(fullQueue)).every((error) => error.name === 'AbortError')).toBe(true);
    const keys = await inspector.keys(`${ADMISSION_PREFIX}*`);
    expect(keys.some((key) => key.includes('same-secret-user'))).toBe(false);
    await Promise.all(releases.splice(0).map((release) => release()));
    expect(await inspector.keys(`${ADMISSION_PREFIX}addon:*`)).toEqual([]);
  });

  it('reserves the final per-user work slot across Redis replicas for foreground requests', async () => {
    const a = new RedisAddonWork(connection());
    const b = new RedisAddonWork(connection());
    await occupy(a, 'priority-user', 5);

    const background = startOpportunisticWork(() => b.acquire('priority-user'))!;
    await expect(background.promise).rejects.toMatchObject({ code: 'OPPORTUNISTIC_SKIPPED' });
    releases.push(await b.acquire('priority-user'));
  });

  it('reserves the final global work slot across Redis replicas for foreground requests', async () => {
    const a = new RedisAddonWork(connection());
    const b = new RedisAddonWork(connection());
    for (let i = 0; i < 59; i++) releases.push(await a.acquire(`priority-user-${i}`));

    const background = startOpportunisticWork(() => b.acquire('another-user'))!;
    await expect(background.promise).rejects.toMatchObject({ code: 'OPPORTUNISTIC_SKIPPED' });
    releases.push(await b.acquire('another-user'));
  });

  it('skips busy background provider admission rather than joining a Redis queue', async () => {
    const limiter = bucket(connection(), 1, 0.01);
    await limiter.acquire();

    const background = startOpportunisticWork(() => limiter.acquire(1000))!;
    await expect(background.promise).rejects.toMatchObject({ code: 'OPPORTUNISTIC_SKIPPED' });
    expect(limiter.getStats().queueDepth).toBe(0);
  });

  it('skips a busy shared AniList slot instead of waiting behind another replica', async () => {
    const a = new AnilistThrottle(connection());
    const b = new AnilistThrottle(connection());
    try {
      await a.acquire();
      const background = startOpportunisticWork(() => b.acquire())!;
      await expect(background.promise).rejects.toMatchObject({ code: 'OPPORTUNISTIC_SKIPPED' });
    } finally {
      a.destroy();
      b.destroy();
    }
  });

  it('bounds work queues, removes aborts and expires waiting work after five seconds', async () => {
    const a = new RedisAddonWork(connection());
    const client = connection();
    const b = new RedisAddonWork(client);
    await occupy(a, 'full', 6);
    const evaluations = vi.spyOn(client, 'eval');
    const controller = new AbortController();
    const queued = Array.from({ length: 100 }, () =>
      b.acquire('full', controller.signal).catch((error: unknown) => error)
    );
    await expect(b.acquire('full')).rejects.toBeInstanceOf(AddonWorkLimitError);
    controller.abort();
    expect((await Promise.all(queued)).every((error) => error.name === 'AbortError')).toBe(true);
    await Promise.all(evaluations.mock.results.map((result) => result.value));
    await sleep(0);
    const started = Date.now();
    const waiting = expect(b.acquire('full')).rejects.toBeInstanceOf(AddonWorkLimitError);
    await sleep(4850);
    await inspector.sendCommand(['CLIENT', 'PAUSE', '300', 'ALL']);
    await waiting;
    expect(Date.now() - started).toBeGreaterThanOrEqual(4900);
    expect(Date.now() - started).toBeLessThan(5700);
    expect(client.shutdown.signal.aborted).toBe(false);
    const release = releases.shift()!;
    await release();
    releases.push(await b.acquire('full'));
  });

  it('renews long-running work and reclaims slots after a replica disappears', async () => {
    const client = connection();
    const a = new RedisAddonWork(client, 300);
    const b = new RedisAddonWork(connection(), 300);
    await occupy(a, 'lease', 6);
    await sleep(650);
    expect(await inspector.zCard(`${ADMISSION_PREFIX}addon:global`)).toBe(6);
    const abort = new AbortController();
    const pending = b.acquire('lease', abort.signal);
    await sleep(100);
    abort.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    client.close(); // No release, just like a killed replica.
    await sleep(400);
    await occupy(b, 'lease', 6);
    expect(await inspector.zCard(`${ADMISSION_PREFIX}addon:global`)).toBe(6);
  });

  it('fails closed on outages and observes failures from synchronous notification/release callers', async () => {
    const client = connection();
    const a = bucket(client);
    const work = new RedisAddonWork(client);
    const release = await work.acquire('outage');
    client.fail(new Error('simulated outage'));
    const mutation = a.notifyRateLimited(1000);
    const cleanup = release();
    await expect(mutation).rejects.toBeInstanceOf(SharedAdmissionError);
    await expect(cleanup).rejects.toBeInstanceOf(SharedAdmissionError);
    await expect(a.acquire()).rejects.toBeInstanceOf(SharedAdmissionError);
    await expect(work.acquire('outage')).rejects.toBeInstanceOf(SharedAdmissionError);
    expect(await inspector.zCard(`${ADMISSION_PREFIX}addon:global`)).toBe(1);
  });

  it('keeps the connection open when a caller stops waiting for a slow reply', async () => {
    const client = connection();
    await client.eval('return 1', [], []);
    const signal = client.shutdown.signal;
    await inspector.sendCommand(['CLIENT', 'PAUSE', '300', 'ALL']);
    const command = client.eval('return 1', [], []);
    const start = Date.now();
    await expect(
      admissionAwait(command, 30, signal, new SharedAdmissionError())
    ).rejects.toBeInstanceOf(SharedAdmissionError);
    expect(Date.now() - start).toBeLessThan(200);
    expect(signal.aborted).toBe(false);
    expect(await command).toBe(1);
    await expect(client.eval('return 1', [], [])).resolves.toBe(1);
    expect(client.shutdown.signal).toBe(signal);
  });

  it('does not retain grants after transient Redis command timeouts', async () => {
    const client = connection();
    const peerClient = connection();
    await client.eval('return 1', [], []);
    await peerClient.eval('return 1', [], []);
    const signal = client.shutdown.signal;
    const work = new RedisAddonWork(client);
    const peer = new RedisAddonWork(peerClient);
    releases.push(await work.acquire('active'));
    const evaluations = vi.spyOn(client, 'eval');
    const peerEvaluations = vi.spyOn(peerClient, 'eval');
    await inspector.sendCommand(['CLIENT', 'PAUSE', '1500', 'ALL']);
    const attempts = Array.from({ length: 6 }, (_, index) =>
      (index % 2 ? work : peer).acquire('timed-out')
    );
    await Promise.all(
      attempts.map((attempt) => expect(attempt).rejects.toBeInstanceOf(SharedAdmissionError))
    );
    expect(signal.aborted).toBe(false);
    await vi.waitFor(
      async () => {
        expect(evaluations.mock.calls.filter((call) => call[2][0] === 'release')).toHaveLength(3);
        expect(peerEvaluations.mock.calls.filter((call) => call[2][0] === 'release')).toHaveLength(
          3
        );
        expect(await inspector.zCard(`${ADMISSION_PREFIX}addon:global`)).toBe(1);
      },
      {
        interval: 20,
        timeout: 2000,
      }
    );
    expect(evaluations.mock.calls.filter((call) => call[2][0] === 'acquire')).toHaveLength(3);
    expect(peerEvaluations.mock.calls.filter((call) => call[2][0] === 'acquire')).toHaveLength(3);
    releases.push(await peer.acquire('timed-out'));
  });

  it('keeps delayed provider commands bounded until Redis replies', async () => {
    const client = connection();
    await client.eval('return 1', [], []);
    const signal = client.shutdown.signal;
    const tmdb = bucket(client);
    const anilist = new AnilistThrottle(client);
    try {
      await inspector.sendCommand(['CLIENT', 'PAUSE', '1500', 'ALL']);
      const attempts = [tmdb.acquire(), anilist.acquire()];
      await Promise.all(
        attempts.map((attempt) => expect(attempt).rejects.toBeInstanceOf(SharedAdmissionError))
      );
      expect(signal.aborted).toBe(false);
      expect(tmdb.getStats().queueDepth).toBe(1);
      await vi.waitFor(() => expect(tmdb.getStats().queueDepth).toBe(0), {
        interval: 20,
        timeout: 2000,
      });
      await expect(tmdb.acquire()).resolves.toBeUndefined();
    } finally {
      anilist.destroy();
    }
  });

  it('fails closed when a Redis command exceeds its hard deadline', async () => {
    const client = connection();
    await client.eval('return 1', [], []);
    const signal = client.shutdown.signal;
    await inspector.sendCommand(['CLIENT', 'PAUSE', '400', 'ALL']);
    const command = client.eval('return 1', [], [], 80);
    await expect(
      admissionAwait(command, 30, signal, new SharedAdmissionError())
    ).rejects.toBeInstanceOf(SharedAdmissionError);
    expect(signal.aborted).toBe(false);
    await expect(command).rejects.toBeInstanceOf(SharedAdmissionError);
    expect(signal.aborted).toBe(true);
    await expect(client.eval('return 1', [], [])).rejects.toBeInstanceOf(SharedAdmissionError);
    await sleep(450);
  });

  it('releases a grant whose Redis reply arrives after the requester aborted', async () => {
    const client = connection();
    await client.eval('return 1', [], []);
    const work = new RedisAddonWork(client);
    const evaluations = vi.spyOn(client, 'eval');
    await inspector.sendCommand(['CLIENT', 'PAUSE', '150', 'ALL']);
    const controller = new AbortController();
    const pending = work.acquire('aborted-in-flight', controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(await evaluations.mock.results[0].value).toBe(1);
    await vi.waitFor(() => expect(evaluations).toHaveBeenCalledTimes(2), {
      interval: 10,
      timeout: 1000,
    });
    expect(evaluations.mock.calls[1][2][0]).toBe('release');
    await evaluations.mock.results[1].value;
    expect(await inspector.keys(`${ADMISSION_PREFIX}addon:*`)).toEqual([]);
    releases.push(await work.acquire('aborted-in-flight'));
  });

  it('fails closed after a real socket outage; abandoned leases expire', async () => {
    const client = connection();
    const work = new RedisAddonWork(client, 150);
    releases.push(await work.acquire('disconnected'));
    await inspector.sendCommand(['CLIENT', 'KILL', 'TYPE', 'normal', 'SKIPME', 'yes']);
    await sleep(30);
    await expect(work.acquire('disconnected')).rejects.toBeInstanceOf(SharedAdmissionError);
    await sleep(200);
    expect(await inspector.keys(`${ADMISSION_PREFIX}addon:*`)).toEqual([]);
  });

  it('recovers addon and TMDB admission after a real socket outage', async () => {
    const addonClient = connection();
    const tmdbClient = connection();
    const work = new RedisAddonWork(addonClient);
    const throttle = bucket(tmdbClient);
    const release = await work.acquire('before-outage');
    await release();
    await throttle.acquire();
    const oldAddonSignal = addonClient.shutdown.signal;
    const oldTmdbSignal = tmdbClient.shutdown.signal;
    await inspector.sendCommand(['CLIENT', 'KILL', 'TYPE', 'normal', 'SKIPME', 'yes']);
    await sleep(30);
    expect(oldAddonSignal.aborted).toBe(true);
    expect(oldTmdbSignal.aborted).toBe(true);
    await expect(work.acquire('during-outage')).rejects.toBeInstanceOf(SharedAdmissionError);
    await expect(throttle.acquire()).rejects.toBeInstanceOf(SharedAdmissionError);

    await sleep(ADMISSION_RECOVERY_MS);
    releases.push(await work.acquire('after-outage'));
    await throttle.acquire();
    expect(addonClient.shutdown.signal).not.toBe(oldAddonSignal);
    expect(tmdbClient.shutdown.signal).not.toBe(oldTmdbSignal);
    expect(oldAddonSignal.aborted).toBe(true);
    expect(oldTmdbSignal.aborted).toBe(true);
  }, 10000);

  it('recovers both limiters on one connection after a sustained Redis stall', async () => {
    const client = connection();
    const work = new RedisAddonWork(client);
    const throttle = bucket(client);
    const before = await work.acquire('before-timeout');
    await before();
    await throttle.acquire();
    const oldSignal = client.shutdown.signal;
    await inspector.sendCommand(['CLIENT', 'PAUSE', '2500', 'ALL']);
    await expect(throttle.notifyRateLimited(1000)).rejects.toBeInstanceOf(SharedAdmissionError);
    expect(oldSignal.aborted).toBe(true);
    await expect(work.acquire('during-cooldown')).rejects.toBeInstanceOf(SharedAdmissionError);
    await expect(throttle.acquire()).rejects.toBeInstanceOf(SharedAdmissionError);

    await sleep(ADMISSION_RECOVERY_MS);
    const [release] = await Promise.all([work.acquire('after-timeout'), throttle.acquire()]);
    releases.push(release);
    expect(client.shutdown.signal).not.toBe(oldSignal);
    expect(client.shutdown.signal.aborted).toBe(false);
    expect(oldSignal.aborted).toBe(true);
  }, 12000);

  it('aborts active request contexts when renewal loses a lease, without resurrecting it', async () => {
    const client = connection();
    const work = new RedisAddonWork(client, 300);
    const app = express();
    app.use(requestIdMiddleware());
    app.get('/', async (_req, res) => {
      const release = await work.acquire('renewal-failure');
      const signal = getRequestSignal()!;
      await inspector.del(`${ADMISSION_PREFIX}addon:global`);
      await sleep(250);
      expect(signal.aborted).toBe(true);
      expect(signal.reason).toBeInstanceOf(SharedAdmissionError);
      await expect(work.acquire('next')).rejects.toBeInstanceOf(SharedAdmissionError);
      await expect(release()).resolves.toBeUndefined();
      expect(sendAddonWorkLimit(signal.reason, res)).toBe(true);
    });
    const response = await request(app).get('/').timeout(1000);
    expect(response.status, response.text).toBe(503);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.policy).toBe('addonWork');
    await sleep(150);
    expect(await inspector.keys(`${ADMISSION_PREFIX}addon:*`)).toEqual([]);
  });

  it('uses Redis time and rejects renewal of an expired lease without resurrecting it', async () => {
    const client = connection();
    const keys = [`${ADMISSION_PREFIX}addon:global`, `${ADMISSION_PREFIX}addon:user:test`];
    const args = ['acquire', 'dead', '50', '60', '6'];
    expect(await client.eval(ADDON_WORK_SCRIPT, keys, args)).toBe(1);
    await sleep(80);
    expect(await client.eval(ADDON_WORK_SCRIPT, keys, ['renew', ...args.slice(1)])).toBe(-1);
    expect(await inspector.exists(keys)).toBe(0);
    expect(TMDB_BUDGET_SCRIPT).toContain("redis.call('TIME')");
  });
});

describe('admission wait cleanup without Redis', () => {
  it('bounds AniList waiters and releases all of them at shutdown', async () => {
    const throttle = new AnilistThrottle();
    await throttle.pause(60_000);
    const waiting = Array.from({ length: 100 }, () => throttle.acquire().catch((error) => error));
    await expect(throttle.acquire()).rejects.toMatchObject({
      statusCode: 429,
      rateLimitExhausted: true,
    });
    throttle.destroy();
    const results = await Promise.all(waiting);
    expect(results).toHaveLength(100);
    results.forEach((error) => expect(error.message).toBe('AniList admission shutting down'));
    await expect(throttle.acquire()).rejects.toThrow('shutting down');
  });

  it('rejects an already aborted signal and an in-flight wait', async () => {
    const controller = new AbortController();
    const pending = admissionDelay(5000, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await expect(admissionDelay(5000, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
