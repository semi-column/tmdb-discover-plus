import { useMemo } from 'react';
import { adminApi } from '../api.js';
import { useAsync, navigate } from '../hooks.js';
import { TimeChart } from '../components/TimeChart.jsx';
import { FilterBar } from '../components/FilterBar.jsx';
import { Badge, BarList, ErrorNote, Loading, Panel, StatCard } from '../components/ui.jsx';
import { delta, fmtBucketMs, fmtInt, fmtMs, fmtPct } from '../format.js';
import { addFilter, pickFilters } from '../filters.js';

const TRAFFIC_SERIES = [
  { label: '2xx/3xx', color: '#70d7b6' },
  { label: '4xx', color: '#edc36a' },
  { label: '5xx', color: '#f18683' },
];
const LATENCY_SERIES = [
  { label: 'Avg', color: '#8cbbe8' },
  { label: 'p95', color: '#c084fc' },
];
const TOP = 8;

function Trend({ current, previous, invert }) {
  const d = delta(current, previous);
  if (d === null || !Number.isFinite(d) || Math.abs(d) < 0.005) return null;
  const worse = invert ? d < 0 : d > 0;
  return (
    <span className={worse ? 'adm-text-bad' : 'adm-text-good'}>
      {d > 0 ? '▲' : '▼'} {Math.abs(d * 100).toFixed(0)}% vs previous
    </span>
  );
}

