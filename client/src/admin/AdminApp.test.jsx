import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AdminApp } from './AdminApp.jsx';
import { adminApi } from './api.js';
import { System } from './pages/System.jsx';
import { navigate } from './hooks.js';

vi.mock('./components/TimeChart.jsx', () => ({ TimeChart: () => null }));
vi.mock('./api.js', () => ({
  adminApi: {
    session: vi.fn(),
    meta: vi.fn(),
    system: vi.fn(),
    overview: vi.fn(),
    caching: vi.fn(),
    requests: vi.fn(),
    facets: vi.fn(),
    groups: vi.fn(),
    upstreams: vi.fn(),
    usage: vi.fn(),
    errors: vi.fn(),
    errorGroup: vi.fn(),
    trace: vi.fn(),
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
  adminApi.system.mockResolvedValue({ instances: [], series: [] });
  adminApi.overview.mockResolvedValue({
    totals: {
      requests: 100,
      errors5xx: 2,
      slow: 4,
      logErrors: 10,
      logWarnings: 20,
      cacheHits: 75,
      cacheMisses: 25,
      cacheHitRate: 0.75,
    },
    series: {},
    range: { resolution: 'minute' },
    routes: [],
    statusCodes: {},
    latencyHistogram: { bounds: [100, 1500], counts: [10, 90] },
    breakdowns: { resources: [] },
  });
  adminApi.facets.mockResolvedValue({});
  adminApi.caching.mockResolvedValue({
    analytics: {
      totals: {
        requests: 10,
        hits: 75,
        misses: 25,
        allHits: 5,
        mixed: 3,
        missesOnly: 2,
        missesWithUpstream: 4,
      },
      groups: [
        {
          key: requestRow.route,
          requests: 10,
          hits: 75,
          misses: 25,
          allHits: 5,
          mixed: 3,
          missesOnly: 2,
          missesWithUpstream: 4,
        },
      ],
    },
    ttls: [{ scope: 'Shared cache / HTTP', name: 'META_HEADER', seconds: 86400 }],
    lifecycle: {
      wrapperRetentionMultiplier: 2.5,
      wrapperStaleMultiplier: 2,
      imdbRetentionMultiplier: 2,
      imdbAdvancedSearchDivisor: 2,
    },
  });
  adminApi.groups.mockResolvedValue({
    by: 'route',
    total: 30,
    groups: [
      {
        key: requestRow.route,
        count: 20,
        errors4xx: 0,
        errors5xx: 1,
        users: 3,
        avg_ms: 50,
        p95_ms: 90,
      },
      { key: '/meta/:type/:id.json', count: 10, errors4xx: 10, errors5xx: 0, users: 0, avg_ms: 5 },
    ],
    series: { t: [1, 2], keys: [requestRow.route], values: [[10, 10]] },
  });
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
  adminApi.usage.mockResolvedValue({ traffic: null, business: null });
  adminApi.errors.mockResolvedValue({ groups: [] });
  adminApi.errorGroup.mockResolvedValue({
    group: { ...log, status: 'open', count: 10 },
    routes: [{ route: requestRow.route, count: 10 }],
    events: [log],
  });
});

it('drills from the error rate to failed requests, a linkable trace, and the dependency endpoint', async () => {
  adminApi.trace.mockResolvedValue({
    requests: [{ ...requestRow, status: 503 }],
    upstream: [upstream],
    errors: [log],
  });
  render(<AdminApp />);
  fireEvent.click(await screen.findByRole('button', { name: /Error rate/ }));
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
  expect(await screen.findByText('Retrying TMDB', { selector: 'p' })).toBeInTheDocument();
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

it('shows recorded stage timings and warns against summing overlapping work', async () => {
  window.location.hash = '/requests?range=24h&trace=request-1';
  adminApi.trace.mockResolvedValue({
    requests: [
      {
        ...requestRow,
        timings: {
          addon_admission: { calls: 1, durationMs: 125 },
          imdb_enrichment: { calls: 12, durationMs: 6000 },
        },
      },
    ],
    upstream: [],
    errors: [],
  });
  render(<AdminApp />);
  expect(await screen.findByText('Request stage timings')).toBeInTheDocument();
  expect(screen.getByText('addon admission')).toBeInTheDocument();
  expect(screen.getByText('imdb enrichment')).toBeInTheDocument();
  expect(screen.getByText('125ms (1 call)')).toBeInTheDocument();
  expect(screen.getByText(/Stages nest and parallel calls overlap/)).toBeInTheDocument();
});

it('uses a selected custom interval for overview and requests and preserves it when navigating', async () => {
  const from = Date.parse('2026-11-01T17:20:00Z');
  const to = Date.parse('2026-11-01T20:00:00Z');
  window.location.hash = `/overview?range=custom&from=${from}&to=${to}`;

  render(<AdminApp />);

  await waitFor(() =>
    expect(adminApi.overview).toHaveBeenCalledWith({ range: 'custom', from, to })
  );
  fireEvent.click(await screen.findByRole('button', { name: /Error rate/ }));
  await waitFor(() =>
    expect(adminApi.requests).toHaveBeenCalledWith(
      expect.objectContaining({ range: 'custom', from, to, status: '5xx' })
    )
  );

  navigate('upstreams', { range: 'custom', provider: 'tmdb' });
  const customParams = new URLSearchParams(window.location.hash.split('?')[1]);
  expect(customParams.get('from')).toBe(String(from));
  expect(customParams.get('to')).toBe(String(to));

  navigate('overview', { range: '24h' });
  const presetParams = new URLSearchParams(window.location.hash.split('?')[1]);
  expect(presetParams.get('range')).toBe('24h');
  expect(presetParams.has('from')).toBe(false);
  expect(presetParams.has('to')).toBe(false);
});

it('carries a custom interval through the dashboard page navigation', async () => {
  const from = Date.parse('2026-11-01T17:20:00Z');
  const to = Date.parse('2026-11-01T20:00:00Z');
  window.location.hash = `/overview?range=custom&from=${from}&to=${to}`;

  render(<AdminApp />);

  fireEvent.click(await screen.findByRole('link', { name: 'Dependencies' }));

  await waitFor(() =>
    expect(adminApi.upstreams).toHaveBeenCalledWith({
      range: 'custom',
      from,
      to,
      provider: '',
    })
  );
});

it('labels Redis live overview data when history fallback is active', async () => {
  adminApi.overview.mockResolvedValueOnce({
    range: { resolution: 'minute' },
    dataSource: 'redis-live-fallback',
    totals: { requests: 2, errors5xx: 0, slow: 0 },
    series: {},
    routes: [],
    statusCodes: {},
    latencyHistogram: { bounds: [100], counts: [2, 0] },
    breakdowns: { resources: [] },
  });
  render(<AdminApp />);
  expect(
    await screen.findByText(/History is unavailable\. Showing Redis live counters/)
  ).toBeInTheDocument();
});

it('labels exact history counts and renders normalized route latency', async () => {
  adminApi.overview.mockResolvedValueOnce({
    range: { resolution: 'minute' },
    dataSource: 'history',
    routePercentilesApproximate: false,
    uniqueUsersApproximate: false,
    totals: {
      requests: 4,
      errors5xx: 0,
      errors4xx: 0,
      slow: 0,
      uniqueUsers: 2,
    },
    series: {},
    routes: [
      {
        route: '/:userId/meta/:type/:id.json',
        count: 4,
        errors5xx: 0,
        errors4xx: 0,
        avgMs: 20,
        p95Ms: 40,
      },
    ],
    statusCodes: {},
    latencyHistogram: { bounds: [100], counts: [4, 0] },
    breakdowns: { resources: [] },
  });

  render(<AdminApp />);

  expect(await screen.findByText('configs in range')).toBeInTheDocument();
  expect(screen.getByText('40ms')).toBeInTheDocument();
  const zeroCell = screen
    .getAllByText('0')
    .find((element) => element.className.includes('adm-text-bad'));
  expect(zeroCell).toBeUndefined();
});

it('distinguishes all-time error-group counts from range sparkline samples', async () => {
  window.location.hash = '/errors?range=7d&status=all';
  adminApi.errors.mockResolvedValueOnce({
    groups: [
      {
        fingerprint: 'fp1',
        level: 'error',
        context: 'tmdb:client',
        message: 'Fetch failed',
        status: 'open',
        count: 100,
        spark: [[1, 3]],
        first_seen: '2026-10-01T00:00:00Z',
        last_seen: '2026-11-01T00:00:00Z',
      },
    ],
    version: '2.12.0',
  });

  render(<AdminApp />);

  expect(await screen.findByText('All-time')).toBeInTheDocument();
  expect(screen.getByText('In range')).toBeInTheDocument();
});

it('sends heaviest sorting and upper-duration filters and shows total stored matches', async () => {
  window.location.hash = '/requests?range=1h&view=events&maxMs=5000&minUpstreamCalls=10';
  adminApi.requests.mockResolvedValue({ rows: [requestRow], total: 345, nextCursor: null });
  render(<AdminApp />);
  expect(await screen.findByText('345 requests')).toBeInTheDocument();
  expect(adminApi.requests).toHaveBeenCalledWith(
    expect.objectContaining({ maxMs: '5000', minUpstreamCalls: '10' })
  );
  fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'upstream' } });
  await waitFor(() =>
    expect(adminApi.requests).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: 'upstream', maxMs: '5000' })
    )
  );
});

