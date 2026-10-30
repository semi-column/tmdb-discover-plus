import { useMemo } from 'react';
import { adminApi } from '../api.js';
import { useAsync, navigate } from '../hooks.js';
import { TimeChart } from '../components/TimeChart.jsx';
import { Badge, ErrorNote, Loading, Panel, StatCard } from '../components/ui.jsx';
import { fmtBucketMs, fmtInt, fmtMs, fmtPct, fmtTime, upstreamOutcome } from '../format.js';

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
  const endpoint = params.endpoint || '';
  const failure = params.failure || '';
  const samples = data.details?.recentErrors || [];
  const recentErrors = samples.filter(
    (entry) =>
      (!endpoint || entry.path === endpoint) &&
      (!provider || entry.provider === provider) &&
      (!failure ||
        (failure === 'network'
          ? !entry.status
          : failure === '5xx'
            ? entry.status >= 500
            : String(entry.status) === failure))
  );

  return (
    <div className="adm-stack">
      <ErrorNote error={error} />
      <div className="adm-context-note">
        <strong>Dependency attempts, not failed user responses</strong>
        <p>
          Retries, fallbacks, and background jobs can generate failures here. Parent request traces
          show the recorded HTTP outcome.
        </p>
      </div>
      {(provider || endpoint) && (
        <div className="adm-filter-summary">
          {provider && (
            <button
              type="button"
              className="adm-filter-chip"
              onClick={() => navigate('upstreams', { range })}
            >
              Provider: {provider} <span aria-hidden="true">×</span>
            </button>
          )}
          {endpoint && (
            <button
              type="button"
              className="adm-filter-chip"
              onClick={() => navigate('upstreams', { range, provider })}
            >
              Endpoint: {endpoint} <span aria-hidden="true">×</span>
            </button>
          )}
        </div>
      )}
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
              tone={p.errorRate > 0.01 ? 'warn' : 'good'}
              sub={`${fmtPct(p.errorRate)} failed attempts · p95 ${fmtBucketMs(p.p95Ms)} · 429s ${fmtInt(p.rateLimited)} · timeouts ${fmtInt(p.timeouts)}`}
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
                    <tr
                      key={`${e.provider}${e.method}${e.path}`}
                      className={endpoint === e.path ? 'adm-selected-row' : ''}
                    >
                      <td>{e.provider}</td>
                      <td className="mono adm-ellipsis" title={e.path}>
                        <button
                          type="button"
                          className="adm-link mono"
                          onClick={() =>
                            navigate('upstreams', { range, provider: e.provider, endpoint: e.path })
                          }
                        >
                          {e.method} {e.path}
                        </button>
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
          <Panel
            title={
              endpoint
                ? `Recent failure samples · ${endpoint}`
                : 'Recent dependency failure samples'
            }
            actions={
              <label className="adm-filter">
                <span>Failure type</span>
                <select
                  value={failure}
                  onChange={(event) =>
                    navigate('upstreams', {
                      range,
                      provider,
                      endpoint,
                      failure: event.target.value,
                    })
                  }
                >
                  <option value="">All failures</option>
                  <option value="network">Transport failures</option>
                  <option value="429">Rate limits (429)</option>
                  <option value="401">Authentication (401)</option>
                  <option value="403">Access restrictions (403)</option>
                  <option value="404">Not found (404)</option>
                  <option value="5xx">Provider errors (5xx)</option>
                </select>
              </label>
            }
          >
            <p className="adm-muted adm-sample-note">
              {fmtInt(recentErrors.length)} matching samples from the latest{' '}
              {fmtInt(samples.length)} recorded failures in this range.
            </p>
            {recentErrors.length === 0 ? (
              <div className="adm-empty">
                No matching recent samples. This does not rule out older failures.
              </div>
            ) : (
              <div className="adm-table-wrap">
                <table className="adm-table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Status</th>
                      <th>Signal</th>
                      <th>Endpoint</th>
                      <th className="num">Duration</th>
                      <th>Error</th>
                      <th>Request</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentErrors.map((e, i) => (
                      <tr key={i}>
                        <td className="nowrap">{fmtTime(e.ts)}</td>
                        <td>
                          <Badge tone={upstreamOutcome(e.status).tone}>{e.status || 'NET'}</Badge>
                        </td>
                        <td>
                          <Badge
                            tone={upstreamOutcome(e.status).tone}
                            title={upstreamOutcome(e.status).detail}
                          >
                            {upstreamOutcome(e.status).label}
                          </Badge>
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
