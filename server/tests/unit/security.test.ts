import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  computeApiKeyId,
  destroySecurity,
  generateToken,
  verifyToken,
  revokeToken,
  setRevocationStore,
} from '../../src/utils/security.ts';

afterEach(() => destroySecurity());

describe('computeApiKeyId', () => {
  it('returns consistent hash for same input', async () => {
    const a = await computeApiKeyId('test-key');
    const b = await computeApiKeyId('test-key');
    expect(a).toBe(b);
    expect(a.length).toBe(64);
  });

  it('returns different hashes for different keys', async () => {
    expect(await computeApiKeyId('key-a')).not.toBe(await computeApiKeyId('key-b'));
  });

  it('returns empty for empty input', async () => {
    expect(await computeApiKeyId('')).toBe('');
  });
});

describe('generateToken / verifyToken', () => {
  it('generates and verifies a valid token', async () => {
    const { token, expiresIn } = await generateToken('test-api-key', true);
    expect(token).toBeTruthy();
    expect(expiresIn).toBe('30d');
    const decoded = await verifyToken(token);
    expect(decoded).not.toBeNull();
    expect(decoded).toHaveProperty('apiKeyId');
    expect(decoded).toHaveProperty('jti');
    expect(decoded).toHaveProperty('exp');
  });

  it('uses session expiry when rememberMe is false', async () => {
    const { expiresIn } = await generateToken('key', false);
    expect(expiresIn).toBe('24h');
  });

  it('rejects tampered tokens', async () => {
    const { token } = await generateToken('key');
    const tampered = token.slice(0, -3) + 'xxx';
    expect(await verifyToken(tampered)).toBeNull();
  });

  it('rejects garbage input', async () => {
    expect(await verifyToken('not-a-jwt')).toBeNull();
  });
});

describe('revokeToken', () => {
  it('revokes a valid token', async () => {
    const { token } = await generateToken('revoke-test-key');
    expect(await revokeToken(token)).toBe(true);
    expect(await verifyToken(token)).toBeNull();
  });

  it('returns false for invalid token', async () => {
    expect(await revokeToken('invalid')).toBe(false);
  });

  it('does not persist revocations for tokens it did not sign', async () => {
    const jwt = (await import('jsonwebtoken')).default;
    const forged = jwt.sign({ jti: 'victim-jti' }, 'attacker-key', { expiresIn: '3650d' });
    const store = { add: vi.fn(), has: vi.fn().mockResolvedValue(false) };
    setRevocationStore(store);

    expect(await revokeToken(forged)).toBe(false);
    expect(store.add).not.toHaveBeenCalled();
  });

  it('previously verified token fails after revocation', async () => {
    const { token } = await generateToken('key2');
    expect(await verifyToken(token)).not.toBeNull();
    await revokeToken(token);
    expect(await verifyToken(token)).toBeNull();
  });

  it('waits for shared persistence before confirming revocation', async () => {
    const { token } = await generateToken('shared-revocation');
    const write = Promise.withResolvers<void>();
    const store = {
      add: vi.fn(() => write.promise),
      has: vi.fn().mockResolvedValue(false),
    };
    setRevocationStore(store);

    const revocation = revokeToken(token);
    expect(store.add).toHaveBeenCalledOnce();
    expect(await verifyToken(token)).not.toBeNull();
    write.resolve();
    expect(await revocation).toBe(true);
    expect(await verifyToken(token)).toBeNull();
  });

  it('fails closed without recording a false logout when the shared store fails', async () => {
    const { token } = await generateToken('unavailable-revocation');
    const store = {
      add: vi
        .fn()
        .mockRejectedValueOnce(new Error('Redis unavailable'))
        .mockResolvedValue(undefined),
      has: vi.fn().mockRejectedValueOnce(new Error('Redis unavailable')).mockResolvedValue(false),
    };
    setRevocationStore(store);

    await expect(verifyToken(token)).rejects.toMatchObject({
      statusCode: 503,
      code: 'AUTH_UNAVAILABLE',
    });
    await expect(revokeToken(token)).rejects.toMatchObject({
      statusCode: 503,
      code: 'AUTH_UNAVAILABLE',
    });
    expect(await verifyToken(token)).not.toBeNull();
    expect(await revokeToken(token)).toBe(true);
    expect(await verifyToken(token)).toBeNull();
  });
});