it('keeps the first page time bounds when loading another page of a rolling range', async () => {
  window.location.hash = '/requests?range=1h&view=events&sort=duration';
  adminApi.requests
    .mockResolvedValueOnce({
      rows: [requestRow],
      total: 2,
      nextCursor: 'next',
      range: { from: 1000, to: 2000 },
    })
    .mockResolvedValueOnce({ rows: [], total: 2, nextCursor: null });
  render(<AdminApp />);
  fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));
  await waitFor(() =>
    expect(adminApi.requests).toHaveBeenLastCalledWith({
      range: 'custom',
      from: 1000,
      to: 2000,
      sort: 'duration',
      cursor: 'next',
      limit: 100,
    })
  );
});

it('provides a keyboard-accessible custom interval without chart dragging', async () => {
  render(<AdminApp />);
  fireEvent.click(await screen.findByText('Custom interval'));
  fireEvent.change(screen.getByLabelText('From (local time)'), {
    target: { value: '2026-11-01T10:00' },
  });

  fireEvent.change(screen.getByLabelText('To (local time)'), {
    target: { value: '2026-11-01T11:00' },
  });
  fireEvent.submit(screen.getByRole('button', { name: 'Apply interval' }).closest('form'));
  await waitFor(() =>
    expect(adminApi.overview).toHaveBeenLastCalledWith({
      range: 'custom',
      from: new Date('2026-11-01T10:00').getTime(),
      to: new Date('2026-11-01T11:00').getTime(),
    })
  );
});

