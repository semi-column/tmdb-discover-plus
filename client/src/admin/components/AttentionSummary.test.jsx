import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AttentionSummary } from './AttentionSummary.jsx';
import { navigate } from '../hooks.js';

vi.mock('../hooks.js', () => ({ navigate: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

it('does not equate application logs with failed HTTP responses', () => {
  render(
    <AttentionSummary
      range="24h"
      totals={{ requests: 100, errors5xx: 0, slow: 2, logErrors: 10, logWarnings: 20 }}
    />
  );
  expect(screen.getByText('No HTTP 5xx recorded')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Application logs/ }));
  expect(navigate).toHaveBeenCalledWith('errors', { range: '24h', status: 'all' });
});

it('drills into failed and slow responses with the selected range', () => {
  render(<AttentionSummary range="7d" totals={{ requests: 100, errors5xx: 5, slow: 2 }} />);
  fireEvent.click(screen.getByRole('button', { name: /Failed HTTP responses/ }));
  expect(navigate).toHaveBeenLastCalledWith('requests', { range: '7d', status: '5xx' });
  fireEvent.click(screen.getByRole('button', { name: /Slow responses/ }));
  expect(navigate).toHaveBeenLastCalledWith('requests', { range: '7d', minMs: 1500 });
});

it('does not describe an empty time range as healthy', () => {
  render(<AttentionSummary range="1h" totals={{ requests: 0 }} />);
  expect(screen.getByText('No requests recorded')).toBeInTheDocument();
});
