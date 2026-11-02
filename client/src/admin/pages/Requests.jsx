import { useMemo, useState } from 'react';
import { Ban, Filter } from 'lucide-react';
import { adminApi, downloadExport } from '../api.js';
import { useAsync, navigate } from '../hooks.js';
import { TimeChart } from '../components/TimeChart.jsx';
import { FilterBar } from '../components/FilterBar.jsx';
import { Badge, ErrorNote, Loading, Panel } from '../components/ui.jsx';
import { fmtInt, fmtMs, fmtPct, fmtTime, statusTone } from '../format.js';
import { addFilter, pickFilters } from '../filters.js';

/** Group-by dimensions; `filter` names the filter param that narrows to one group. */
const GROUP_BY = [
  { key: 'route', label: 'Route', filter: 'route', mono: true },
  { key: 'path', label: 'Path', filter: 'q', mono: true },
  { key: 'status', label: 'Status', filter: 'status' },
  { key: 'source', label: 'Source', filter: 'source' },
  { key: 'resource', label: 'Resource', filter: 'resource' },
  { key: 'contentType', label: 'Content type', filter: 'contentType' },
  { key: 'catalog', label: 'Catalog', filter: 'q', mono: true },
  { key: 'client', label: 'Client', filter: 'client' },
  { key: 'country', label: 'Country', filter: 'country' },
  { key: 'colo', label: 'Edge' },
  { key: 'instance', label: 'Instance', filter: 'instance', mono: true },
  { key: 'method', label: 'Method', filter: 'method' },
];

const SORTS = [
  ['newest', 'Newest first'],
  ['duration', 'Longest duration'],
  ['upstream', 'Most upstream calls'],
];