it('does not silently load 1h for an invalid custom interval URL', async () => {
  window.location.hash = '/overview?range=custom&from=invalid&to=2';
  render(<AdminApp />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Invalid custom interval');
  expect(adminApi.overview).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '1h', exact: true }));
  await waitFor(() => expect(adminApi.overview).toHaveBeenCalledWith({ range: '1h' }));
});

it('does not badge fingerprint versions and filters by log classification', async () => {
  window.location.hash = '/errors?range=7d';
  adminApi.errors.mockResolvedValue({
    version: '2.12.1',
    groups: [
      {
        fingerprint: 'changed',
        context: 'tmdb',
        message: 'Invalid API key',
        classification: 'user_config',
        first_version: '2.12.1',
        status: 'open',
        count: 10,
        spark: [[1, 10]],
      },
    ],
  });
  render(<AdminApp />);
  expect(await screen.findByText('Invalid API key')).toBeInTheDocument();
  expect(screen.queryByText(/fingerprint first seen|new in v2\.12\.1/)).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Log classification'), {
    target: { value: 'user_config' },
  });
  await waitFor(() =>
    expect(adminApi.errors).toHaveBeenLastCalledWith(
      expect.objectContaining({ classification: 'user_config' })
    )
  );
});

it('keeps live-tail omissions separate from omitted history records', async () => {
  render(
    <System
      range="1h"
      meta={{
        collector: {
          dropped: { requests: 2, upstream: 3, errors: 1, storageCap: 4, tail: 7 },
          failedWrites: { liveBatches: 0, historyBatches: 0, historyRecords: 0 },
          lastFlushAt: new Date().toISOString(),
          lastFlushMs: 20,
        },
      }}
    />
  );

  expect(
    await screen.findByText(/10 raw records omitted · 7 live-tail entries omitted/)
  ).toBeInTheDocument();
});

