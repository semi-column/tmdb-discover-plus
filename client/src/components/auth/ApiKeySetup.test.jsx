import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/api', () => ({
  api: { login: vi.fn() },
}));
vi.mock('../social/SocialButtons.jsx', () => ({
  SocialButtons: () => null,
}));
vi.mock('../modals/DonateModal', () => ({
  DonateModal: () => null,
}));

import { api } from '../../services/api';
import { ApiKeySetup } from './ApiKeySetup.jsx';

describe('ApiKeySetup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('offers config export after TMDB rejects the login key', async () => {
    api.login.mockRejectedValueOnce({
      message: 'Invalid TMDB API key',
      code: 'INVALID_API_KEY',
      recoveryConfigs: [
        { userId: 'old-user', configName: 'Saved config', catalogs: [], preferences: {} },
      ],
    });

    render(<ApiKeySetup />);
    fireEvent.change(screen.getByLabelText('TMDB API Key'), {
      target: { value: 'a'.repeat(32) },
    });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    expect(await screen.findByText('Your TMDB API key is invalid')).toBeTruthy();
    expect(screen.getByRole('button', { name: /export saved config/i })).toBeTruthy();
    expect(screen.getByText(/import the file into a new account/i)).toBeTruthy();
  });

  it('shows a retry instead of an expired-session prompt during an outage', () => {
    render(<ApiKeySetup sessionUnavailable isSessionExpired />);
    expect(screen.getByText('Session temporarily unavailable')).toBeTruthy();
    expect(screen.getByText(/your session is saved/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
    expect(screen.queryByText('Session Expired')).toBeNull();
  });
});
