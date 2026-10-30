import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AdminApp } from './AdminApp.jsx';
import { adminApi } from './api.js';

vi.mock('./components/TimeChart.jsx', () => ({ TimeChart: () => null }));
vi.mock('./api.js', () => ({
  adminApi: {
    session: vi.fn(),
    meta: vi.fn(),
    overview: vi.fn(),
    requests: vi.fn(),
    facets: vi.fn(),
    upstreams: vi.fn(),
    errors: vi.fn(),
    errorGroup: vi.fn(),
    trace: vi.fn(),
    routes: vi.fn(),
  },
  downloadExport: vi.fn(),
}));

const requestRow = {
  request_id: 'request-1',
  ts: '2026-10-30T00:00:00Z',
  status: 200,
  method: 'GET',
  path: '/config/meta/series/tt1234567.json',
  route: '/:userId/meta/:type/:id.json',
  duration_ms: 1800,
  source: 'imdb',
  cache_hits: 3,
  cache_misses: 2,
  upstream_calls: 2,
  error_fp: 'reset',
};
const upstream = {
  provider: 'tmdb',
  method: 'GET',
  path: '/3/tv/:id',
  status: 0,
  ts: requestRow.ts,
  duration_ms: 200,
  error: 'read ECONNRESET',
  request_id: 'request-1',
};
const log = {
  fingerprint: 'reset',
  level: 'warn',
  context: 'tmdb:client',
  message: 'Retrying TMDB',
  request_id: 'request-1',
  ts: requestRow.ts,
};

beforeEach(() => {
  vi.clearAllMocks();
  window.location.hash = '/overview?range=24h';
  adminApi.session.mockResolvedValue({ authenticated: true });
  adminApi.meta.mockResolvedValue({ capabilities: {} });
  adminApi.overview.mockResolvedValue({
    totals: { requests: 100, errors5xx: 2, slow: 4, logErrors: 10, logWarnings: 20 },
    series: {},
    range: { resolution: 'minute' },
    routes: [],
    statusCodes: {},
    latencyHistogram: { bounds: [100, 1500], counts: [10, 90] },
    breakdowns: { resources: [] },
  });
  adminApi.facets.mockResolvedValue({});
  adminApi.requests.mockImplementation(async (params) => ({
    rows: [{ ...requestRow, status: params.status === '5xx' ? 503 : 200 }],
  }));
  adminApi.trace.mockResolvedValue({ requests: [requestRow], upstream: [upstream], errors: [log] });
  adminApi.upstreams.mockResolvedValue({
    providers: [],
    details: {
      endpoints: [{ ...upstream, calls: 10, errors: 2 }],
      recentErrors: [upstream, { ...upstream, status: 404 }],
    },
  });
  adminApi.errors.mockResolvedValue({ groups: [] });
  adminApi.errorGroup.mockResolvedValue({
    group: { ...log, status: 'open', count: 10 },
    routes: [{ route: requestRow.route, count: 10 }],
    events: [log],
  });
  adminApi.routes.mockResolvedValue([]);
});

it('drills from attention to filtered requests, a linkable trace, and the dependency endpoint', async () => {
  adminApi.trace.mockResolvedValue({
    requests: [{ ...requestRow, status: 503 }],
    upstream: [upstream],
    errors: [log],
  });
  render(<AdminApp />);
  fireEvent.click(await screen.findByRole('button', { name: /Failed HTTP responses/ }));
  await waitFor(() =>
    expect(adminApi.requests).toHaveBeenCalledWith(
      expect.objectContaining({ range: '24h', status: '5xx' })
    )
  );
  fireEvent.click(await screen.findByRole('button', { name: requestRow.path }));
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
  expect(window.location.hash).toContain('trace=request-1');
  expect(await screen.findByText('HTTP response failed')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'tmdb /3/tv/:id' }));
  await waitFor(() => expect(window.location.hash).toContain('endpoint=%2F3%2Ftv%2F%3Aid'));
  expect(window.location.hash).toContain('range=24h');
  expect(await screen.findByText('Transport failure')).toBeInTheDocument();
});

it('keeps endpoint and time context while filtering samples and investigating the log group', async () => {
  window.location.hash = '/upstreams?range=7d&provider=tmdb&endpoint=%2F3%2Ftv%2F%3Aid';
  render(<AdminApp />);
  fireEvent.change(await screen.findByLabelText('Failure type'), { target: { value: 'network' } });
  await waitFor(() => expect(window.location.hash).toContain('failure=network'));
  expect(screen.queryByText('Not found')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'request-1' }));
  expect(await screen.findByText('HTTP succeeded with internal signals')).toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: 'Retrying TMDB' }));
  expect(await screen.findByText('Log severity is not response impact')).toBeInTheDocument();
  expect(window.location.hash).toContain('range=7d');
  fireEvent.click(screen.getByRole('button', { name: requestRow.route }));
  await waitFor(() =>
    expect(adminApi.requests).toHaveBeenCalledWith(
      expect.objectContaining({ range: '7d', route: requestRow.route, errorsOnly: 'true' })
    )
  );
});

it('closes a deep-linked trace with Escape without losing filters', async () => {
  window.location.hash = '/requests?range=24h&status=5xx&trace=request-1';
  render(<AdminApp />);
  await screen.findByRole('dialog');
  fireEvent.keyDown(screen.getByRole('button', { name: 'Close trace' }), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(window.location.hash).toContain('status=5xx');
  expect(window.location.hash).toContain('range=24h');
});
