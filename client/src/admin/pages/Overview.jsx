import { useMemo } from 'react';
import { adminApi } from '../api.js';
import { useAsync, navigate } from '../hooks.js';
import { TimeChart } from '../components/TimeChart.jsx';
import { AttentionSummary } from '../components/AttentionSummary.jsx';
import { BarList, ErrorNote, Loading, Panel, StatCard } from '../components/ui.jsx';
import { delta, fmtBucketMs, fmtInt, fmtMs, fmtPct } from '../format.js';

const REQUEST_SERIES = [
  { label: 'Requests' },
  { label: '5xx', color: '#f18683' },
  { label: '4xx', color: '#edc36a' },
];
const LATENCY_SERIES = [
  { label: 'Avg', color: '#70d7b6' },
  { label: 'p95 (≤)', color: '#8cbbe8' },
];
const LOG_SERIES = [
  { label: 'Error samples', color: '#f18683' },
  { label: 'Warning samples', color: '#edc36a' },
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

export function Overview({ range, meta }) {
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
  const slowMs = meta?.slowMs ?? 1500;
  const spike =
    previous && totals.errorRate > 0.01 && totals.errorRate > (previous.errorRate || 0) * 2;

  return (
    <div className="adm-stack">
      <ErrorNote error={error} />
      {data.dataSource === 'redis-live-fallback' && (
        <div className="adm-alert adm-tone-warn" role="status">
          History is unavailable. Showing Redis live counters; totals use {data.totalsResolution}
          buckets while route/status breakdowns use {data.breakdownResolution} buckets. Older ranges
          may also be incomplete.
        </div>
      )}
      {data.comparisonAvailable === false && (
        <div className="adm-muted" role="status">
          Previous-period comparison unavailable: the earlier window is outside retained history.
        </div>
      )}
      <AttentionSummary totals={totals} range={range} />
      {spike && (
        <div className="adm-alert adm-tone-bad">
          Error rate is {fmtPct(totals.errorRate)}, more than double the previous period (
          {fmtPct(previous.errorRate)}).
        </div>
      )}
      <div className="adm-stats">
        <StatCard
          label="HTTP requests (all routes)"
          value={fmtInt(totals.requests)}
          onClick={() => navigate('requests', { range })}
          sub={<Trend current={totals.requests} previous={previous?.requests} invert />}
        />
        <StatCard
          label="5xx error rate"
          value={fmtPct(totals.errorRate)}
          onClick={() => navigate('requests', { range, status: '5xx' })}
          tone={totals.errorRate > 0.01 ? 'bad' : 'good'}
          sub={`${fmtInt(totals.errors5xx)} errors · ${fmtInt(totals.errors4xx)} 4xx`}
        />
        <StatCard
          label="Latency p95"
          value={fmtBucketMs(totals.p95Ms, data.latencyHistogram.bounds.at(-1))}
          onClick={() => navigate('requests', { range, tab: 'routes' })}
          sub={`avg ${fmtMs(totals.avgMs)} · p99 ${fmtBucketMs(totals.p99Ms, data.latencyHistogram.bounds.at(-1))}`}
        />
        <StatCard
          label="Slow requests"
          value={fmtInt(totals.slow)}
          onClick={() => navigate('requests', { range, minMs: slowMs })}
          sub={`≥ ${fmtMs(slowMs)}`}
          tone={totals.slow ? 'warn' : undefined}
        />
        <StatCard
          label="Unique configs"
          value={fmtInt(totals.uniqueUsers)}
          sub={
            data.uniqueUsersApproximate
              ? data.dataSource === 'redis-live-fallback'
                ? 'approx. (HyperLogLog)'
                : 'approx. (sampled or bounded history)'
              : 'distinct config hashes'
          }
        />
        <StatCard label="Cache lookup hit rate" value={fmtPct(totals.cacheHitRate, 1)} />
        <StatCard
          label="Captured log samples: errors / warnings"
          value={`${fmtInt(totals.logErrors)} / ${fmtInt(totals.logWarnings)}`}
          tone={totals.logErrors ? 'warn' : undefined}
          sub={
            <button
              type="button"
              className="adm-link"
              onClick={() => navigate('errors', { range, status: 'all' })}
            >
              Investigate logs →
            </button>
          }
        />
      </div>

      <div className="adm-grid-2">
        <Panel title={`Traffic (per ${data.range.resolution})`}>
          <TimeChart data={charts.requests} series={REQUEST_SERIES} />
        </Panel>
        <Panel title="Latency">
          <TimeChart data={charts.latency} series={LATENCY_SERIES} yLabel="ms" height={200} />
        </Panel>
      </div>

      <details className="adm-secondary">
        <summary>
          Captured log samples · {fmtInt(totals.logErrors)} errors / {fmtInt(totals.logWarnings)}{' '}
          warnings
        </summary>
        <p className="adm-muted">
          Samples are capped per fingerprint and can be fewer than the occurrence totals shown in
          Errors.
        </p>
        <TimeChart data={charts.logs} series={LOG_SERIES} height={200} />
      </details>

      <Panel
        title="Routes"
        actions={<span className="adm-muted">{fmtInt(data.routes.length)} routes</span>}
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
                <th className="num">p95{data.routePercentilesApproximate ? ' (≤)' : ''}</th>
              </tr>
            </thead>
            <tbody>
              {data.routes.slice(0, 40).map((r) => (
                <tr key={r.route} className="adm-clickable">
                  <td className="mono">
                    <button
                      type="button"
                      className="adm-link mono"
                      onClick={() => navigate('requests', { range, route: r.route })}
                    >
                      {r.route === '(unmatched)' ? '(unmatched / SPA fallback)' : r.route}
                    </button>
                  </td>
                  <td className="num">{fmtInt(r.count)}</td>
                  <td className={`num ${Number(r.errors5xx) > 0 ? 'adm-text-bad' : ''}`}>
                    {fmtInt(r.errors5xx)}
                  </td>
                  <td className={`num ${Number(r.errors4xx) > 0 ? 'adm-text-warn' : ''}`}>
                    {fmtInt(r.errors4xx)}
                  </td>
                  <td className="num">{fmtMs(r.avgMs)}</td>
                  <td className="num">
                    {data.routePercentilesApproximate
                      ? fmtBucketMs(r.p95Ms, data.latencyHistogram.bounds.at(-1))
                      : fmtMs(r.p95Ms)}
                  </td>
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
              minMs: i ? data.latencyHistogram.bounds[i - 1] + 1 : 0,
            }))}
            onSelect={(_label, bucket) => navigate('requests', { range, minMs: bucket.minMs })}
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
