import { describe, it, expect, afterEach, vi } from 'vitest';

describe('JWT secret minimum length', () => {
  const originalSecret = process.env.JWT_SECRET;

  afterEach(() => {
    process.env.JWT_SECRET = originalSecret;
    vi.resetModules();
  });

  it('accepts a 32+ character secret', async () => {
    process.env.JWT_SECRET = 'a'.repeat(32);
    const { getJwtSecret } = (await import('../../src/utils/security.ts')) as {
      getJwtSecret?: () => string;
    };
    const { generateToken } = await import('../../src/utils/security.ts');
    await expect(generateToken('test-key', false)).resolves.toBeDefined();
  });

  it('rejects a short secret', async () => {
    process.env.JWT_SECRET = 'short';
    vi.resetModules();
    const mod = await import('../../src/utils/security.ts');
    await expect(mod.generateToken('test-key', false)).rejects.toThrow('at least 32 characters');
  });
});
