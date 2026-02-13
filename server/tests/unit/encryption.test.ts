import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, isEncrypted } from '../../src/utils/encryption.ts';

describe('encrypt / decrypt', () => {
  it('round-trips a plaintext string', () => {
    const plain = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4';
    const encrypted = encrypt(plain);
    expect(encrypted).not.toBe(plain);
    expect(decrypt(encrypted!)).toBe(plain);
  });

  it('returns null for null/undefined input', () => {
    expect(encrypt(null)).toBeNull();
    expect(encrypt(undefined)).toBeNull();
    expect(decrypt(null)).toBeNull();
    expect(decrypt(undefined)).toBeNull();
  });

  it('produces different ciphertexts for same input (random IV)', () => {
    const a = encrypt('test');
    const b = encrypt('test');
    expect(a).not.toBe(b);
    expect(decrypt(a!)).toBe('test');
    expect(decrypt(b!)).toBe('test');
  });

  it('returns null for tampered ciphertext', () => {
    const encrypted = encrypt('secret')!;
    const tampered = encrypted.slice(0, -2) + 'zz';
    expect(decrypt(tampered)).toBeNull();
  });

  it('returns null for wrong format', () => {
    expect(decrypt('not:valid')).toBeNull();
    expect(decrypt('only-one-part')).toBeNull();
  });
});

describe('isEncrypted', () => {
  it('returns true for encrypted strings', () => {
    const encrypted = encrypt('test')!;
    expect(isEncrypted(encrypted)).toBe(true);
  });
  it('returns false for plain strings', () => {
    expect(isEncrypted('plain-text')).toBe(false);
  });
  it('returns false for null/undefined/non-string', () => {
    expect(isEncrypted(null)).toBe(false);
    expect(isEncrypted(undefined)).toBe(false);
    expect(isEncrypted(12345)).toBe(false);
  });
  it('returns false for empty string', () => {
    expect(isEncrypted('')).toBe(false);
  });
});
