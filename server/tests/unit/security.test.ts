import { describe, it, expect, afterAll } from 'vitest';
import {
  computeApiKeyId,
  generateToken,
  verifyToken,
  revokeToken,
} from '../../src/utils/security.ts';

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
    expect(expiresIn).toBe('7d');
    const decoded = verifyToken(token);
    expect(decoded).not.toBeNull();
    expect(decoded).toHaveProperty('apiKeyId');
    expect(decoded).toHaveProperty('jti');
  });

  it('uses session expiry when rememberMe is false', async () => {
    const { expiresIn } = await generateToken('key', false);
    expect(expiresIn).toBe('24h');
  });

  it('rejects tampered tokens', async () => {
    const { token } = await generateToken('key');
    const tampered = token.slice(0, -3) + 'xxx';
    expect(verifyToken(tampered)).toBeNull();
  });

  it('rejects garbage input', () => {
    expect(verifyToken('not-a-jwt')).toBeNull();
  });
});

describe('revokeToken', () => {
  it('revokes a valid token', async () => {
    const { token } = await generateToken('revoke-test-key');
    expect(revokeToken(token)).toBe(true);
    expect(verifyToken(token)).toBeNull();
  });

  it('returns false for invalid token', () => {
    expect(revokeToken('invalid')).toBe(false);
  });

  it('previously verified token fails after revocation', async () => {
    const { token } = await generateToken('key2');
    expect(verifyToken(token)).not.toBeNull();
    revokeToken(token);
    expect(verifyToken(token)).toBeNull();
  });
});
