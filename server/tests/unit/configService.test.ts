import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/services/storage/index.ts', () => ({
  getStorage: vi.fn(() => ({
    getUserConfig: vi.fn(),
    saveUserConfig: vi.fn(),
  })),
}));
vi.mock('../../src/infrastructure/configCache.ts', () => ({
  getConfigCache: vi.fn(() => ({
    getOrLoad: vi.fn(async (_key: string, loader: () => Promise<unknown>) => loader()),
    invalidate: vi.fn(),
  })),
}));

import { getApiKeyFromConfig, getPosterKeyFromConfig } from '../../src/services/configService.ts';
import { encrypt } from '../../src/utils/encryption.ts';

describe('getApiKeyFromConfig', () => {
  it('decrypts encrypted API key', () => {
    const encrypted = encrypt('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4');
    const config = { tmdbApiKeyEncrypted: encrypted };
    expect(getApiKeyFromConfig(config)).toBe('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4');
  });

  it('returns null for null config', () => {
    expect(getApiKeyFromConfig(null)).toBeNull();
  });

  it('returns null for config without encrypted key', () => {
    expect(getApiKeyFromConfig({})).toBeNull();
  });
});

describe('getPosterKeyFromConfig', () => {
  it('decrypts encrypted poster key', () => {
    const encrypted = encrypt('poster-key-123');
    const config = { preferences: { posterApiKeyEncrypted: encrypted } };
    expect(getPosterKeyFromConfig(config)).toBe('poster-key-123');
  });

  it('returns null when no preferences', () => {
    expect(getPosterKeyFromConfig(null)).toBeNull();
    expect(getPosterKeyFromConfig({})).toBeNull();
    expect(getPosterKeyFromConfig({ preferences: {} })).toBeNull();
  });
});