it('uses the configured slow threshold for the Overview drilldown', async () => {
  adminApi.meta.mockResolvedValueOnce({ capabilities: {}, slowMs: 2500 });
  render(<AdminApp />);

  fireEvent.click(await screen.findByRole('button', { name: /Slow requests/ }));

  await waitFor(() =>
    expect(adminApi.requests).toHaveBeenCalledWith(expect.objectContaining({ minMs: '2500' }))
  );
});

it('groups requests by route by default and drills into a group with include or exclude', async () => {
  window.location.hash = '/requests?range=6h';
  render(<AdminApp />);
  await waitFor(() => expect(adminApi.groups).toHaveBeenCalledWith({ range: '6h', by: 'route' }));
  expect(await screen.findByText('/meta/:type/:id.json')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Exclude /meta/:type/:id.json' }));
  await waitFor(() =>
    expect(adminApi.groups).toHaveBeenLastCalledWith({
      range: '6h',
      by: 'route',
      notRoute: '/meta/:type/:id.json',
    })
  );
  expect(
    screen.getByRole('button', { name: 'Remove filter: Route is not /meta/:type/:id.json' })
  ).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: requestRow.route }));
  await waitFor(() =>
    expect(adminApi.requests).toHaveBeenCalledWith(
      expect.objectContaining({
        range: '6h',
        route: requestRow.route,
        notRoute: '/meta/:type/:id.json',
      })
    )
  );
  expect(screen.getByRole('tab', { name: 'Events' })).toHaveAttribute('aria-selected', 'true');
});

it('switches the group-by dimension without losing filters', async () => {
  window.location.hash = '/requests?range=6h&notStatus=4xx';
  render(<AdminApp />);
  fireEvent.click(await screen.findByRole('button', { name: 'Status' }));
  await waitFor(() =>
    expect(adminApi.groups).toHaveBeenLastCalledWith({
      range: '6h',
      by: 'status',
      notStatus: '4xx',
    })
  );
});

