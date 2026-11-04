import { renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useConfig } from './useConfig';
import { api } from '../services/api';

vi.mock('../services/api', () => ({
  api: {
    verifySession: vi.fn().mockResolvedValue({ valid: false, unavailable: true }),
    getLegacyApiKey: vi.fn(),
    login: vi.fn(),
    clearLegacyApiKey: vi.fn(),
  },
}));

it('retains the saved session and legacy key when verification is unavailable', async () => {
  const { result } = renderHook(() => useConfig('existing-user'));
  await waitFor(() => expect(result.current.authChecked).toBe(true));
  expect(result.current.sessionUnavailable).toBe(true);
  expect(api.getLegacyApiKey).not.toHaveBeenCalled();
  expect(api.login).not.toHaveBeenCalled();
  expect(api.clearLegacyApiKey).not.toHaveBeenCalled();
});
