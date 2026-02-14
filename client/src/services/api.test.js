import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let ApiService;
let api;

describe('ApiService', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    vi.resetModules();
    globalThis.localStorage = createStorage();
    globalThis.sessionStorage = createStorage();
    const mod = await import('./api.js');
    ApiService = mod.api.constructor;
    api = new ApiService();
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('includes auth header when session token is set', async () => {
    api.setSessionToken('tok123');

    globalThis.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });

    await api.request('/test');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/test',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer tok123',
        }),
      })
    );
  });

  it('omits auth header when no session token exists', async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });

    await api.request('/test');

    const headers = globalThis.fetch.mock.calls[0][1].headers;
    expect(headers.Authorization).toBeUndefined();
  });

  it('throws and clears session on 401', async () => {
    api.setSessionToken('bad-token');

    globalThis.fetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Unauthorized' }),
    });

    await expect(api.request('/protected')).rejects.toThrow('Session expired');
    expect(api.getSessionToken()).toBeNull();
  });

  it('parses error body on non-OK response', async () => {
    globalThis.fetch.mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ error: 'Validation failed', code: 'VALIDATION_ERROR' }),
    });

    try {
      await api.request('/bad');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err.message).toBe('Validation failed');
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.status).toBe(422);
    }
  });

  it('persists token in localStorage when rememberMe is true', () => {
    api.setSessionToken('remember-me-tok', true);
    expect(localStorage.getItem('tmdb-session-token')).toBe('remember-me-tok');
    expect(sessionStorage.getItem('tmdb-session-token')).toBeNull();
  });

  it('persists token in sessionStorage when rememberMe is false', () => {
    api.setSessionToken('session-tok', false);
    expect(sessionStorage.getItem('tmdb-session-token')).toBe('session-tok');
    expect(localStorage.getItem('tmdb-session-token')).toBeNull();
  });

  it('clearSession removes token from both storages', () => {
    api.setSessionToken('tok');
    api.clearSession();
    expect(api.getSessionToken()).toBeNull();
    expect(localStorage.getItem('tmdb-session-token')).toBeNull();
    expect(sessionStorage.getItem('tmdb-session-token')).toBeNull();
  });

  it('login stores token and returns result', async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ token: 'new-jwt', userId: 'u1' }),
    });

    const result = await api.login('my-api-key', null, true);
    expect(result.token).toBe('new-jwt');
    expect(api.getSessionToken()).toBe('new-jwt');
  });
});

function createStorage() {
  const store = new Map();
  return {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}
