import { adminApi } from '../api.js';
import { navigate, useAsync } from '../hooks.js';
import { pickFilters } from '../filters.js';
import { fmtInt, fmtPct } from '../format.js';
import { FilterBar } from '../components/FilterBar.jsx';
import { ErrorNote, Loading, Panel, StatCard } from '../components/ui.jsx';

const fraction = (n, total) => (total ? n / total : null);
const duration = (seconds) => {
  for (const [unit, size] of [
    ['d', 86400],
    ['h', 3600],
    ['m', 60],
  ]) {
    if (seconds >= size && seconds % size === 0) return `${seconds / size}${unit}`;
  }
  return `${seconds}s`;
};

export function Caching({ range, rangeParams = { range }, params = {} }) {
  const filters = pickFilters(params);
  const filterKey = JSON.stringify(filters);
  const by = params.by === 'path' ? 'path' : 'route';
  const { data, error, loading } = useAsync(
    () => adminApi.caching({ ...rangeParams, ...filters, by }),
    [range, rangeParams.from, rangeParams.to, filterKey, by],
    { pollMs: 60_000 }
  );
  const facets = useAsync(
    () => adminApi.facets(rangeParams),
    [range, rangeParams.from, rangeParams.to]
  );
  if (loading && !data) return <Loading />;
  if (!data) return <ErrorNote error={error} />;
  const totals = data.analytics?.totals;
  const lookups = totals ? totals.hits + totals.misses : 0;
  const showRequests = (key) =>
    navigate('requests', {
      ...rangeParams,
      ...filters,
      view: 'events',
      ...(by === 'route' ? { route: key } : { q: key }),
    });
  const scopes = [...new Set((data.ttls || []).map((row) => row.scope))];

  return (
    <div className="adm-stack">
      <FilterBar
        filters={filters}
        facets={facets.data}
        onChange={(next) => navigate('caching', { ...rangeParams, ...next, by })}
      />
      <ErrorNote error={error} />
      <div className="adm-alert">
        Lookup rates count instrumented shared-cache reads, not HTTP requests. One request may have
        several hits and misses. Stale entries count as hits even if refreshed; cached errors and
        cache failures are not included. Process-local caches and client/CDN caches are not
        measured.
      </div>
      {data.sampled && (
        <div className="adm-alert adm-tone-warn">
          Metrics are weighted estimates from sampled retained requests.
        </div>
      )}
      {!data.analytics ? (
        <div className="adm-empty">
          Request history is unavailable. Cache analytics require retained request history; TTL
          policy is shown below.
        </div>
      ) : (
        <>
          <div className="adm-stats">
            <StatCard
              label="Lookup hit rate"
              value={fmtPct(fraction(totals.hits, lookups))}
              sub={`${fmtInt(totals.hits)} / ${fmtInt(lookups)} lookups`}
            />
            <StatCard
              label="Lookup miss rate"
              value={fmtPct(fraction(totals.misses, lookups))}
              sub={`${fmtInt(totals.misses)} / ${fmtInt(lookups)} lookups`}
            />
            <StatCard
              label="Requests checking cache"
              value={fmtInt(totals.requests)}
              sub="At least one recorded hit or miss"
            />
            <StatCard
              label="All hits"
              value={fmtPct(fraction(totals.allHits, totals.requests))}
              sub={`${fmtInt(totals.allHits)} requests · no recorded misses`}
            />
            <StatCard
              label="Mixed hits and misses"
              value={fmtPct(fraction(totals.mixed, totals.requests))}
              sub={`${fmtInt(totals.mixed)} requests`}
            />
            <StatCard
              label="Misses only"
              value={fmtPct(fraction(totals.missesOnly, totals.requests))}
              sub={`${fmtInt(totals.missesOnly)} requests · no recorded hits`}
            />
            <StatCard
              label="Miss + upstream"
              value={fmtPct(fraction(totals.missesWithUpstream, totals.requests))}
              sub={`${fmtInt(totals.missesWithUpstream)} requests with misses and captured API calls`}
            />
          </div>
          <p className="adm-muted">
            Miss + upstream is a share of requests checking cache, not a miss-to-API conversion
            rate. Calls can be unrelated to the miss or include retries; a miss may be served by
            deduplicated work without a new call. All hits does not mean no API calls.
          </p>
          <Panel
            title="Most cache misses"
            actions={
              <select
                aria-label="Cache grouping"
                value={by}
                onChange={(e) =>
                  navigate('caching', { ...rangeParams, ...filters, by: e.target.value })
                }
              >
                <option value="route">Group by route</option>
                <option value="path">Group by path</option>
              </select>
            }
          >
            <p className="adm-muted">
              Top 50 by lookup misses. Paths use stored redacted values; config IDs are masked.
            </p>
            <div className="adm-table-wrap">
              <table className="adm-table adm-table-stack">
                <thead>
                  <tr>
                    <th>{by === 'route' ? 'Route' : 'Path'}</th>
                    <th className="num">Cache requests</th>
                    <th className="num">Hits</th>
                    <th className="num">Misses</th>
                    <th className="num">Hit %</th>
                    <th className="num">Miss %</th>
                    <th className="num">Miss + upstream requests</th>
                  </tr>
                </thead>
                <tbody>
                  {data.analytics.groups.map((row) => (
                    <tr key={row.key}>
                      <td>
                        <button
                          type="button"
                          className="adm-link mono"
                          onClick={() => showRequests(row.key)}
                        >
                          {row.key || '(none)'}
                        </button>
                      </td>
                      <td data-label="Cache requests" className="num">
                        {fmtInt(row.requests)}
                      </td>
                      <td data-label="Hits" className="num">
                        {fmtInt(row.hits)}
                      </td>
                      <td data-label="Misses" className="num">
                        {fmtInt(row.misses)}
                      </td>
                      <td data-label="Hit %" className="num">
                        {fmtPct(fraction(row.hits, row.hits + row.misses))}
                      </td>
                      <td data-label="Miss %" className="num">
                        {fmtPct(fraction(row.misses, row.hits + row.misses))}
                      </td>
                      <td data-label="Miss + upstream requests" className="num">
                        {fmtInt(row.missesWithUpstream)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.analytics.groups.length === 0 && (
              <div className="adm-empty">No recorded cache hits or misses in this range.</div>
            )}
          </Panel>
        </>
      )}
      <Panel title="Cache TTL policy (current deployment)">
        <p className="adm-muted">
          Read-only runtime values, not the policy at the selected historical time. Cache lookups
          above do not measure every layer listed here. HEADER and STALE entries control HTTP
          freshness; other entries describe server caches. TMDB configuration/genres: reference TTL;
          movie details older than one year and ended/canceled TV: detail TTL; newer movies: recent
          detail TTL; other TMDB responses: API response TTL. LOGO applies to images.
        </p>
        <p className="adm-muted">
          Catalog server TTL selects TRENDING for
          trending/now-playing/upcoming/on-the-air/popular/airing-today lists, otherwise DISCOVER.
          IMDb advanced search uses search TTL divided by{' '}
          {data.lifecycle?.imdbAdvancedSearchDivisor}. Empty results and failures use their separate
          TTLs below.
        </p>
        <p className="adm-muted">
          Wrapped entries are stored for {data.lifecycle?.wrapperRetentionMultiplier}× fresh TTL;
          stale entries can be read until {data.lifecycle?.wrapperStaleMultiplier}× TTL when
          allowed. Physical retention is not fresh lifetime. IMDb response retention is{' '}
          {data.lifecycle?.imdbRetentionMultiplier}× TTL.
        </p>
        {scopes.map((scope) => (
          <div key={scope}>
            <h3>{scope}</h3>
            <div className="adm-table-wrap">
              <table className="adm-table adm-table-compact">
                <thead>
                  <tr>
                    <th>Policy</th>
                    <th className="num">TTL / interval</th>
                    <th className="num">Seconds</th>
                  </tr>
                </thead>
                <tbody>
                  {data.ttls
                    .filter((row) => row.scope === scope)
                    .map((row) => (
                      <tr key={row.name}>
                        <td className="mono">{row.name}</td>
                        <td className="num">{duration(row.seconds)}</td>
                        <td className="num">{fmtInt(row.seconds)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </Panel>
    </div>
  );
}
