import { useState } from 'react';
import { adminApi, downloadExport } from '../api.js';
import { useAsync, navigate } from '../hooks.js';
import { Badge, ErrorNote, Loading, Panel } from '../components/ui.jsx';
import { fmtBucketMs, fmtInt, fmtMs, fmtTime, statusTone } from '../format.js';

const FILTER_KEYS = [
  'route',
  'status',
  'method',
  'source',
  'resource',
  'client',
  'country',
  'instance',
  'minMs',
  'userId',
  'requestId',
  'q',
  'errorsOnly',
];

function pickFilters(params) {
  return Object.fromEntries(FILTER_KEYS.filter((k) => params[k]).map((k) => [k, params[k]]));
}

function FacetSelect({ label, name, value, options, onChange }) {
  return (
    <label className="adm-filter">
      <span>{label}</span>
      <select value={value || ''} onChange={(e) => onChange(name, e.target.value)}>
        <option value="">Any</option>
        {value && !options?.some((o) => o.value === value) && (
          <option value={value}>{value}</option>
        )}
        {options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.value || '(none)'} · {fmtInt(o.count)}
          </option>
        ))}
      </select>
    </label>
  );
}

function TextFilter({ label, name, value, onChange, placeholder, type = 'text' }) {
  const [draft, setDraft] = useState(value || '');
  return (
    <label className="adm-filter">
      <span>{label}</span>
      <input
        type={type}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== (value || '') && onChange(name, draft)}
        onKeyDown={(e) => e.key === 'Enter' && onChange(name, draft)}
      />
    </label>
  );
}

