import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { useAuth, getUrlUserId } from './useAuth';

function createMockConfig(overrides = {}) {
  return {
    authChecked: true,
    isAuthenticated: false,
    userId: null,
    loadConfig: vi.fn().mockResolvedValue({ catalogs: [] }),
    logout: vi.fn(),
    applyConfig: vi.fn(),
    ...overrides,
  };
}

function createMockDeps(overrides = {}) {
  return {
    loadUserConfigs: vi.fn().mockResolvedValue([]),
    setUserConfigs: vi.fn(),
    setActiveCatalog: vi.fn(),
    setUrlUserId: vi.fn(),
    setShowMismatchModal: vi.fn(),
    ...overrides,
  };
}

describe('getUrlUserId', () => {
  const originalSearch = window.location.search;
  const originalPathname = window.location.pathname;

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      value: { ...window.location, search: originalSearch, pathname: originalPathname },
      writable: true,
    });
  });

  it('extracts userId from query string', () => {
    Object.defineProperty(window, 'location', {
      value: { ...window.location, search: '?userId=abc123', pathname: '/' },
      writable: true,
    });
    expect(getUrlUserId()).toBe('abc123');
  });

  it('extracts userId from path', () => {
    Object.defineProperty(window, 'location', {
      value: { ...window.location, search: '', pathname: '/abc123' },
      writable: true,
    });
    expect(getUrlUserId()).toBe('abc123');
  });

  it('returns null for root path with no userId', () => {
    Object.defineProperty(window, 'location', {
      value: { ...window.location, search: '', pathname: '/' },
      writable: true,
    });
    expect(getUrlUserId()).toBeNull();
  });

  it('ignores "configure" path segment', () => {
    Object.defineProperty(window, 'location', {
      value: { ...window.location, search: '', pathname: '/configure' },
      writable: true,
    });
    expect(getUrlUserId()).toBeNull();
  });
});

describe('useAuth', () => {
  const addToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/');
  });

  it('shows setup when not authenticated', async () => {
    const config = createMockConfig({ authChecked: true, isAuthenticated: false });
    const deps = createMockDeps();
    const { result } = renderHook(() => useAuth(config, addToast, null, deps));

    await waitFor(() => {
      expect(result.current.isSetup).toBe(true);
      expect(result.current.pageLoading).toBe(false);
    });
  });

  it('hides setup when authenticated', async () => {
    const config = createMockConfig({
      authChecked: true,
      isAuthenticated: true,
      userId: 'user1',
    });
    const deps = createMockDeps();
    const { result } = renderHook(() => useAuth(config, addToast, null, deps));

    await waitFor(() => {
      expect(result.current.isSetup).toBe(false);
    });
  });

  it('loads user configs on authentication', async () => {
    const loadUserConfigs = vi.fn().mockResolvedValue([]);
    const config = createMockConfig({
      authChecked: true,
      isAuthenticated: true,
      userId: 'user1',
    });
    const deps = createMockDeps({ loadUserConfigs });
    renderHook(() => useAuth(config, addToast, null, deps));

    await waitFor(() => {
      expect(loadUserConfigs).toHaveBeenCalled();
    });
  });

  it('handleLogout resets state', async () => {
    const logout = vi.fn();
    const setUrlUserId = vi.fn();
    const config = createMockConfig({
      authChecked: true,
      isAuthenticated: true,
      userId: 'user1',
      logout,
    });
    const deps = createMockDeps({ setUrlUserId });
    const { result } = renderHook(() => useAuth(config, addToast, null, deps));

    await waitFor(() => expect(result.current.isSetup).toBe(false));

    act(() => {
      result.current.handleLogout();
    });

    expect(logout).toHaveBeenCalled();
    expect(setUrlUserId).toHaveBeenCalledWith(null);
    expect(result.current.isSetup).toBe(true);
    expect(result.current.isSessionExpired).toBe(false);
  });

  it('handleLogout with changeKey flag', async () => {
    const config = createMockConfig({
      authChecked: true,
      isAuthenticated: true,
      userId: 'user1',
    });
    const deps = createMockDeps();
    const { result } = renderHook(() => useAuth(config, addToast, null, deps));

    await waitFor(() => expect(result.current.isSetup).toBe(false));

    act(() => {
      result.current.handleLogout({ changeKey: true });
    });

    expect(result.current.wantsToChangeKey).toBe(true);
  });

  it('handleLogin with existing configs', async () => {
    const applyConfig = vi.fn();
    const setUserConfigs = vi.fn();
    const setActiveCatalog = vi.fn();
    const setUrlUserId = vi.fn();
    const config = createMockConfig({
      authChecked: true,
      isAuthenticated: false,
      applyConfig,
    });
    const deps = createMockDeps({ setUserConfigs, setActiveCatalog, setUrlUserId });
    const { result } = renderHook(() => useAuth(config, addToast, null, deps));

    const configs = [{ userId: 'user1', catalogs: [{ id: 'cat1' }], updatedAt: '2025-01-01' }];

    await act(async () => {
      await result.current.handleLogin('user1', configs);
    });

    expect(setUserConfigs).toHaveBeenCalled();
    expect(applyConfig).toHaveBeenCalled();
    expect(setActiveCatalog).toHaveBeenCalledWith({ id: 'cat1' });
    expect(setUrlUserId).toHaveBeenCalledWith('user1');
    expect(addToast).toHaveBeenCalledWith('Logged in successfully');
  });

  it('handleLogin for new user (no configs)', async () => {
    const applyConfig = vi.fn();
    const loadUserConfigs = vi.fn().mockResolvedValue([]);
    const config = createMockConfig({
      authChecked: true,
      isAuthenticated: false,
      applyConfig,
    });
    const deps = createMockDeps({ loadUserConfigs });
    const { result } = renderHook(() => useAuth(config, addToast, null, deps));

    await act(async () => {
      await result.current.handleLogin('newuser', []);
    });

    expect(applyConfig).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'newuser', catalogs: [], preferences: {} })
    );
    expect(loadUserConfigs).toHaveBeenCalled();
  });

  it('shows session expired for unauthenticated with URL userId', async () => {
    Object.defineProperty(window, 'location', {
      value: { ...window.location, search: '?userId=user1', pathname: '/' },
      writable: true,
    });
    const config = createMockConfig({ authChecked: true, isAuthenticated: false });
    const deps = createMockDeps();
    const { result } = renderHook(() => useAuth(config, addToast, null, deps));

    await waitFor(() => {
      expect(result.current.isSessionExpired).toBe(true);
    });
  });
});
