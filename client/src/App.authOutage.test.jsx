import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import App from './App';

vi.mock('./services/api', () => ({
  api: {
    getStats: vi.fn().mockResolvedValue({}),
    verifySession: vi.fn().mockResolvedValue({ valid: false, unavailable: true }),
  },
}));
vi.mock('./hooks/useTMDB', () => ({ useTMDB: () => ({ loading: false }) }));
vi.mock('./components/layout/Header', () => ({ Header: () => null }));

it('shows a retryable outage instead of an expired-session screen', async () => {
  window.history.replaceState({}, '', '/?userId=existing');
  render(<App />);

  expect(await screen.findByText('Session temporarily unavailable')).toBeInTheDocument();
  expect(screen.getByText(/your session is saved/i)).toBeInTheDocument();
  expect(screen.queryByText('Session Expired')).not.toBeInTheDocument();
});
