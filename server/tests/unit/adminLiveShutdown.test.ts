import { get, type IncomingMessage, type Server } from 'node:http';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

let server: Server | undefined;
beforeEach(() => {
  vi.resetModules();
  for (const [name, value] of Object.entries({
    ADMIN_USERNAME: 'shutdown-fixture',
    ADMIN_PASSWORD: 'shutdown-fixture-password',
    ADMIN_PASSWORD_HASH: '',
    REDIS_URL: '',
    CACHE_DRIVER: 'memory',
    OBS_REDIS_URL: '',
    OBS_ALERT_WEBHOOK_URL: '',
    ADMIN_IP_ALLOWLIST: '',
  }))
    vi.stubEnv(name, value);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  server?.closeAllConnections();
  if (server?.listening) await new Promise<void>((resolve) => server!.close(() => resolve()));
});

it.each(['active', 'loading-backlog'])(
  'ends %s admin live streams and rejects new ones during shutdown',
  async (state) => {
    const { adminRouter, closeAdminLiveStreams } = await import('../../src/routes/admin.ts');
    const { getLiveStore } = await import('../../src/services/observability/index.ts');
    const { issueSession, ADMIN_COOKIE } = await import('../../src/services/admin/auth.ts');
    const live = await getLiveStore();
    const backlog = Promise.withResolvers<[]>();
    const readTail = vi.spyOn(live, 'readTail');
    if (state === 'loading-backlog') readTail.mockReturnValueOnce(backlog.promise);
    const unsubscribed = vi.fn();
    const subscribe = vi.spyOn(live, 'subscribe').mockReturnValue(unsubscribed);
    const app = express();
    app.use('/api/admin', adminRouter);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server!.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected test port');
    const { token } = issueSession();
    const headers = { 'X-Admin-Request': '1', Cookie: `${ADMIN_COOKIE}=${token}` };
    const req = get({
      hostname: '127.0.0.1',
      port: address.port,
      path: '/api/admin/live',
      headers,
      agent: false,
    });
    try {
      let ended: Promise<void>;
      if (state === 'active') {
        const response = await new Promise<IncomingMessage>((resolve) =>
          req.once('response', resolve)
        );
        ended = new Promise<void>((resolve) => response.once('end', resolve));
        response.resume();
      } else {
        ended = new Promise<void>((resolve) =>
          req.once('response', (response) => {
            response.once('end', resolve);
            response.resume();
          })
        );
        await vi.waitFor(() => expect(readTail).toHaveBeenCalledOnce());
      }
      closeAdminLiveStreams();
      closeAdminLiveStreams();
      await ended;
      backlog.resolve([]);
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (state === 'active') expect(unsubscribed).toHaveBeenCalledOnce();
      else expect(subscribe).not.toHaveBeenCalled();
      const response = await request(server).get('/api/admin/live').set(headers);
      expect(response.status).toBe(503);
      expect(response.headers['cache-control']).toBe('no-store');
    } finally {
      backlog.resolve([]);
      req.destroy();
      closeAdminLiveStreams();
    }
  }
);