it('removes the noise toggle but keeps explicit route exclusions visible and removable', async () => {
  window.location.hash = '/overview?range=24h&notRoute=(unmatched)';
  render(<AdminApp />);
  await screen.findByRole('button', { name: 'Remove filter: Route is not (unmatched)' });
  expect(screen.queryByLabelText('Hide config-less & unmatched')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
  await waitFor(() => expect(adminApi.overview).toHaveBeenLastCalledWith({ range: '24h' }));
});

it('links overview cache percentages to caching analytics and preserves filters when drilling', async () => {
  window.location.hash = '/overview?range=6h&source=tmdb';
  render(<AdminApp />);
  const card = await screen.findByRole('button', { name: /Cache lookup hit rate/ });
  expect(card).toHaveTextContent('75.00%');
  fireEvent.click(card);
  await waitFor(() =>
    expect(adminApi.caching).toHaveBeenCalledWith({ range: '6h', source: 'tmdb', by: 'route' })
  );
  expect(await screen.findByText('Miss + upstream')).toBeInTheDocument();
  expect(screen.getByText('META_HEADER')).toBeInTheDocument();
  expect(screen.getByText('1d')).toBeInTheDocument();
  expect(screen.getByRole('cell', { name: '75' })).toHaveAttribute('data-label', 'Hits');
  fireEvent.change(screen.getByLabelText('Cache grouping'), { target: { value: 'path' } });
  await waitFor(() =>
    expect(adminApi.caching).toHaveBeenLastCalledWith({ range: '6h', source: 'tmdb', by: 'path' })
  );
  fireEvent.click(screen.getByRole('button', { name: requestRow.route }));
  await waitFor(() =>
    expect(adminApi.requests).toHaveBeenCalledWith(
      expect.objectContaining({ range: '6h', source: 'tmdb', q: requestRow.route })
    )
  );
});

it('shows unavailable cache history without inventing zero rates and retains the TTL inventory', async () => {
  window.location.hash = '/caching?range=1h';
  adminApi.caching.mockResolvedValue({
    analytics: null,
    ttls: [{ scope: 'Shared', name: 'DETAIL', seconds: 3600 }],
  });
  render(<AdminApp />);
  expect(await screen.findByText(/Request history is unavailable/)).toBeInTheDocument();
  expect(screen.getByText('DETAIL')).toBeInTheDocument();
  expect(screen.queryByText('Lookup hit rate')).not.toBeInTheDocument();
});

it('shows no-lookup rates as unavailable and preserves custom cache time bounds', async () => {
  const from = Date.now() - 3_600_000;
  const to = Date.now();
  window.location.hash = `/caching?range=custom&from=${from}&to=${to}&source=tmdb`;
  adminApi.caching.mockResolvedValue({
    sampled: true,
    analytics: {
      totals: {
        requests: 0,
        hits: 0,
        misses: 0,
        allHits: 0,
        mixed: 0,
        missesOnly: 0,
        missesWithUpstream: 0,
      },
      groups: [],
    },
    ttls: [],
  });
  render(<AdminApp />);
  expect(
    await screen.findByText('No recorded cache hits or misses in this range.')
  ).toBeInTheDocument();
  expect(screen.getByText('Lookup hit rate').parentElement).not.toHaveTextContent('0.00%');
  expect(screen.getByText(/weighted estimates from sampled retained requests/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Cache grouping'), { target: { value: 'path' } });
  await waitFor(() =>
    expect(adminApi.caching).toHaveBeenLastCalledWith({
      range: 'custom',
      from,
      to,
      source: 'tmdb',
      by: 'path',
    })
  );
});

it('distinguishes Redis cache/live counters from retained memory history and legacy detail', async () => {
  const base = await adminApi.caching();
  const read = { freshHits: 4, staleHits: 2, misses: 4, cachedErrors: 7, readErrors: 3 };
  window.location.hash = '/caching?range=7d';
  adminApi.caching.mockResolvedValue({
    ...base,
    analytics: {
      ...base.analytics,
      coverage: {
        retainedRequests: 5,
        detailedRequests: 3,
        oldest: requestRow.ts,
        newest: requestRow.ts,
        detailedOldest: requestRow.ts,
      },
      details: { totals: read, layers: [{ key: 'tmdb_api', ...read }] },
    },
    history: {
      backend: 'memory',
      cacheBackend: 'redis',
      backgroundWork: { started: 12, skipped: 3, active: 1, limit: 2, enabled: true },
      liveBackend: 'redis',
      retentionDays: 7,
      storage: { memory: { requests: 500, capacity: 3000 } },
    },
  });
  render(<AdminApp />);
  expect(await screen.findByText('History coverage')).toBeInTheDocument();
  expect(screen.getByText('memory')).toBeInTheDocument();
  expect(screen.getAllByText('redis')).toHaveLength(2);
  expect(screen.getByText(/500 \/ 3,000 request rows/)).toBeInTheDocument();
  expect(screen.getByText(/Opportunistic work on this process/)).toHaveTextContent(
    '12 started, 3 skip events, 1 / 2 active'
  );
  expect(screen.getByText(/5 retained request rows/)).toHaveTextContent(
    '3 have detailed cache instrumentation'
  );
  expect(
    screen.getByText(/Selecting a time range does not guarantee complete history/)
  ).toBeInTheDocument();
  expect(
    screen.getByText(/2 retained request rows lack layer\/freshness\/error detail/)
  ).toBeInTheDocument();
  expect(
    screen.getByText('Fresh hits', { selector: '.adm-stat-label' }).parentElement
  ).toHaveTextContent('20.00% of 20 detailed read attempts');
  expect(
    screen.getByText('Stale hits', { selector: '.adm-stat-label' }).parentElement
  ).toHaveTextContent('10.00%');
  expect(
    screen.getByText('Read failures', { selector: '.adm-stat-label' }).parentElement
  ).toHaveTextContent('15.00%');
  expect(screen.getByText('Lookup hit rate').parentElement).toHaveTextContent('75.00%');
  const layer = screen.getByText('TMDB API responses').closest('tr');
  expect(layer).toHaveTextContent('60.00%');
});

it.each([
  ['legacy', 0, 'Detailed cache outcomes are unavailable for these records.'],
  ['no reads', 1, 'No instrumented shared-cache reads in detailed records.'],
  ['errors only', 1, null],
])(
  'renders %s cache history without inventing successful lookups',
  async (kind, detailedRequests, emptyText) => {
    const base = await adminApi.caching();
    const read = {
      freshHits: 0,
      staleHits: 0,
      misses: 0,
      cachedErrors: kind === 'errors only' ? 1 : 0,
      readErrors: kind === 'errors only' ? 2 : 0,
    };
    window.location.hash = '/caching?range=1h';
    adminApi.caching.mockResolvedValue({
      ...base,
      analytics: {
        totals: {
          requests: 0,
          hits: 0,
          misses: 0,
          allHits: 0,
          mixed: 0,
          missesOnly: 0,
          missesWithUpstream: 0,
        },
        groups: [],
        coverage: {
          retainedRequests: 1,
          detailedRequests,
          oldest: requestRow.ts,
          newest: requestRow.ts,
          detailedOldest: detailedRequests ? requestRow.ts : null,
        },
        details: { totals: read, layers: kind === 'errors only' ? [{ key: 'imdb', ...read }] : [] },
      },
      history: {
        backend: 'postgres',
        cacheBackend: 'redis',
        liveBackend: 'redis',
        retentionDays: 7,
        storage: { totalBytes: 1024, capBytes: 2048, paused: true },
        collector: {
          storagePaused: true,
          dropped: { requests: 2, storageCap: 3 },
          failedWrites: { historyRecords: 4 },
          lastFlushError: 'database unavailable',
        },
      },
    });
    render(<AdminApp />);
    expect(await screen.findByText('Cache read outcomes by layer')).toBeInTheDocument();
    expect(screen.getByText(/history collection is paused by the storage cap/)).toBeInTheDocument();
    expect(screen.getByText(/not scoped to the selected interval/)).toHaveTextContent(
      '4 failed history-record writes'
    );
    expect(screen.getByText(/Latest collector flush error/)).toHaveTextContent(
      'database unavailable'
    );
    expect(screen.getByText('Lookup hit rate').parentElement).not.toHaveTextContent('0.00%');
    if (emptyText) expect(screen.getByText(emptyText)).toBeInTheDocument();
    if (kind === 'legacy') {
      expect(
        screen.queryByText('Fresh hits', { selector: '.adm-stat-label' })
      ).not.toBeInTheDocument();
    } else if (kind === 'errors only') {
      expect(
        screen.getByText('Read failures', { selector: '.adm-stat-label' }).parentElement
      ).toHaveTextContent('66.67% of 3 detailed read attempts');
      expect(
        screen.getByText('Cached errors', { selector: '.adm-stat-label' }).parentElement
      ).toHaveTextContent('33.33%');
      expect(screen.getByText('IMDb data / cursors').closest('tr')).not.toHaveTextContent('0.00%');
    }
  }
);

it('starts each page at the top instead of keeping the previous page scroll offset', async () => {
  const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  render(<AdminApp />);
  await screen.findByRole('link', { name: 'Errors' });
  scrollTo.mockClear();
  fireEvent.click(screen.getByRole('link', { name: 'Errors' }));
  await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(0, 0));
  scrollTo.mockClear();
  navigate('errors', { range: '24h', status: 'all' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(scrollTo).not.toHaveBeenCalled();
  scrollTo.mockRestore();
});