function TopErrors({ rangeParams, range }) {
  const { data, error, loading } = useAsync(
    () => adminApi.errors({ ...rangeParams, status: 'active' }),
    [range, rangeParams.from, rangeParams.to],
    { pollMs: 60_000 }
  );
  const groups = (data?.groups || [])
    .map((g) => ({ ...g, inRange: Number(g.range_count ?? g.count) }))
    .filter((g) => g.inRange > 0)
    .sort((a, b) => b.inRange - a.inRange)
    .slice(0, 6);
  return (
    <Panel
      title="Top errors"
      actions={
        <button type="button" className="adm-link" onClick={() => navigate('errors', { range })}>
          All errors →
        </button>
      }
    >
      <ErrorNote error={error} />
      {loading && !data ? (
        <Loading />
      ) : groups.length === 0 ? (
        <div className="adm-empty">No open errors in this range.</div>
      ) : (
        <ul className="adm-toplist">
          {groups.map((g) => (
            <li key={g.fingerprint}>
              <button
                type="button"
                className="adm-toplist-row"
                onClick={() => navigate('errors', { range, fp: g.fingerprint })}
              >
                <Badge tone={g.level === 'error' ? 'bad' : 'warn'}>{g.level}</Badge>
                <span className="adm-toplist-main">
                  <span className="adm-ellipsis mono" title={g.message}>
                    {g.message}
                  </span>
                  <span className="adm-muted">
                    {g.context}
                    {g.classification === 'user_config' ? ' · user config' : ''}
                  </span>
                </span>
                <span className="num">{fmtInt(g.inRange)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function Overview({ range, rangeParams = { range }, params = {}, meta, onSelectRange }) {
  const filters = pickFilters(params);
  const filterKey = JSON.stringify(filters);
  const { data, error, loading } = useAsync(
    () => adminApi.overview({ ...rangeParams, ...filters }),
    [range, rangeParams.from, rangeParams.to, filterKey],
    { pollMs: 30_000 }
  );
  const facets = useAsync(
    () => adminApi.facets(rangeParams),
    [range, rangeParams.from, rangeParams.to]
  );
  const charts = useMemo(() => {
    if (!data?.series?.t) return null;
    const s = data.series;
    return {
      traffic: [
        s.t,
        s.requests.map((n, i) => n - s.errors4xx[i] - s.errors5xx[i]),
        s.errors4xx,
        s.errors5xx,
      ],
      latency: [s.t, s.avgMs, s.p95Ms],
    };
  }, [data]);

  const setFilters = (next) => navigate('overview', { ...rangeParams, ...next });
  const drill = (extra) => navigate('requests', { ...rangeParams, ...filters, ...extra });

  if (loading && !data) return <Loading />;
  if (!data) return <ErrorNote error={error} />;
  const { totals, previous } = data;
  const slowMs = meta?.slowMs ?? 1500;
  const percentile = data.percentilesApproximate
    ? (value) => fmtBucketMs(value, data.latencyHistogram?.bounds?.at(-1))
    : fmtMs;
  const rate = (n) => (totals.requests ? n / totals.requests : 0);
  const breakdown = (list) => (list || []).slice(0, TOP);
  const statusItems = Object.entries(data.statusCodes || {})
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP);

  return (
    <div className="adm-stack">
      <FilterBar filters={filters} facets={facets.data} onChange={setFilters} />
      <ErrorNote error={error} />
      {data.dataSource === 'redis-live-fallback' && (
        <div className="adm-alert adm-tone-warn" role="status">
          History is unavailable. Showing Redis live counters
          {data.filtersIgnored ? '; filters are not applied' : ''}.
        </div>
      )}

      <div className="adm-stats">
        <StatCard
          label="Requests"
          value={fmtInt(totals.requests)}
          onClick={() => drill({})}
          sub={<Trend current={totals.requests} previous={previous?.requests} invert />}
        />
        <StatCard
          label="Active users"
          value={fmtInt(data.activeUsersNow ?? totals.uniqueUsers)}
          sub={
            data.activeUsersNow != null
              ? `last ${data.activeWindowMinutes ?? 15} min · ${fmtInt(totals.uniqueUsers)} in range`
              : 'configs in range'
          }
        />
        <StatCard
          label="Error rate"
          value={fmtPct(totals.errorRate ?? rate(totals.errors5xx))}
          tone={(totals.errorRate ?? 0) > 0.01 ? 'bad' : undefined}
          onClick={() => drill({ view: 'events', status: '5xx' })}
          sub={`${fmtInt(totals.errors5xx)} 5xx · ${fmtInt(totals.errors4xx)} 4xx`}
        />
        <StatCard
          label="Latency p95"
          value={percentile(totals.p95Ms)}
          onClick={() => drill({ view: 'events', sort: 'duration' })}
          sub={`p50 ${percentile(totals.p50Ms)} · p99 ${percentile(totals.p99Ms)}`}
        />
        <StatCard
          label="Slow requests"
          value={fmtInt(totals.slow)}
          tone={rate(totals.slow) > 0.15 ? 'warn' : undefined}
          onClick={() => drill({ view: 'events', minMs: slowMs })}
          sub={`${fmtPct(rate(totals.slow), 1)} ≥ ${fmtMs(slowMs)}`}
        />
        <StatCard
          label="Cache lookup hit rate"
          value={fmtPct(totals.cacheHitRate)}
          onClick={() => navigate('caching', { ...rangeParams, ...filters })}
          sub={`${fmtInt(totals.cacheHits)} hits · ${fmtInt(totals.cacheMisses)} misses · ${fmtPct(totals.cacheHitRate == null ? null : 1 - totals.cacheHitRate)} miss rate`}
        />
        <StatCard
          label="Logged errors"
          value={fmtInt(totals.logErrors)}
          onClick={() => navigate('errors', rangeParams)}
          sub={`${fmtInt(totals.logWarnings)} warnings`}
        />
      </div>

      <div className="adm-grid-2">
        <Panel title="Traffic">
          {charts ? (
            <TimeChart
              data={charts.traffic}
              series={TRAFFIC_SERIES}
              onSelectRange={onSelectRange}
            />
          ) : (
            <div className="adm-empty">No data in this range</div>
          )}
        </Panel>
        <Panel title="Latency">
          {charts ? (
            <TimeChart
              data={charts.latency}
              series={LATENCY_SERIES}
              yLabel="ms"
              onSelectRange={onSelectRange}
            />
          ) : (
            <div className="adm-empty">No data in this range</div>
          )}
        </Panel>
      </div>

      <div className="adm-grid-2">
        <Panel
          title="Top routes"
          actions={
            <button type="button" className="adm-link" onClick={() => drill({ by: 'route' })}>
              Group by route →
            </button>
          }
        >
          <div className="adm-table-wrap">
            <table className="adm-table adm-table-compact adm-table-stack">
              <thead>
                <tr>
                  <th>Route</th>
                  <th className="num">Requests</th>
                  <th className="num">Errors</th>
                  <th className="num">p95</th>
                </tr>
              </thead>
              <tbody>
                {(data.routes || []).slice(0, TOP).map((r) => {
                  const errors = Number(r.errors5xx) + Number(r.errors4xx);
                  return (
                    <tr key={r.route}>
                      <td className="mono adm-ellipsis" title={r.route}>
                        <button
                          type="button"
                          className="adm-link mono"
                          onClick={() => setFilters(addFilter(filters, 'route', r.route))}
                        >
                          {r.route}
                        </button>
                      </td>
                      <td data-label="Requests" className="num">
                        {fmtInt(r.count)}
                      </td>
                      <td
                        data-label="Errors"
                        className={`num ${Number(r.errors5xx) > 0 ? 'adm-text-bad' : errors ? 'adm-text-warn' : ''}`}
                      >
                        {errors ? fmtPct(errors / r.count, 1) : '–'}
                      </td>
                      <td data-label="p95" className="num">
                        {data.routePercentilesApproximate
                          ? fmtBucketMs(r.p95Ms, data.latencyHistogram?.bounds?.at(-1))
                          : fmtMs(r.p95Ms)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
        <TopErrors rangeParams={rangeParams} range={range} />
      </div>

      <div className="adm-grid-4">
        {[
          ['Status codes', 'status', statusItems],
          ['Sources', 'source', breakdown(data.breakdowns?.sources)],
          ['Clients', 'client', breakdown(data.breakdowns?.clients)],
          ['Countries', 'country', breakdown(data.breakdowns?.countries)],
        ].map(([title, key, items]) => (
          <Panel key={key} title={title}>
            <BarList
              items={items}
              onSelect={(value) => setFilters(addFilter(filters, key, value))}
            />
          </Panel>
        ))}
      </div>
    </div>
  );
}
