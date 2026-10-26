import { useMemo } from 'react';
import { adminApi } from '../api.js';
import { useAsync, navigate } from '../hooks.js';
import { TimeChart } from '../components/TimeChart.jsx';
import { BarList, ErrorNote, Loading, Panel, StatCard } from '../components/ui.jsx';
import { delta, fmtBucketMs, fmtInt, fmtMs, fmtPct } from '../format.js';

const REQUEST_SERIES = [
  { label: 'Requests' },
  { label: '5xx', color: '#ef4444' },
  { label: '4xx', color: '#facc15' },
];
const LATENCY_SERIES = [
  { label: 'Avg', color: '#4a9eff' },
  { label: 'p95 (≤)', color: '#c084fc' },
];
const LOG_SERIES = [
  { label: 'Errors logged', color: '#ef4444' },
  { label: 'Warnings logged', color: '#facc15' },
];

function Trend({ current, previous, invert }) {
  const d = delta(current, previous);
  if (d === null || !Number.isFinite(d)) return null;
  const worse = invert ? d < 0 : d > 0;
  return (
    <span className={worse ? 'adm-text-bad' : 'adm-text-good'}>
      {d > 0 ? '▲' : '▼'} {Math.abs(d * 100).toFixed(0)}% vs previous
    </span>
  );
}

export function Overview({ range }) {
  const { data, error, loading } = useAsync(() => adminApi.overview({ range }), [range], {
    pollMs: 30_000,
  });

  const charts = useMemo(() => {
    if (!data) return null;
    const s = data.series;
    return {
      requests: [s.t, s.requests, s.errors5xx, s.errors4xx],
      latency: [s.t, s.avgMs, s.p95Ms],
      logs: [s.t, s.logErrors, s.logWarnings],
    };
  }, [data]);

  if (loading && !data) return <Loading />;
  if (!data) return <ErrorNote error={error} />;
  const { totals, previous } = data;
  const spike =
    previous && totals.errorRate > 0.01 && totals.errorRate > (previous.errorRate || 0) * 2;

  return (
    <div className="adm-stack">
      <ErrorNote error={error} />
      {spike && (
        <div className="adm-alert adm-tone-bad">
          Error rate is {fmtPct(totals.errorRate)}, more than double the previous period (
          {fmtPct(previous.errorRate)}).
        </div>
      )}
      <div className="adm-stats">
        <StatCard
          label="Requests"
          value={fmtInt(totals.requests)}
          sub={<Trend current={totals.requests} previous={previous?.requests} invert />}
        />
        <StatCard
          label="5xx error rate"
          value={fmtPct(totals.errorRate)}
          tone={totals.errorRate > 0.01 ? 'bad' : 'good'}
          sub={`${fmtInt(totals.errors5xx)} errors · ${fmtInt(totals.errors4xx)} 4xx`}
        />
        <StatCard
          label="Latency p95"
          value={fmtBucketMs(totals.p95Ms)}
          sub={`avg ${fmtMs(totals.avgMs)} · p99 ${fmtBucketMs(totals.p99Ms)}`}
        />
        <StatCard
          label="Slow requests"
          value={fmtInt(totals.slow)}
          tone={totals.slow ? 'warn' : undefined}
        />
        <StatCard
          label="Unique configs"
          value={fmtInt(totals.uniqueUsers)}
          sub="approx. (HyperLogLog)"
        />
        <StatCard label="Cache hit rate" value={fmtPct(totals.cacheHitRate, 1)} />
        <StatCard
          label="Logged errors / warnings"
          value={`${fmtInt(totals.logErrors)} / ${fmtInt(totals.logWarnings)}`}
          tone={totals.logErrors ? 'bad' : undefined}
          sub={
            <button type="button" className="adm-link" onClick={() => navigate('errors')}>
              View errors →
            </button>
          }
        />
      </div>

      <Panel title={`Traffic (per ${data.range.resolution})`}>
        <TimeChart data={charts.requests} series={REQUEST_SERIES} />
      </Panel>
      <div className="adm-grid-2">
        <Panel title="Latency">
          <TimeChart data={charts.latency} series={LATENCY_SERIES} yLabel="ms" height={200} />
        </Panel>
        <Panel title="Logged errors & warnings">
          <TimeChart data={charts.logs} series={LOG_SERIES} height={200} />
        </Panel>
      </div>

      <Panel
        title="Routes"
        actions={<span className="adm-muted">click a row to inspect requests</span>}
      >
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>Route</th>
                <th className="num">Requests</th>
                <th className="num">5xx</th>
                <th className="num">4xx</th>
                <th className="num">Avg</th>
              </tr>
            </thead>
            <tbody>
              {data.routes.slice(0, 40).map((r) => (
                <tr
                  key={r.route}
                  className="adm-clickable"
                  onClick={() => navigate('requests', { range, route: r.route })}
                >
                  <td className="mono">{r.route}</td>
                  <td className="num">{fmtInt(r.count)}</td>
                  <td className={`num ${r.errors5xx ? 'adm-text-bad' : ''}`}>
                    {fmtInt(r.errors5xx)}
                  </td>
                  <td className={`num ${r.errors4xx ? 'adm-text-warn' : ''}`}>
                    {fmtInt(r.errors4xx)}
                  </td>
                  <td className="num">{fmtMs(r.avgMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="adm-grid-3">
        <Panel title="Status codes">
          <BarList
            items={Object.entries(data.statusCodes)
              .map(([key, count]) => ({ key, count }))
              .sort((a, b) => b.count - a.count)}
            onSelect={(status) => navigate('requests', { range, status })}
          />
        </Panel>
        <Panel title="Latency distribution">
          <BarList
            items={data.latencyHistogram.counts.map((count, i) => ({
              key:
                i < data.latencyHistogram.bounds.length
                  ? `≤ ${fmtMs(data.latencyHistogram.bounds[i])}`
                  : `> ${fmtMs(data.latencyHistogram.bounds.at(-1))}`,
              count,
            }))}
          />
        </Panel>
        <Panel title="Addon resources">
          <BarList
            items={data.breakdowns.resources}
            onSelect={(resource) => navigate('requests', { range, resource })}
          />
        </Panel>
      </div>
    </div>
  );
}
