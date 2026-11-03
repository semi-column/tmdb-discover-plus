import { renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useConfigManager } from './useConfigManager';

vi.mock('../services/api', () => ({ api: {} }));

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