function RoutePerformance({ range, approximatePercentiles }) {
  const formatPercentile = approximatePercentiles ? fmtBucketMs : fmtMs;
  const { data, error, loading } = useAsync(() => adminApi.routes({ range }), [range]);
  if (loading && !data) return <Loading />;
  return (
    <>
      <ErrorNote error={error} />
      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead>
            <tr>
              <th>Route</th>
              <th className="num">Requests</th>
              <th className="num">5xx</th>
              <th className="num">4xx</th>
              <th className="num">Avg</th>
              <th className="num">p50</th>
              <th className="num">p95</th>
              <th className="num">p99</th>
              <th className="num">Max</th>
              <th className="num">Upstream/req</th>
            </tr>
          </thead>
          <tbody>
            {(data || []).map((r) => (
              <tr
                key={r.route}
                className="adm-clickable"
                onClick={() => navigate('requests', { range, route: r.route })}
              >
                <td className="mono">{r.route}</td>
                <td className="num">{fmtInt(r.count)}</td>
                <td className={`num ${Number(r.errors5xx) ? 'adm-text-bad' : ''}`}>
                  {fmtInt(r.errors5xx ?? 0)}
                </td>
                <td className="num">{fmtInt(r.errors4xx ?? 0)}</td>
                <td className="num">{fmtMs(r.avg_ms)}</td>
                <td className="num">{formatPercentile(r.p50_ms)}</td>
                <td className="num">{formatPercentile(r.p95_ms)}</td>
                <td className="num">{formatPercentile(r.p99_ms)}</td>
                <td className="num">{fmtMs(r.max_ms)}</td>
                <td className="num">{r.avg_upstream_calls}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Keyed by range+filters by the parent, so its paging state resets when they change. */
function RequestList({ range, filters, onOpenTrace }) {
  const first = useAsync(() => adminApi.requests({ range, ...filters, limit: 100 }), []);
  const [more, setMore] = useState({ rows: [], cursor: undefined });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(null);

  const rows = [...(first.data?.rows || []), ...more.rows];
  const cursor = more.cursor === undefined ? first.data?.nextCursor : more.cursor;

  const loadMore = async () => {
    setLoadingMore(true);
    setMoreError(null);
    try {
      const next = await adminApi.requests({ range, ...filters, cursor, limit: 100 });
      setMore((m) => ({ rows: [...m.rows, ...next.rows], cursor: next.nextCursor }));
    } catch (err) {
      setMoreError(err);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <Panel title={`Requests${rows.length ? ` (${fmtInt(rows.length)}${cursor ? '+' : ''})` : ''}`}>
      <ErrorNote error={first.error} />
      {first.loading && !rows.length ? (
        <Loading />
      ) : rows.length === 0 ? (
        <div className="adm-empty">No requests match these filters.</div>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Status</th>
                <th>Method</th>
                <th>Path</th>
                <th className="num">Duration</th>
                <th>Source</th>
                <th>Client</th>
                <th>Country</th>
                <th className="num">Cache h/m</th>
                <th className="num">Upstream</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={`${r.request_id}-${r.ts}`}
                  className="adm-clickable"
                  onClick={() => onOpenTrace(r.request_id)}
                >
                  <td className="nowrap">{fmtTime(r.ts)}</td>
                  <td>
                    <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                    {r.error_fp && (
                      <Badge tone="bad" title="An error was logged during this request">
                        err
                      </Badge>
                    )}
                  </td>
                  <td>{r.method}</td>
                  <td className="mono adm-ellipsis" title={r.path}>
                    {r.path}
                  </td>
                  <td className="num">{fmtMs(r.duration_ms)}</td>
                  <td>{r.source}</td>
                  <td className="nowrap">{r.client}</td>
                  <td>{r.country}</td>
                  <td className="num">{`${r.cache_hits}/${r.cache_misses}`}</td>
                  <td className="num">{r.upstream_calls}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ErrorNote error={moreError} />
      {cursor && (
        <button
          type="button"
          className="adm-btn adm-load-more"
          onClick={loadMore}
          disabled={loadingMore}
        >
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      )}
    </Panel>
  );
}

export function Requests({ range, params, onOpenTrace, meta }) {
  const caps = meta?.capabilities;
  const filters = pickFilters(params);
  const filterKey = JSON.stringify(filters);
  const [tab, setTab] = useState(params.tab === 'routes' ? 'routes' : 'explorer');

  const facets = useAsync(() => adminApi.facets({ range }), [range]);

  const setFilter = (name, value) =>
    navigate('requests', { range, ...filters, [name]: value || undefined });
  const activeCount = Object.keys(filters).length;
  const f = facets.data || {};

  return (
    <div className="adm-stack">
      <div className="adm-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'explorer'}
          className={tab === 'explorer' ? 'active' : ''}
          onClick={() => setTab('explorer')}
        >
          Explorer
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'routes'}
          className={tab === 'routes' ? 'active' : ''}
          onClick={() => setTab('routes')}
        >
          Route performance
        </button>
      </div>

      {tab === 'routes' ? (
        <Panel
          title={
            caps?.approximatePercentiles
              ? 'Route performance (percentiles are latency-bucket upper bounds)'
              : 'Route performance (exact percentiles from stored requests)'
          }
        >
          <RoutePerformance range={range} approximatePercentiles={caps?.approximatePercentiles} />
        </Panel>
      ) : (
        <>
          <Panel
            title="Filters"
            actions={
              <>
                {activeCount > 0 && (
                  <button
                    type="button"
                    className="adm-btn"
                    onClick={() => navigate('requests', { range })}
                  >
                    Clear ({activeCount})
                  </button>
                )}
                <button
                  type="button"
                  className="adm-btn"
                  onClick={() => downloadExport({ kind: 'requests', range, ...filters })}
                >
                  Export CSV
                </button>
              </>
            }
          >
            <div className="adm-filters">
              <FacetSelect
                label="Route"
                name="route"
                value={filters.route}
                options={f.route}
                onChange={setFilter}
              />
              <label className="adm-filter">
                <span>Status</span>
                <select
                  value={filters.status || ''}
                  onChange={(e) => setFilter('status', e.target.value)}
                >
                  <option value="">Any</option>
                  {['2xx', '3xx', '4xx', '5xx'].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                  {filters.status && !/xx$/.test(filters.status) && (
                    <option value={filters.status}>{filters.status}</option>
                  )}
                </select>
              </label>
              <label className="adm-filter">
                <span>Method</span>
                <select
                  value={filters.method || ''}
                  onChange={(e) => setFilter('method', e.target.value)}
                >
                  <option value="">Any</option>
                  {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'].map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </label>
              <label className="adm-filter">
                <span>Source</span>
                <select
                  value={filters.source || ''}
                  onChange={(e) => setFilter('source', e.target.value)}
                >
                  <option value="">Any</option>
                  {['tmdb', 'imdb', 'anilist', 'mal', 'kitsu', 'simkl', 'other'].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label className="adm-filter">
                <span>Resource</span>
                <select
                  value={filters.resource || ''}
                  onChange={(e) => setFilter('resource', e.target.value)}
                >
                  <option value="">Any</option>
                  {['manifest', 'catalog', 'meta'].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <FacetSelect
                label="Client"
                name="client"
                value={filters.client}
                options={f.client}
                onChange={setFilter}
              />
              {caps?.cloudflare && (
                <FacetSelect
                  label="Country"
                  name="country"
                  value={filters.country}
                  options={f.country}
                  onChange={setFilter}
                />
              )}
              {caps?.sharedLive && (
                <FacetSelect
                  label="Instance"
                  name="instance"
                  value={filters.instance}
                  options={f.instance}
                  onChange={setFilter}
                />
              )}
              <TextFilter
                key={`minMs:${filters.minMs}`}
                label="Min duration (ms)"
                name="minMs"
                type="number"
                value={filters.minMs}
                onChange={setFilter}
              />
              <TextFilter
                key={`userId:${filters.userId}`}
                label="Config ID (user)"
                name="userId"
                value={filters.userId}
                onChange={setFilter}
                placeholder="raw ID, hashed server-side"
              />
              <TextFilter
                key={`requestId:${filters.requestId}`}
                label="Request ID"
                name="requestId"
                value={filters.requestId}
                onChange={setFilter}
              />
              <TextFilter
                key={`q:${filters.q}`}
                label="Path contains"
                name="q"
                value={filters.q}
                onChange={setFilter}
              />
              <label className="adm-filter adm-filter-check">
                <input
                  type="checkbox"
                  checked={filters.errorsOnly === 'true'}
                  onChange={(e) => setFilter('errorsOnly', e.target.checked ? 'true' : '')}
                />
                <span>Errors only (5xx or logged error)</span>
              </label>
            </div>
          </Panel>

          <RequestList
            key={`${range}|${filterKey}`}
            range={range}
            filters={filters}
            onOpenTrace={onOpenTrace}
          />
        </>
      )}
    </div>
  );
}
