import { describe, it, expect, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';

process.env.ADMIN_USERNAME = 'admin';
process.env.REDIS_URL = '';
process.env.CACHE_DRIVER = 'memory';
process.env.TRUST_CLOUDFLARE_HEADERS = 'true';

const PASSWORD = 'correct horse battery staple';

let app: express.Express;
let auth: typeof import('../../src/services/admin/auth.ts');

beforeAll(async () => {
  auth = await import('../../src/services/admin/auth.ts');
  process.env.ADMIN_PASSWORD_HASH = await auth.hashPassword(PASSWORD);
  vi.resetModules();
  auth = await import('../../src/services/admin/auth.ts');
  const { adminRouter } = await import('../../src/routes/admin.ts');
  app = express();
  app.use(express.json());
  app.use('/api/admin', adminRouter);
});

const H = { 'X-Admin-Request': '1' };

describe('admin password hashing', () => {
  it('verifies the right password and rejects others', async () => {
    const hash = await auth.hashPassword('s3cret-password!');
    expect(hash.startsWith('scrypt:')).toBe(true);
    expect(hash).not.toContain('$');
    expect(await auth.verifyPassword('s3cret-password!', hash)).toBe(true);
    expect(await auth.verifyPassword('wrong', hash)).toBe(false);
  });

  it('rejects malformed or weak-parameter hashes', async () => {
    expect(auth.parsePasswordHash('bcrypt:1:2:3:4:5')).toBeNull();
    expect(auth.parsePasswordHash('scrypt:1024:8:1:AAAAAAAAAAAAAAAAAAAAAA:AAAA')).toBeNull();
    expect(await auth.verifyPassword('x', 'garbage')).toBe(false);
  });
});

describe('TOTP', () => {
  it('matches the RFC 6238 SHA-1 test vector', () => {
    const secret = auth.base32Encode(Buffer.from('12345678901234567890'));
    expect(secret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(auth.verifyTotp(secret, '287082', 59_000)).toBe(true);
    expect(auth.verifyTotp(secret, '287083', 59_000)).toBe(false);
    expect(auth.verifyTotp(secret, 'abcdef', 59_000)).toBe(false);
  });
});

describe('admin routes', () => {
  it('requires the CSRF header', async () => {
    const res = await request(app).get('/api/admin/session');
    expect(res.status).toBe(403);
  });

  it('rejects unauthenticated data access', async () => {
    const res = await request(app).get('/api/admin/meta').set(H);
    expect(res.status).toBe(401);
  });

  it('logs in, serves data, and revokes on logout', async () => {
    const login = await request(app)
      .post('/api/admin/login')
      .set(H)
      .send({ username: 'admin', password: PASSWORD });
    expect(login.status).toBe(200);
    const cookie = login.headers['set-cookie'][0] as string;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/api\/admin/);
    const token = cookie.split(';')[0];

    const meta = await request(app).get('/api/admin/meta').set(H).set('Cookie', token);
    expect(meta.status).toBe(200);
    expect(meta.body.persistence).toBe('none');

    const history = await request(app).get('/api/admin/requests').set(H).set('Cookie', token);
    expect(history.status).toBe(409);

    await request(app).post('/api/admin/logout').set(H).set('Cookie', token);
    const after = await request(app).get('/api/admin/meta').set(H).set('Cookie', token);
    expect(after.status).toBe(401);
  });

  it('locks an IP out after repeated failures', async () => {
    const attempt = () =>
      request(app)
        .post('/api/admin/login')
        .set(H)
        .set('CF-Connecting-IP', '203.0.113.9')
        .send({ username: 'admin', password: 'nope' });
    for (let i = 0; i < 5; i++) expect((await attempt()).status).toBe(401);
    expect((await attempt()).status).toBe(429);

    const otherIp = await request(app)
      .post('/api/admin/login')
      .set(H)
      .set('CF-Connecting-IP', '203.0.113.10')
      .send({ username: 'admin', password: PASSWORD });
    expect(otherIp.status).toBe(200);
  });
});
