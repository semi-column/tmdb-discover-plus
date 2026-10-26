import { describe, it, expect, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';

process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'plain-env-password-123';
process.env.ADMIN_PASSWORD_HASH = '';
process.env.REDIS_URL = '';
process.env.CACHE_DRIVER = 'memory';
process.env.TRUST_CLOUDFLARE_HEADERS = '';

const H = { 'X-Admin-Request': '1' };
let app: express.Express;

beforeAll(async () => {
  const { adminRouter } = await import('../../src/routes/admin.ts');
  app = express();
  app.use(express.json());
  app.use('/api/admin', adminRouter);
});

const login = (password: string, cfIp?: string) => {
  const req = request(app).post('/api/admin/login').set(H);
  if (cfIp) req.set('CF-Connecting-IP', cfIp);
  return req.send({ username: 'admin', password });
};

describe('admin with plain ADMIN_PASSWORD', () => {
  it('signs in and can generate a TOTP secret without storing it', async () => {
    const res = await login('plain-env-password-123');
    expect(res.status).toBe(200);
    const cookie = (res.headers['set-cookie'][0] as string).split(';')[0];

    const security = await request(app).get('/api/admin/security').set(H).set('Cookie', cookie);
    expect(security.body).toMatchObject({ credentialSource: 'password', totpEnabled: false });

    const totp = await request(app).post('/api/admin/security/totp').set(H).set('Cookie', cookie);
    expect(totp.body.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(totp.body.otpauthUrl).toContain(totp.body.secret);
  });

  it('ignores a spoofed CF-Connecting-IP when Cloudflare is not trusted', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await login('wrong-password', `198.51.100.${i}`)).status).toBe(401);
    }
    // Rotating the header must not reset the lockout: all attempts share the real socket IP.
    expect((await login('plain-env-password-123', '198.51.100.200')).status).toBe(429);
  });
});

describe('admin configuration validation', () => {
  it('reports a too-short password and stays disabled', async () => {
    vi.resetModules();
    process.env.ADMIN_PASSWORD = 'short';
    const auth = await import('../../src/services/admin/auth.ts');
    expect(auth.isAdminEnabled()).toBe(false);
    expect(auth.adminConfigProblem()).toMatch(/at least 16/);
    process.env.ADMIN_PASSWORD = 'plain-env-password-123';
  });
});
