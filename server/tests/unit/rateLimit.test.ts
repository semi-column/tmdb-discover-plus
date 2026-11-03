import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { ipKeyGenerator } from 'express-rate-limit';
import type { Server } from 'node:http';

vi.mock('../../src/config.ts', () => ({
  config: {
    nodeEnv: 'production',
    features: { disableRateLimit: false },
    cache: { redisUrl: '' },
    logging: { level: 'error', format: 'text' },
  },
}));

import {
  apiRateLimit,
  addonRateLimit,
  addonUserRateLimit,
  invalidAddonRateLimit,
  checkInvalidAddonRateLimit,
} from '../../src/utils/rateLimit.ts';

const ip = '198.51.100.10';
const loadConfig = vi.fn((userId: string) => userId.startsWith('valid'));
const servers: Server[] = [];

async function app() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(apiRateLimit);
  app.get('/api/test', (_req, res) => res.json({ ok: true }));
  const router = express.Router();
  router.use(addonRateLimit, checkInvalidAddonRateLimit);
  router.use('/:userId', (req, res, next) => {
    if (!loadConfig(req.params.userId)) return invalidAddonRateLimit(req, res, next);
    return addonUserRateLimit(req, res, next);
  });
  router.get('/:userId/catalog/:type/:id.json', (_req, res) => res.json({ metas: [] }));
  app.use(router);
  const server = app.listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  return server;
}

async function burst(server: Server, path: string, count: number, address = ip) {
  const responses = [];
  for (let sent = 0; sent < count; sent += 50) {
    responses.push(
      ...(await Promise.all(
        Array.from({ length: Math.min(50, count - sent) }, () =>
          request(server).get(path).set('X-Forwarded-For', address)
        )
      ))
    );
  }
  return responses;
}

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve()))
          )
      )
  );
  for (const address of [ip, '2001:db8:1234:5600::1']) {
    for (const limiter of [apiRateLimit, addonRateLimit, invalidAddonRateLimit]) {
      limiter.resetKey(ipKeyGenerator(address));
    }
  }
  for (const userId of ['valid-a', 'valid-b', 'valid-c', 'valid-ipv6']) {
    addonUserRateLimit.resetKey(userId);
  }
  loadConfig.mockClear();
});

describe('request rate policies', () => {
  it('allows a 600-request addon burst without consuming the 300-request API budget', async () => {
    const server = await app();
    const responses = await burst(server, '/valid-a/catalog/movie/test.json', 600);
    expect(
      responses
        .filter((response) => response.status !== 200)
        .map((response) => ({ status: response.status, body: response.body }))
    ).toEqual([]);
    const aliases = await burst(server, '/valid-a/CATALOG/movie/test.json/', 301);
    expect(aliases.filter((response) => response.status !== 200)).toEqual([]);
    const api = await burst(server, '/api/test', 301);
    expect(api.filter((response) => response.status === 200)).toHaveLength(300);
    expect(api.at(-1)?.body.policy).toBe('api');
  });

  it('limits a user at 1000 while allowing another user behind the same IP', async () => {
    const server = await app();
    const responses = await burst(server, '/valid-a/catalog/movie/test.json', 1001);
    expect(responses.filter((response) => response.status === 200)).toHaveLength(1000);
    const rejected = responses.find((response) => response.status === 429)!;
    expect(rejected.body.policy).toBe('addonUser');
    expect(rejected.headers['cache-control']).toBe('no-store');
    expect(Number(rejected.headers['retry-after'])).toBeGreaterThan(0);
    expect(rejected.body.retryAfter).toBe(Number(rejected.headers['retry-after']));
    expect(
      (await burst(server, '/valid-b/catalog/movie/test.json', 600))
        .filter((response) => response.status !== 200)
        .map((response) => ({ status: response.status, body: response.body }))
    ).toEqual([]);
  });

  it('enforces the 3000/IP ceiling even when users rotate', async () => {
    const server = await app();
    for (const userId of ['valid-a', 'valid-b', 'valid-c']) {
      expect(
        (await burst(server, `/${userId}/catalog/movie/test.json`, 1000))
          .filter((response) => response.status !== 200)
          .map((response) => ({ status: response.status, body: response.body }))
      ).toEqual([]);
    }
    const response = await request(server)
      .get('/valid-a/catalog/movie/test.json')
      .set('X-Forwarded-For', ip);
    expect(response.status).toBe(429);
    expect(response.body.policy).toBe('addonIp');
    expect(loadConfig).toHaveBeenCalledTimes(3000);
  }, 30_000);

  it('blocks ID rotation before storage after 30 missing-ID lookups', async () => {
    const server = await app();
    for (let i = 0; i < 30; i++) {
      const response = await request(server)
        .get(`/missing-${i}/catalog/movie/test.json`)
        .set('X-Forwarded-For', ip);
      expect(response.status).toBe(200);
    }
    const response = await request(server)
      .get('/missing-next/catalog/movie/test.json')
      .set('X-Forwarded-For', ip);
    expect(response.status).toBe(429);
    expect(response.body.policy).toBe('addonInvalid');
    expect(loadConfig).toHaveBeenCalledTimes(30);
  });

  it('groups rotating IPv6 addresses by subnet', async () => {
    const server = await app();
    await burst(server, '/valid-ipv6/catalog/movie/test.json', 30, '2001:db8:1234:5600::1');
    for (let i = 0; i < 30; i++) {
      await request(server)
        .get(`/missing-${i}/catalog/movie/test.json`)
        .set('X-Forwarded-For', `2001:db8:1234:5600::${i + 1}`);
    }
    const response = await request(server)
      .get('/missing-next/catalog/movie/test.json')
      .set('X-Forwarded-For', '2001:db8:1234:5600::ffff');
    expect(response.status).toBe(429);
    expect(response.body.policy).toBe('addonInvalid');
  });
});
