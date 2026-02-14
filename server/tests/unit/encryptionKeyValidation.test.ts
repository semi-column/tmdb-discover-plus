import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Encryption key validation', () => {
  const originalKey = process.env.ENCRYPTION_KEY;

  afterEach(() => {
    process.env.ENCRYPTION_KEY = originalKey;
    vi.resetModules();
  });

  it('accepts a valid 64-char hex key', async () => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
    const { config } = await import('../../src/config.ts');
    expect(() => config.encryption.key).not.toThrow();
  });

  it('rejects a short key', async () => {
    process.env.ENCRYPTION_KEY = 'abcd';
    const { config } = await import('../../src/config.ts');
    expect(() => config.encryption.key).toThrow('64 hex characters');
  });

  it('rejects a non-hex key', async () => {
    process.env.ENCRYPTION_KEY = 'z'.repeat(64);
    const { config } = await import('../../src/config.ts');
    expect(() => config.encryption.key).toThrow('64 hex characters');
  });

  it('rejects an empty key', async () => {
    process.env.ENCRYPTION_KEY = '';
    const { config } = await import('../../src/config.ts');
    expect(() => config.encryption.key).toThrow();
  });
});
