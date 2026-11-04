import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useConfigManager } from './useConfigManager';
import { api } from '../services/api';

vi.mock('../services/api', () => ({ api: { deleteConfig: vi.fn() } }));

it('rejects invalid imports before changing any configuration state', () => {
  const config = {
    setCatalogs: vi.fn(),
    setPreferences: vi.fn(),
    setConfigName: vi.fn(),
  };
  const addToast = vi.fn();
  const { result } = renderHook(() => useConfigManager(config, addToast, {}));
  result.current.handleImportConfig({
    catalogs: [{ type: 'collection', filters: { listType: 'collection' } }],
    preferences: { disableSearch: true },
    configName: 'Invalid import',
  });

  expect(addToast).toHaveBeenCalledWith(
    'Select a valid collection or studio before saving or importing',
    'error'
  );
  expect(config.setCatalogs).not.toHaveBeenCalled();
  expect(config.setPreferences).not.toHaveBeenCalled();
  expect(config.setConfigName).not.toHaveBeenCalled();
});

it('reports a logout failure after deleting the last configuration', async () => {
  api.deleteConfig.mockResolvedValueOnce({});
  const config = {
    userId: 'user1',
    logout: vi.fn().mockRejectedValue(new Error('Redis unavailable')),
  };
  const addToast = vi.fn();
  const setUrlUserId = vi.fn();
  const { result } = renderHook(() => useConfigManager(config, addToast, { setUrlUserId }));
  act(() => result.current.setUserConfigs([{ userId: 'user1' }]));

  await act(async () => {
    await result.current.handleDeleteConfigFromDropdown('user1');
  });

  expect(addToast).toHaveBeenCalledWith(
    'Configuration deleted, but sign out failed. Please try again.',
    'error'
  );
  expect(setUrlUserId).not.toHaveBeenCalled();
});
