import { afterEach, describe, expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient, type RedisClientType } from 'redis';
import jwt from 'jsonwebtoken';
import { RedisRevocationStore } from '../../src/infrastructure/revocationStore.ts';
import { RedisLiveStore } from '../../src/services/observability/liveStore.ts';
import { awaitRedisCommand, redisRecoveryOptions } from '../../src/utils/redisConnection.ts';

const binary = process.env.ADMISSION_REDIS_SERVER || 'redis-server';
const available = spawnSync(binary, ['--version'], { stdio: 'ignore' }).status === 0;
const secret = 'isolated-test-only-jwt-secret-32-characters';
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function waitFor(check: () => boolean | Promise<boolean>, description: string, ms = 10_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch {
      // The private test server may not be listening yet.
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function stopChild(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null || child.signalCode !== null) return child.exitCode;
  child.kill('SIGCONT');
  const exited = new Promise<number | null>((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      exited,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          child.kill('SIGKILL');
          reject(new Error('Private test process did not stop'));
        }, 8_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

describe.skipIf(!available || process.platform === 'win32')(
  'isolated Redis startup and recovery',
  () => {
    let directory: string;
    let blocker: Server | undefined;
    let sockets: Set<Socket>;
    let redis: ChildProcess | undefined;
    let app: ChildProcess | undefined;
    const extraApps: ChildProcess[] = [];
    const extraRedis: ChildProcess[] = [];
    let inspector: RedisClientType | undefined;
    let appOutput = '';
    let baseUrl = '';

    async function blockRedis(): Promise<number> {
      sockets = new Set();
      blocker = createServer((socket) => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
      });
      await new Promise<void>((resolve) => blocker!.listen(0, '127.0.0.1', resolve));
      return (blocker.address() as { port: number }).port;
    }

    async function unblockRedis(): Promise<void> {
      if (!blocker) return;
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => blocker!.close(() => resolve()));
      blocker = undefined;
    }

    async function startRedis(port: number): Promise<void> {
      redis = spawn(
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
        { stdio: ['ignore', 'pipe', 'pipe'] }
      );
      let output = '';
      redis.stdout?.on('data', (data) => (output += data.toString()));
      redis.stderr?.on('data', (data) => (output += data.toString()));
      await waitFor(() => output.includes('Ready to accept connections'), 'private Redis');
      expect(redis.exitCode).toBeNull();
      inspector = createClient({
        url: `redis://127.0.0.1:${port}`,
        socket: { reconnectStrategy: false, connectTimeout: 500 },
      });
      inspector.on('error', () => {});
      await inspector.connect();
      expect(await inspector.ping()).toBe('PONG');
    }

    async function startApp(
      redisPort: number,
      ratingsEnabled = false,
      adminEnabled = false,
      observabilityPort?: number,
      tmdbValidation = false
    ): Promise<void> {
      const port = await freePort();
      baseUrl = `http://127.0.0.1:${port}`;
      appOutput = '';
      const entry = pathToFileURL(resolve('src/index.ts')).href;
      const script = `
        globalThis.fetch = async (input) => {
          const url = new URL(String(input));
          if (${tmdbValidation} && url.hostname === 'api.themoviedb.org' && url.pathname === '/3/configuration') {
            return new Response(JSON.stringify({ images: {}, change_keys: [] }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
          throw new Error('External requests disabled in test');
        };
        await import(${JSON.stringify(entry)});
      `;
      app = spawn(
        process.execPath,
        ['--experimental-strip-types', '--input-type=module', '-e', script],
        {
          cwd: directory,
          env: {
            PATH: process.env.PATH || '',
            HOME: directory,
            NODE_ENV: 'production',
            PORT: String(port),
            REDIS_URL: `redis://127.0.0.1:${redisPort}`,
            OBS_REDIS_URL: observabilityPort ? `redis://127.0.0.1:${observabilityPort}` : '',
            CACHE_DRIVER: 'redis',
            DATABASE_DRIVER: 'memory',
            JWT_SECRET: secret,
            ENCRYPTION_KEY: 'a'.repeat(64),
            IMDB_RATINGS_DISABLED: ratingsEnabled ? 'false' : 'true',
            ADMIN_USERNAME: adminEnabled ? 'isolated-admin' : '',
            ADMIN_PASSWORD: adminEnabled ? 'isolated-admin-password' : '',
            ADDON_VARIANT: 'nightly',
            LOG_LEVEL: 'info',
            TRUST_PROXY: '0',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      );
      app.stdout?.on('data', (data) => (appOutput = (appOutput + data.toString()).slice(-30_000)));
      app.stderr?.on('data', (data) => (appOutput = (appOutput + data.toString()).slice(-30_000)));
      await waitFor(() => appOutput.includes('TMDB Discover+ running at'), 'application startup');
      expect(app.exitCode, appOutput).toBeNull();
    }

    async function request(path: string, token?: string, method = 'GET', origin = baseUrl) {
      const response = await fetch(`${origin}${path}`, {
        method,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        signal: AbortSignal.timeout(3_000),
      });
      return {
        status: response.status,
        body: await response.json(),
        cacheControl: response.headers.get('cache-control'),
      };
    }

    function token(jti: string): string {
      return jwt.sign({ apiKeyId: 'isolated-test', jti }, secret, { expiresIn: '1h' });
    }

    function adminLogin() {
      return fetch(`${baseUrl}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Request': '1' },
        body: JSON.stringify({ username: 'isolated-admin', password: 'isolated-admin-password' }),
        signal: AbortSignal.timeout(3_000),
      });
    }

    function adminRequest(path: string, cookie: string, method = 'GET') {
      return fetch(`${baseUrl}/api/admin/${path}`, {
        method,
        headers: { Cookie: cookie, 'X-Admin-Request': '1' },
        signal: AbortSignal.timeout(3_000),
      });
    }

    afterEach(async () => {
      if (inspector?.isOpen) inspector.destroy();
      inspector = undefined;
      const failures: unknown[] = [];
      for (const child of [app, ...extraApps.splice(0), ...extraRedis.splice(0), redis]) {
        if (!child) continue;
        try {
          await stopChild(child);
        } catch (error) {
          failures.push(error);
        }
      }
      app = undefined;
      redis = undefined;
      await unblockRedis();
      if (directory) rmSync(directory, { recursive: true, force: true });
      if (failures.length) throw new AggregateError(failures, 'Private test cleanup failed');
    });

    it('starts against a stalled Redis socket, stays fail-closed, and recovers', async () => {
      directory = mkdtempSync(join(tmpdir(), 'tmdb-redis-startup-'));
      const redisPort = await blockRedis();
      await startApp(redisPort);

      expect(await request('/health')).toMatchObject({
        status: 200,
        body: {
          status: 'degraded',
          cache: { driver: 'memory', degraded: true },
          rateLimit: { driver: 'memory', degraded: true },
          jwtRevocation: { driver: 'redis', connected: false },
        },
      });
      expect(await request('/ready')).toMatchObject({
        status: 503,
        body: { reason: 'revocation_store_unavailable' },
      });
      expect(await request('/api/auth/verify', token('startup-check'))).toMatchObject({
        status: 503,
        body: { code: 'AUTH_UNAVAILABLE' },
        cacheControl: 'no-store',
      });
      expect(await request('/api/auth/logout', token('startup-logout'), 'POST')).toMatchObject({
        status: 503,
        body: { code: 'AUTH_UNAVAILABLE' },
      });

      await unblockRedis();
      await startRedis(redisPort);
      await waitFor(async () => (await request('/ready')).status === 200, 'revocation recovery');
      expect(await request('/health')).toMatchObject({
        status: 200,
        body: {
          status: 'degraded',
          cache: { driver: 'memory', degraded: true },
          rateLimit: { driver: 'memory', degraded: true },
          jwtRevocation: { driver: 'redis', connected: true },
        },
      });

      await inspector!.set('jwt:revoked:shared-token', '1', { EX: 3600 });
      expect(await request('/api/auth/verify', token('shared-token'))).toMatchObject({
        status: 401,
        body: { error: 'Invalid or expired token' },
      });
      const primaryApp = app!;
      const primaryUrl = baseUrl;
      extraApps.push(primaryApp);
      await startApp(redisPort);
      const replicaUrl = baseUrl;
      extraApps.splice(extraApps.indexOf(primaryApp), 1, app!);
      app = primaryApp;
      baseUrl = primaryUrl;
      const loggedOut = token('successful-logout');
      expect(await request('/api/auth/logout', loggedOut, 'POST')).toMatchObject({
        status: 200,
        body: { success: true },
      });
      expect(await inspector!.exists('jwt:revoked:successful-logout')).toBe(1);
      expect(await request('/api/auth/verify', loggedOut, 'GET', replicaUrl)).toMatchObject({
        status: 401,
        body: { error: 'Invalid or expired token' },
      });
      for (let i = 0; i < 28; i++) expect((await request('/health')).status).toBe(200);
      expect(await request('/health')).toMatchObject({
        status: 429,
        body: { policy: 'monitoring' },
      });
      expect((await request('/ready')).status).toBe(200);
      expect(await stopChild(app!)).toBe(0);
      app = undefined;
    }, 30_000);

    it('keeps probes responsive through a runtime stall and reconnects after socket closes', async () => {
      directory = mkdtempSync(join(tmpdir(), 'tmdb-redis-recovery-'));
      const redisPort = await freePort();
      await startRedis(redisPort);
      await startApp(redisPort);
      await waitFor(async () => (await request('/ready')).status === 200, 'initial readiness');
      expect(await request('/health')).toMatchObject({
        status: 200,
        body: {
          status: 'ok',
          cache: { driver: 'redis', degraded: false },
          rateLimit: { driver: 'redis', connected: true },
        },
      });
      await inspector!.set('jwt:revoked:retained-token', '1', { EX: 3600 });

      expect(redis!.kill('SIGSTOP')).toBe(true);
      expect(await request('/api/auth/logout', token('stalled-rate'), 'POST')).toMatchObject({
        status: 503,
        body: { code: 'RATE_LIMIT_UNAVAILABLE' },
      });
      await waitFor(async () => (await request('/ready')).status === 503, 'outage readiness');
      expect(await request('/health')).toMatchObject({ status: 200, body: { status: 'degraded' } });
      const failedLogout = await request('/api/auth/logout', token('retry-logout'), 'POST');
      expect(failedLogout.status).toBe(503);
      expect(redis!.kill('SIGCONT')).toBe(true);
      await waitFor(async () => (await request('/ready')).status === 200, 'runtime recovery');
      expect(await inspector!.exists('jwt:revoked:retry-logout')).toBe(0);
      expect(await request('/api/auth/verify', token('retained-token'))).toMatchObject({
        status: 401,
        body: { error: 'Invalid or expired token' },
      });
      expect(await request('/api/auth/logout', token('retry-logout'), 'POST')).toMatchObject({
        status: 200,
        body: { success: true },
      });
      expect(await inspector!.exists('jwt:revoked:retry-logout')).toBe(1);

      const previousClosures = appOutput.split('Socket closed unexpectedly').length;
      expect(
        await inspector!.sendCommand(['CLIENT', 'KILL', 'TYPE', 'normal', 'SKIPME', 'yes'])
      ).toBeGreaterThan(0);
      await waitFor(
        () => appOutput.split('Socket closed unexpectedly').length > previousClosures,
        'socket close detection'
      );
      await waitFor(async () => (await request('/ready')).status === 200, 'socket reconnection');
      expect(app!.exitCode, appOutput).toBeNull();
      expect(await request('/api/auth/verify', token('retained-token'))).toMatchObject({
        status: 401,
      });
      await inspector!.sendCommand(['SCRIPT', 'FLUSH']);
      expect(
        await request('/api/auth/logout', token('script-flush-recovery'), 'POST')
      ).toMatchObject({
        status: 200,
        body: { success: true },
      });
      expect(await inspector!.exists('jwt:revoked:script-flush-recovery')).toBe(1);
      expect(await request('/health')).toMatchObject({
        status: 200,
        body: { rateLimit: { driver: 'redis', connected: true } },
      });
      expect(appOutput).not.toContain('Uncaught exception');
      expect(appOutput).not.toContain('Unhandled rejection');
    }, 30_000);

    it('keeps admin sessions fail-closed while observability starts and reconnects', async () => {
      directory = mkdtempSync(join(tmpdir(), 'tmdb-redis-admin-'));
      const redisPort = await blockRedis();
      await startApp(redisPort, false, true);
      await waitFor(() => appOutput.includes('Observability started'), 'observability startup');

      expect((await adminLogin()).status).toBe(503);
      expect((await request('/api/auth/verify')).status).toBe(401);
      await waitFor(() => appOutput.includes('Live store flush failed'), 'bounded live flush');
      expect(app!.exitCode, appOutput).toBeNull();

      await unblockRedis();
      await startRedis(redisPort);
      await waitFor(
        () => appOutput.includes('Connected to Redis live store'),
        'live store recovery'
      );
      const response = await adminLogin();
      expect(response.status).toBe(200);
      const cookie = response.headers.get('set-cookie')?.split(';')[0];
      if (!cookie) throw new Error('Expected an admin session cookie');
      expect((await adminRequest('logout', cookie, 'POST')).status).toBe(200);
      expect((await adminRequest('meta', cookie)).status).toBe(401);
    }, 30_000);

    it('bounds two real client queues at the production cap and recovers from a blackhole', async () => {
      directory = mkdtempSync(join(tmpdir(), 'tmdb-redis-backlog-'));
      const redisPort = await blockRedis();
      const received: string[] = [];
      blocker!.on('connection', (socket) => {
        const index = received.push('') - 1;
        socket.on('data', (data) => (received[index] += data.toString()));
      });
      const clients = Array.from({ length: 2 }, () =>
        createClient({
          url: `redis://127.0.0.1:${redisPort}`,
          RESP: 2,
          disableClientInfo: true,
          disableOfflineQueue: true,
          ...redisRecoveryOptions(),
        })
      );
      const errors = clients.map(() => [] as string[]);
      clients.forEach((client, index) =>
        client.on('error', (error: Error) => errors[index].push(error.message))
      );
      try {
        await Promise.all(clients.map((client) => client.connect()));
        const results = await Promise.all(
          clients.map((client) =>
            Promise.all(
              Array.from({ length: 2_000 }, () =>
                awaitRedisCommand(client.get('blackhole')).then(
                  () => 'unexpected success',
                  (error: Error) => error.message
                )
              )
            )
          )
        );
        for (const result of results) {
          expect(result.filter((message) => message === 'The queue is full')).toHaveLength(1_000);
          expect(result.filter((message) => message === 'Redis command timed out')).toHaveLength(
            1_000
          );
        }
        await waitFor(
          () => errors.every((list) => list.some((message) => message.includes('Socket timeout'))),
          'both blackholed clients to reconnect'
        );
        for (const payload of received.slice(0, 2)) {
          expect(payload.match(/\r\nGET\r\n/g)).toHaveLength(1_000);
        }

        await unblockRedis();
        await startRedis(redisPort);
        await waitFor(
          async () =>
            (await Promise.all(clients.map((client) => awaitRedisCommand(client.ping())))).every(
              (reply) => reply === 'PONG'
            ),
          'both bounded clients to recover'
        );
        await clients[0].set('after-blackhole', 'retained');
        expect(await clients[1].get('after-blackhole')).toBe('retained');
        const payload = 'x'.repeat(16_384);
        await Promise.all(
          clients.map((client, replica) =>
            Promise.all(
              Array.from({ length: 60 }, async (_, worker) => {
                const key = `healthy:${replica}:${worker}`;
                for (let iteration = 0; iteration < 20; iteration++) {
                  await awaitRedisCommand(client.set(key, payload));
                  expect(await awaitRedisCommand(client.get(key))).toBe(payload);
                }
              })
            )
          )
        );
      } finally {
        clients.forEach((client) => {
          if (client.isOpen) client.destroy();
        });
      }
    }, 20_000);

    it('keeps two servers alive through a 30-second stall and three Redis restarts', async () => {
      directory = mkdtempSync(join(tmpdir(), 'tmdb-redis-two-servers-'));
      const redisPort = await freePort();
      await startRedis(redisPort);
      await startApp(redisPort, false, false, undefined, true);
      const firstApp = app!;
      const firstUrl = baseUrl;
      extraApps.push(firstApp);
      await startApp(redisPort, false, false, undefined, true);
      const origins = [firstUrl, baseUrl];
      await waitFor(
        async () =>
          (
            await Promise.all(origins.map((origin) => request('/ready', undefined, 'GET', origin)))
          ).every(({ status }) => status === 200),
        'both replicas ready'
      );

      const sessions: string[] = [];
      for (const origin of origins) {
        const login = await fetch(`${origin}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey: 'b'.repeat(32) }),
          signal: AbortSignal.timeout(3_000),
        });
        expect(login.status).toBe(200);
        const body = await login.json();
        expect(typeof body.token).toBe('string');
        sessions.push(body.token);
      }
      const [victim, survivor] = sessions;
      const victimClaims = jwt.verify(victim, secret);
      if (typeof victimClaims === 'string') throw new Error('Expected JWT claims');
      const forged = jwt.sign(
        { jti: victimClaims.jti, exp: Math.floor(Date.now() / 1000) + 10 * 365 * 86_400 },
        'unrelated-test-key'
      );
      expect((await request('/api/auth/logout', forged, 'POST', firstUrl)).status).toBe(200);
      expect(await inspector!.exists(`jwt:revoked:${victimClaims.jti}`)).toBe(0);
      expect((await request('/api/auth/verify', victim)).status).toBe(200);
      const expired = jwt.sign({ jti: 'expired-token' }, secret, { expiresIn: -1 });
      expect((await request('/api/auth/logout', expired, 'POST')).status).toBe(200);
      expect(await inspector!.exists('jwt:revoked:expired-token')).toBe(0);
      expect((await request('/api/auth/logout', victim, 'POST', firstUrl)).status).toBe(200);
      expect((await request('/api/auth/verify', victim)).status).toBe(401);

      expect(redis!.kill('SIGSTOP')).toBe(true);
      const stalledAt = Date.now();
      const stalled = await Promise.all(
        origins.map((origin) =>
          request('/api/auth/logout', token('two-replica-stall'), 'POST', origin)
        )
      );
      expect(stalled.map(({ status }) => status)).toEqual([503, 503]);
      expect(Date.now() - stalledAt).toBeLessThan(3_000);
      await waitFor(
        async () =>
          (
            await Promise.all(origins.map((origin) => request('/ready', undefined, 'GET', origin)))
          ).every(({ status }) => status === 503),
        'both replicas to become unready'
      );
      for (let interval = 0; interval < 5; interval++) {
        await sleep(6_000);
        for (const origin of origins) {
          expect((await request('/ready', undefined, 'GET', origin)).status).toBe(503);
          expect(await request('/health', undefined, 'GET', origin)).toMatchObject({
            status: 200,
            body: { status: 'degraded' },
          });
        }
        expect(firstApp.exitCode, appOutput).toBeNull();
        expect(app!.exitCode, appOutput).toBeNull();
      }
      expect(redis!.kill('SIGCONT')).toBe(true);
      await waitFor(
        async () =>
          (
            await Promise.all(origins.map((origin) => request('/ready', undefined, 'GET', origin)))
          ).every(({ status }) => status === 200),
        'both replicas to recover after a prolonged stall'
      );

      for (let cycle = 0; cycle < 3; cycle++) {
        // Explicitly preserve revocations; a restart without persistence loses them by design.
        await inspector!.sendCommand(['SAVE']);
        inspector!.destroy();
        inspector = undefined;
        await stopChild(redis!);
        redis = undefined;
        await waitFor(
          async () =>
            (
              await Promise.all(
                origins.map((origin) => request('/ready', undefined, 'GET', origin))
              )
            ).every(({ status }) => status === 503),
          'both replicas to detect a stopped Redis'
        );
        await startRedis(redisPort);
        await waitFor(
          async () =>
            (
              await Promise.all(
                origins.map((origin) => request('/ready', undefined, 'GET', origin))
              )
            ).every(({ status }) => status === 200),
          'both replicas to recover after restart'
        );
        for (const origin of origins) {
          expect((await request('/api/auth/verify', victim, 'GET', origin)).status).toBe(401);
          await waitFor(async () => {
            // Readiness does not wait for cache reconnects or the admission recovery cooldown.
            await sleep(250);
            return (await request('/api/auth/verify', survivor, 'GET', origin)).status === 200;
          }, 'valid session recovery after restart');
        }
        expect(firstApp.exitCode, appOutput).toBeNull();
        expect(app!.exitCode, appOutput).toBeNull();
      }
      expect(appOutput).not.toContain('Uncaught exception');
      expect(appOutput).not.toContain('Unhandled rejection');
      await inspector!.sendCommand(['CONFIG', 'SET', 'maxmemory-policy', 'noeviction']);
      await inspector!.sendCommand(['CONFIG', 'SET', 'maxmemory', '1']);
      try {
        for (const origin of origins) {
          expect((await request('/api/auth/logout', survivor, 'POST', origin)).status).toBe(503);
          // Transport readiness does not detect Redis rejecting writes under memory pressure.
          expect((await request('/ready', undefined, 'GET', origin)).status).toBe(200);
        }
      } finally {
        await inspector!.sendCommand(['CONFIG', 'SET', 'maxmemory', '0']);
      }
      for (const origin of origins) {
        expect((await request('/api/auth/verify', survivor, 'GET', origin)).status).toBe(200);
      }
      expect(redis!.kill('SIGSTOP')).toBe(true);
      const shutdownAt = Date.now();
      expect(await Promise.all([stopChild(firstApp), stopChild(app!)])).toEqual([0, 0]);
      expect(Date.now() - shutdownAt).toBeLessThan(8_000);
      app = undefined;
      extraApps.splice(extraApps.indexOf(firstApp), 1);
      expect(appOutput).not.toContain('Shutdown timeout reached');
    }, 90_000);

    it('keeps addon readiness independent of a dedicated admin Redis outage', async () => {
      directory = mkdtempSync(join(tmpdir(), 'tmdb-redis-dedicated-'));
      const observabilityPort = await blockRedis();
      const mainPort = await freePort();
      await startRedis(mainPort);
      await startApp(mainPort, false, true, observabilityPort);
      await waitFor(async () => (await request('/ready')).status === 200, 'addon readiness');
      expect(await request('/health')).toMatchObject({
        status: 200,
        body: {
          status: 'degraded',
          observability: { enabled: true, driver: 'redis', connected: false },
        },
      });
      expect((await adminLogin()).status).toBe(503);
      const userToken = token('dedicated-outage');
      expect((await request('/api/auth/logout', userToken, 'POST')).status).toBe(200);
      expect((await request('/api/auth/verify', userToken)).status).toBe(401);

      extraRedis.push(redis!);
      inspector!.destroy();
      inspector = undefined;
      await unblockRedis();
      await startRedis(observabilityPort);
      await waitFor(() => appOutput.includes('Connected to Redis live store'), 'admin recovery');
      expect(await request('/health')).toMatchObject({
        body: { status: 'ok', observability: { connected: true } },
      });
      const login = await adminLogin();
      expect(login.status).toBe(200);
      const cookie = login.headers.get('set-cookie')?.split(';')[0];
      if (!cookie) throw new Error('Expected an admin session cookie');

      const connections = appOutput.split('Connected to Redis live store').length;
      expect(redis!.kill('SIGSTOP')).toBe(true);
      const failedLogout = await adminRequest('logout', cookie, 'POST');
      expect([500, 503]).toContain(failedLogout.status);
      expect(failedLogout.headers.get('set-cookie')).toBeNull();
      await waitFor(() => appOutput.includes('Socket timeout timeout'), 'admin Redis stall');
      expect(await request('/health')).toMatchObject({
        body: { status: 'degraded', observability: { connected: false } },
      });
      expect((await request('/ready')).status).toBe(200);
      expect((await adminRequest('meta', cookie)).status).toBe(503);

      expect(redis!.kill('SIGCONT')).toBe(true);
      await waitFor(
        () => appOutput.split('Connected to Redis live store').length > connections,
        'admin Redis reconnection'
      );
      // A timed-out revocation may still have reached Redis.
      expect([200, 401]).toContain((await adminRequest('meta', cookie)).status);
      expect((await adminRequest('logout', cookie, 'POST')).status).toBe(200);
      expect((await adminRequest('meta', cookie)).status).toBe(401);
    }, 30_000);

    it('bounds live-store transactions during a runtime stall and reconnects', async () => {
      directory = mkdtempSync(join(tmpdir(), 'tmdb-redis-live-'));
      const redisPort = await freePort();
      await startRedis(redisPort);
      const live = new RedisLiveStore(`redis://127.0.0.1:${redisPort}`);
      const revocations = new RedisRevocationStore(`redis://127.0.0.1:${redisPort}`);
      const batch = {
        minutes: new Map([[0, new Map([['req', 1]])]]),
        hours: new Map(),
        users: new Map(),
        tail: [],
      };
      try {
        await Promise.all([live.connect(), revocations.connect()]);
        expect(redis!.kill('SIGSTOP')).toBe(true);
        const revoked = expect(
          revocations.add('stalled-token', Date.now() + 60_000)
        ).rejects.toThrow('Redis command timed out');
        const result = live.apply(batch, 3600).then(
          () => 'fulfilled',
          () => 'rejected'
        );
        expect(await Promise.race([result, sleep(7_000).then(() => 'hung')])).toBe('rejected');
        await revoked;
        await waitFor(() => !live.isReady, 'live socket stall detection');
        await expect(live.incr('admin:fail:test', 60)).rejects.toThrow(
          'Observability Redis unavailable'
        );
        expect(redis!.kill('SIGCONT')).toBe(true);
        await waitFor(() => live.isReady && revocations.isReady, 'Redis transaction recovery');
        await revocations.add('stalled-token', Date.now() + 60_000);
        expect(await revocations.has('stalled-token')).toBe(true);
        await live.setFlag('admin:revoked:test', 60);
        expect(await live.hasFlag('admin:revoked:test')).toBe(true);
        await live.apply(batch, 3600);
      } finally {
        await Promise.all([live.close(), revocations.destroy()]);
      }
    }, 20_000);

    it('shuts down cleanly while the revocation connection is still pending', async () => {
      directory = mkdtempSync(join(tmpdir(), 'tmdb-redis-shutdown-'));
      const redisPort = await blockRedis();
      await startApp(redisPort, true);
      expect(await request('/ready')).toMatchObject({ status: 503 });
      await sleep(2_500);
      expect(appOutput).not.toContain('Downloading IMDb ratings dataset');
      const started = Date.now();
      expect(await stopChild(app!)).toBe(0);
      expect(Date.now() - started).toBeLessThan(8_000);
      app = undefined;
    }, 20_000);

    it('recovers rate-limit script initialization without reconnecting the socket', async () => {
      directory = mkdtempSync(join(tmpdir(), 'tmdb-redis-script-'));
      const redisPort = await freePort();
      await startRedis(redisPort);
      await inspector!.sendCommand(['ACL', 'SETUSER', 'default', '-script|load']);
      await startApp(redisPort);
      await waitFor(() => appOutput.includes('Redis rate-limit command failed'), 'script failure');

      expect(await request('/api/auth/logout', token('script-recovery'), 'POST')).toMatchObject({
        status: 503,
        body: { code: 'RATE_LIMIT_UNAVAILABLE' },
      });
      await inspector!.sendCommand(['ACL', 'SETUSER', 'default', '+script|load']);
      expect(await request('/api/auth/logout', token('script-recovery'), 'POST')).toMatchObject({
        status: 200,
        body: { success: true },
      });
      expect(await inspector!.exists('jwt:revoked:script-recovery')).toBe(1);
      expect(appOutput).not.toContain('Socket closed unexpectedly');
    }, 20_000);
  }
);
