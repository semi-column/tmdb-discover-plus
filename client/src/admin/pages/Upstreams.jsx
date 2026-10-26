import { useMemo } from 'react';
import { adminApi } from '../api.js';
import { useAsync, navigate } from '../hooks.js';
import { TimeChart } from '../components/TimeChart.jsx';
import { Badge, ErrorNote, Loading, Panel, StatCard } from '../components/ui.jsx';
import { fmtBucketMs, fmtInt, fmtMs, fmtPct, fmtTime, statusTone } from '../format.js';

export function Upstreams({ range, params, onOpenTrace, meta }) {
  const formatPercentile = meta?.capabilities?.approximatePercentiles ? fmtBucketMs : fmtMs;
  const provider = params.provider || '';
  const { data, error, loading } = useAsync(
    () => adminApi.upstreams({ range, provider }),
    [range, provider],
    {
      pollMs: 60_000,
    }
  );

  const charts = useMemo(() => {
    const providers = data?.providers?.slice(0, 8) || [];
    if (!providers.length) return null;
    const t = providers[0].series.t;
    const series = providers.map((p) => ({ label: p.provider }));
    return {
      series,
      calls: [t, ...providers.map((p) => p.series.calls)],
      errors: [t, ...providers.map((p) => p.series.errors)],
      latency: [t, ...providers.map((p) => p.series.avgMs)],
    };
  }, [data]);

  if (loading && !data) return <Loading />;
  if (!data) return <ErrorNote error={error} />;

  return (
    <div className="adm-stack">
      <ErrorNote error={error} />
      <div className="adm-stats">
        {data.providers.map((p) => (
          <button
            type="button"
            key={p.provider}
            className={`adm-stat-button ${provider === p.provider ? 'active' : ''}`}
            onClick={() =>
              navigate('upstreams', { range, provider: provider === p.provider ? '' : p.provider })
            }
          >
            <StatCard
              label={p.provider}
              value={fmtInt(p.calls)}
              tone={p.errorRate > 0.05 ? 'bad' : p.errorRate > 0.01 ? 'warn' : 'good'}
              sub={`${fmtPct(p.errorRate)} failed · p95 ${fmtBucketMs(p.p95Ms)} · 429s ${fmtInt(p.rateLimited)} · timeouts ${fmtInt(p.timeouts)}`}
            />
          </button>
        ))}
        {data.providers.length === 0 && (
          <div className="adm-empty">No outbound calls recorded in this range.</div>
        )}
      </div>

      {charts && (
        <>
          <Panel title="Outbound calls">
            <TimeChart data={charts.calls} series={charts.series} />
          </Panel>
          <div className="adm-grid-2">
            <Panel title="Failures (network error or 5xx)">
              <TimeChart data={charts.errors} series={charts.series} height={200} />
            </Panel>
            <Panel title="Avg time to response headers">
              <TimeChart data={charts.latency} series={charts.series} yLabel="ms" height={200} />
            </Panel>
          </div>
        </>
      )}

      {data.details ? (
        <>
          <Panel title={`Endpoints${provider ? ` · ${provider}` : ''}`}>
            <div className="adm-table-wrap">
              <table className="adm-table">
                <thead>
                  <tr>
                    <th>Provider</th>
                    <th>Endpoint</th>
                    <th className="num">Calls</th>
                    <th className="num">Failed</th>
                    <th className="num">429</th>
                    <th className="num">Timeouts</th>
                    <th className="num">Avg</th>
                    <th className="num">p95</th>
                    <th className="num">Max</th>
                  </tr>
                </thead>
                <tbody>
                  {data.details.endpoints.map((e) => (
                    <tr key={`${e.provider}${e.method}${e.path}`}>
                      <td>{e.provider}</td>
                      <td className="mono adm-ellipsis" title={e.path}>
                        {e.method} {e.path}
                      </td>
                      <td className="num">{fmtInt(e.calls)}</td>
                      <td className={`num ${Number(e.errors) ? 'adm-text-bad' : ''}`}>
                        {fmtInt(e.errors)}
                      </td>
                      <td className="num">{fmtInt(e.rate_limited)}</td>
                      <td className="num">{fmtInt(e.timeouts)}</td>
                      <td className="num">{fmtMs(e.avg_ms)}</td>
                      <td className="num">{formatPercentile(e.p95_ms)}</td>
                      <td className="num">{fmtMs(e.max_ms)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          <Panel title="Recent failed calls (4xx, 5xx, network)">
            {data.details.recentErrors.length === 0 ? (
              <div className="adm-empty">None in this range.</div>
            ) : (
              <div className="adm-table-wrap">
                <table className="adm-table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Status</th>
                      <th>Endpoint</th>
                      <th className="num">Duration</th>
                      <th>Error</th>
                      <th>Request</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.details.recentErrors.map((e, i) => (
                      <tr key={i}>
                        <td className="nowrap">{fmtTime(e.ts)}</td>
                        <td>
                          <Badge tone={statusTone(e.status)}>{e.status || 'ERR'}</Badge>
                        </td>
                        <td className="mono adm-ellipsis">
                          {e.provider} {e.method} {e.path}
                        </td>
                        <td className="num">{fmtMs(e.duration_ms)}</td>
                        <td className="adm-ellipsis" title={e.error}>
                          {e.error}
                        </td>
                        <td>
                          {e.request_id ? (
                            <button
                              type="button"
                              className="adm-link mono"
                              onClick={() => onOpenTrace(e.request_id)}
                            >
                              {e.request_id}
                            </button>
                          ) : (
                            <span className="adm-muted">background</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      ) : (
        <div className="adm-alert adm-tone-warn">
          Per-endpoint detail is unavailable while collection is disabled.
        </div>
      )}
    </div>
  );
}