function GroupView({ range, rangeParams, filters, by, onFilter, onEvents, onSelectRange }) {
  const dimension = GROUP_BY.find((g) => g.key === by) ?? GROUP_BY[0];
  const filterKey = JSON.stringify(filters);
  const { data, error, loading } = useAsync(
    () => adminApi.groups({ ...rangeParams, ...filters, by: dimension.key }),
    [range, rangeParams.from, rangeParams.to, filterKey, dimension.key],
    { pollMs: 60_000 }
  );
  const chart = useMemo(
    () =>
      data?.series?.keys?.length
        ? {
            data: [data.series.t, ...data.series.values],
            series: data.series.keys.map((key) => ({ label: key || '(none)' })),
          }
        : null,
    [data]
  );

  return (
    <>
      <div className="adm-segmented" role="group" aria-label="Group by">
        <span className="adm-muted">Group by</span>
        {GROUP_BY.map((g) => (
          <button
            type="button"
            key={g.key}
            className={g.key === dimension.key ? 'active' : ''}
            aria-pressed={g.key === dimension.key}
            onClick={() => navigate('requests', { ...rangeParams, ...filters, by: g.key })}
          >
            {g.label}
          </button>
        ))}
      </div>
      <ErrorNote error={error} />
      {loading && !data ? (
        <Loading />
      ) : (
        <>
          <Panel title={`Requests by ${dimension.label.toLowerCase()}`}>
            {chart ? (
              <TimeChart data={chart.data} series={chart.series} onSelectRange={onSelectRange} />
            ) : (
              <div className="adm-empty">No requests match these filters.</div>
            )}
          </Panel>
          <Panel
            title={`${fmtInt(data?.groups?.length)} ${dimension.label.toLowerCase()} groups`}
            actions={<span className="adm-muted">{fmtInt(data?.total)} requests</span>}
          >
            <div className="adm-table-wrap">
              <table className="adm-table adm-table-stack">
                <thead>
                  <tr>
                    <th>{dimension.label}</th>
                    <th className="num">Requests</th>
                    <th className="num">Share</th>
                    <th className="num adm-col-optional">Users</th>
                    <th className="num">4xx</th>
                    <th className="num">5xx</th>
                    <th className="num adm-col-optional">Avg</th>
                    <th className="num">p95</th>
                    <th className="num adm-col-optional">p99</th>
                    <th className="num adm-col-optional">Upstream/req</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {(data?.groups || []).map((g) => (
                    <tr key={g.key}>
                      <td className={`adm-ellipsis ${dimension.mono ? 'mono' : ''}`} title={g.key}>
                        {dimension.filter ? (
                          <button
                            type="button"
                            className={`adm-link ${dimension.mono ? 'mono' : ''}`}
                            onClick={() => onEvents(dimension, g.key)}
                            title="Show these requests"
                          >
                            {g.key || '(none)'}
                          </button>
                        ) : (
                          g.key || '(none)'
                        )}
                      </td>
                      <td data-label="Requests" className="num">
                        {fmtInt(g.count)}
                      </td>
                      <td data-label="Share" className="num">
                        <span className="adm-share">
                          <span className="adm-share-track" aria-hidden="true">
                            <span
                              className="adm-share-fill"
                              style={{ width: `${data.total ? (g.count / data.total) * 100 : 0}%` }}
                            />
                          </span>
                          {fmtPct(data.total ? g.count / data.total : 0, 1)}
                        </span>
                      </td>
                      <td data-label="Users" className="adm-col-optional num">
                        {fmtInt(g.users)}
                      </td>
                      <td
                        data-label="4xx"
                        className={`num ${g.errors4xx ? 'adm-text-warn' : 'adm-muted'}`}
                      >
                        {g.errors4xx ? fmtPct(g.errors4xx / g.count, 1) : '–'}
                      </td>
                      <td
                        data-label="5xx"
                        className={`num ${g.errors5xx ? 'adm-text-bad' : 'adm-muted'}`}
                      >
                        {g.errors5xx ? fmtPct(g.errors5xx / g.count, 1) : '–'}
                      </td>
                      <td data-label="Avg" className="adm-col-optional num">
                        {fmtMs(g.avg_ms)}
                      </td>
                      <td data-label="p95" className="num">
                        {fmtMs(g.p95_ms)}
                      </td>
                      <td data-label="p99" className="adm-col-optional num">
                        {fmtMs(g.p99_ms)}
                      </td>
                      <td data-label="Upstream/req" className="adm-col-optional num">
                        {g.avg_upstream_calls}
                      </td>
                      <td className="adm-row-actions">
                        {dimension.filter && dimension.filter !== 'q' && (
                          <>
                            <button
                              type="button"
                              className="adm-btn adm-icon-btn-sm"
                              title={`Only ${dimension.label.toLowerCase()} ${g.key}`}
                              aria-label={`Filter to ${g.key}`}
                              onClick={() => onFilter(dimension.filter, g.key, false)}
                            >
                              <Filter size={13} aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              className="adm-btn adm-icon-btn-sm"
                              title={`Exclude ${dimension.label.toLowerCase()} ${g.key}`}
                              aria-label={`Exclude ${g.key}`}
                              onClick={() => onFilter(dimension.filter, g.key, true)}
                            >
                              <Ban size={13} aria-hidden="true" />
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </>
  );
}

/** Keyed by range+filters by the parent, so its paging state resets when they change. */
function RequestList({ rangeParams, filters, sort, onSort, onOpenTrace }) {
  const query = { ...filters, ...(sort && sort !== 'newest' ? { sort } : {}) };
  const first = useAsync(() => adminApi.requests({ ...rangeParams, ...query, limit: 100 }), []);
  const [more, setMore] = useState({ rows: [], cursor: undefined });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(null);

  const rows = [...(first.data?.rows || []), ...more.rows];
  const cursor = more.cursor === undefined ? first.data?.nextCursor : more.cursor;

  const loadMore = async () => {
    setLoadingMore(true);
    setMoreError(null);
    try {
      const bounds = first.data?.range ? { range: 'custom', ...first.data.range } : rangeParams;
      const next = await adminApi.requests({ ...bounds, ...query, cursor, limit: 100 });
      setMore((m) => ({ rows: [...m.rows, ...next.rows], cursor: next.nextCursor }));
    } catch (err) {
      setMoreError(err);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <Panel
      title={`${fmtInt(first.data?.total ?? rows.length)} requests`}
      actions={
        <>
          <label className="adm-inline-select">
            <span>Sort by</span>
            <select value={sort || 'newest'} onChange={(e) => onSort(e.target.value)}>
              {SORTS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="adm-btn"
            onClick={() => downloadExport({ kind: 'requests', ...rangeParams, ...query })}
          >
            Export CSV
          </button>
        </>
      }
    >
      <ErrorNote error={first.error} />
      {first.loading && !rows.length ? (
        <Loading />
      ) : rows.length === 0 ? (
        <div className="adm-empty">No requests match these filters.</div>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table adm-table-stack adm-table-stack-events">
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
                <tr key={`${r.request_id}-${r.ts}`}>
                  <td data-label="Time" className="nowrap">
                    {fmtTime(r.ts)}
                  </td>
                  <td data-label="Status">
                    <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                    {r.error_fp && (
                      <Badge
                        tone={r.status >= 500 ? 'bad' : 'warn'}
                        title="An application error was logged; open the trace for details"
                      >
                        log
                      </Badge>
                    )}
                  </td>
                  <td data-label="Method">{r.method}</td>
                  <td className="mono adm-ellipsis" title={r.path}>
                    <button
                      type="button"
                      className="adm-link mono"
                      onClick={() => onOpenTrace(r.request_id)}
                    >
                      {r.path}
                    </button>
                  </td>
                  <td data-label="Duration" className="num">
                    {fmtMs(r.duration_ms)}
                  </td>
                  <td data-label="Source">{r.source}</td>
                  <td data-label="Client" className="nowrap">
                    {r.client}
                  </td>
                  <td data-label="Country">{r.country}</td>
                  <td
                    data-label="Cache h/m"
                    className="num"
                  >{`${r.cache_hits}/${r.cache_misses}`}</td>
                  <td data-label="Upstream" className="num">
                    {r.upstream_calls}
                  </td>
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

export function Requests({ range, rangeParams = { range }, params, onOpenTrace, onSelectRange }) {
  const filters = pickFilters(params);
  const filterKey = JSON.stringify(filters);
  const view = params.view === 'events' ? 'events' : 'groups';
  const by = params.by || 'route';
  const sort = params.sort;
  const facets = useAsync(
    () => adminApi.facets(rangeParams),
    [range, rangeParams.from, rangeParams.to]
  );
  const go = (next) => navigate('requests', { ...rangeParams, ...next });
  const viewState = view === 'events' ? { view, sort } : { by };

  return (
    <div className="adm-stack">
      <FilterBar
        filters={filters}
        facets={facets.data}
        onChange={(next) => go({ ...next, ...viewState })}
      />
      <div className="adm-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'groups'}
          className={view === 'groups' ? 'active' : ''}
          onClick={() => go({ ...filters, by })}
        >
          Group by
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'events'}
          className={view === 'events' ? 'active' : ''}
          onClick={() => go({ ...filters, view: 'events', sort })}
        >
          Events
        </button>
      </div>

      {view === 'groups' ? (
        <GroupView
          range={range}
          rangeParams={rangeParams}
          filters={filters}
          by={by}
          onSelectRange={onSelectRange}
          onFilter={(key, value, exclude) => go({ ...addFilter(filters, key, value, exclude), by })}
          onEvents={(dimension, value) =>
            go({
              ...(dimension.filter ? addFilter(filters, dimension.filter, value) : filters),
              view: 'events',
            })
          }
        />
      ) : (
        <RequestList
          key={`${range}|${rangeParams.from ?? ''}|${rangeParams.to ?? ''}|${filterKey}|${sort}`}
          rangeParams={rangeParams}
          filters={filters}
          sort={sort}
          onSort={(value) => go({ ...filters, view: 'events', sort: value })}
          onOpenTrace={onOpenTrace}
        />
      )}
    </div>
  );
}
