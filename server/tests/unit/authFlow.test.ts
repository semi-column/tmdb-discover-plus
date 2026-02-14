import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  computeApiKeyId,
  generateToken,
  verifyToken,
  revokeToken,
} from '../../src/utils/security.ts';
import { sendError } from '../../src/utils/AppError.ts';

vi.mock('../../src/services/storage/index.js', () => ({
  getStorage: vi.fn(() => ({
    getUserConfig: vi.fn(),
    saveUserConfig: vi.fn(),
  })),
}));
vi.mock('../../src/infrastructure/configCache.js', () => ({
  getConfigCache: vi.fn(() => ({
    getOrLoad: vi.fn(async (_key: string, loader: () => Promise<unknown>) => loader()),
    invalidate: vi.fn(),
    set: vi.fn(),
  })),
}));

import { requireAuth, optionalAuth } from '../../src/utils/authMiddleware.js';

function mockReq(overrides: Record<string, unknown> = {}) {
  return { headers: {}, params: {}, ...overrides };
}

function mockRes() {
  const res: Record<string, unknown> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.set = vi.fn().mockReturnValue(res);
  return res;
}

describe('Auth flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('JWT generation and verification', () => {
    it('generates a token with apiKeyId and jti', async () => {
      const { token } = await generateToken('test-api-key-abc');
      const decoded = verifyToken(token) as Record<string, unknown>;
      expect(decoded).not.toBeNull();
      expect(decoded.apiKeyId).toBeTruthy();
      expect(decoded.jti).toBeTruthy();
    });

    it('apiKeyId is consistent for same key', async () => {
      const id1 = await computeApiKeyId('same-key');
      const id2 = await computeApiKeyId('same-key');
      expect(id1).toBe(id2);
    });

    it('apiKeyId differs for different keys', async () => {
      const id1 = await computeApiKeyId('key-one');
      const id2 = await computeApiKeyId('key-two');
      expect(id1).not.toBe(id2);
    });
  });

  describe('Token revocation via JTI blacklist', () => {
    it('revoked token fails verification', async () => {
      const { token } = await generateToken('revoke-test');
      expect(verifyToken(token)).not.toBeNull();
      revokeToken(token);
      expect(verifyToken(token)).toBeNull();
    });

    it('revoking invalid token returns false', () => {
      expect(revokeToken('not-a-jwt')).toBe(false);
    });
  });

  describe('Session expiry', () => {
    it('rememberMe=true uses 7d expiry', async () => {
      const { expiresIn } = await generateToken('key', true);
      expect(expiresIn).toBe('7d');
    });

    it('rememberMe=false uses 24h expiry', async () => {
      const { expiresIn } = await generateToken('key', false);
      expect(expiresIn).toBe('24h');
    });
  });

  describe('requireAuth middleware', () => {
    it('rejects request without Authorization header', async () => {
      const req = mockReq();
      const res = mockRes();
      const next = vi.fn();
      await requireAuth(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('rejects request with invalid token', async () => {
      const req = mockReq({ headers: { authorization: 'Bearer invalid-token' } });
      const res = mockRes();
      const next = vi.fn();
      await requireAuth(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('accepts request with valid token', async () => {
      const { token } = await generateToken('valid-api-key');
      const req = mockReq({ headers: { authorization: `Bearer ${token}` } }) as any;
      const res = mockRes();
      const next = vi.fn();
      await requireAuth(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.apiKeyId).toBeTruthy();
    });

    it('rejects revoked token', async () => {
      const { token } = await generateToken('to-revoke');
      revokeToken(token);
      const req = mockReq({ headers: { authorization: `Bearer ${token}` } });
      const res = mockRes();
      const next = vi.fn();
      await requireAuth(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });
  });

  describe('optionalAuth middleware', () => {
    it('passes through without token', async () => {
      const req = mockReq() as any;
      const res = mockRes();
      const next = vi.fn();
      await optionalAuth(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.apiKeyId).toBeUndefined();
    });

    it('sets apiKeyId when valid token present', async () => {
      const { token } = await generateToken('opt-key');
      const req = mockReq({ headers: { authorization: `Bearer ${token}` } }) as any;
      const res = mockRes();
      const next = vi.fn();
      await optionalAuth(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.apiKeyId).toBeTruthy();
    });

    it('passes through with invalid token (no error)', async () => {
      const req = mockReq({ headers: { authorization: 'Bearer bad-token' } }) as any;
      const res = mockRes();
      const next = vi.fn();
      await optionalAuth(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.apiKeyId).toBeUndefined();
    });
  });
});
