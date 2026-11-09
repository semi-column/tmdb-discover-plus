import { adminApi } from '../api.js';
import { navigate, useAsync } from '../hooks.js';
import { pickFilters } from '../filters.js';
import { fmtBytes, fmtInt, fmtPct, fmtTime } from '../format.js';
import { FilterBar } from '../components/FilterBar.jsx';
import { ErrorNote, Loading, Panel, StatCard } from '../components/ui.jsx';

const fraction = (n, total) => (total ? n / total : null);
const READ_OUTCOMES = [
  ['freshHits', 'Fresh hits'],
  ['staleHits', 'Stale hits'],
  ['misses', 'Misses'],
  ['cachedErrors', 'Cached errors'],
  ['readErrors', 'Read failures'],
];
const LAYERS = {
  addon_response: 'Addon responses',
  key_validation: 'TMDB key validation',
  tmdb_api: 'TMDB API responses',
  tmdb_reference: 'TMDB reference data',
  seasons: 'Series seasons',
  episode_snapshot: 'Shared episode snapshots',
  artwork: 'Artwork / logos / RPDB',
  id_lookup: 'ID lookups',
  imdb: 'IMDb data / cursors',
  imdb_freshness: 'IMDb freshness markers',
  anime: 'Anime data / ID mapping',
  discovery: 'Discovery pagination',
  other: 'Other shared-cache reads',
};
const attempts = (row) => READ_OUTCOMES.reduce((n, [key]) => n + row[key], 0);
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
  const coverage = data.analytics?.coverage;
  const details = data.analytics?.details;
  const history = data.history;
  const storage = history?.storage;
  const readAttempts = details ? attempts(details.totals) : 0;
  const collector = history?.collector;
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
      <ErrorNote error={data.historyErrors?.join(' ')} />
      {history && (
        <Panel title="History coverage">
          <p>
            History: <strong>{history.backend || 'unavailable'}</strong> · Application cache:{' '}
            <strong>{history.cacheBackend}</strong> · Live counters:{' '}
            <strong>{history.liveBackend}</strong>
          </p>
          <p className="adm-muted">
            Retention: {history.retentionDays} days.
            {storage?.memory
              ? ` This process holds ${fmtInt(storage.memory.requests)} / ${fmtInt(storage.memory.capacity)} request rows; history is lost on restart and older rows are evicted at capacity. Redis cache/live counters do not persist these request rows.`
              : storage
                ? ` History storage: ${fmtBytes(storage.totalBytes)} / ${storage.capBytes === null ? 'no configured size cap' : fmtBytes(storage.capBytes)}. A size cap can remove older days before retention expires.`
                : ''}
          </p>
          {history.backgroundWork?.enabled && (
            <p className="adm-muted">
              Opportunistic work on this process since startup:{' '}
              {fmtInt(history.backgroundWork.started)} started,{' '}
              {fmtInt(history.backgroundWork.skipped)} skip events,{' '}
              {fmtInt(history.backgroundWork.active)} / {fmtInt(history.backgroundWork.limit)}{' '}
              active. These counters are not scoped to the selected interval or other replicas.
            </p>
          )}
          {history.backgroundWork?.enabled === false && (
            <p className="adm-muted">Opportunistic work priority is disabled on this process.</p>
          )}
          {coverage && (
            <p className="adm-muted">
              Selected range and filters contain {fmtInt(coverage.retainedRequests)} retained
              request rows ({fmtTime(coverage.oldest)} – {fmtTime(coverage.newest)}).{' '}
              {fmtInt(coverage.detailedRequests)} have detailed cache instrumentation
              {coverage.detailedOldest ? `, first seen ${fmtTime(coverage.detailedOldest)}` : ''}.
              These are unweighted stored-row counts, including requests without cache reads.
            </p>
          )}
          <div className="adm-alert">
            Selecting a time range does not guarantee complete history for that interval. Retention,
            restarts, sampling, collection gaps, and storage limits can reduce coverage; timestamps
            describe matching retained records, not continuous collection.
          </div>
          {(storage?.paused || collector?.storagePaused) && (
            <div className="adm-alert adm-tone-warn">
              Request history collection is paused by the storage cap.
            </div>
          )}
          {collector &&
            (collector.dropped.requests > 0 ||
              collector.dropped.storageCap > 0 ||
              collector.failedWrites.historyRecords > 0) && (
              <div className="adm-alert adm-tone-warn">
                This process has dropped {fmtInt(collector.dropped.requests)} buffered request rows,{' '}
                skipped {fmtInt(collector.dropped.storageCap)} records at the storage cap, and
                recorded {fmtInt(collector.failedWrites.historyRecords)} failed history-record
                writes since startup. These counters are not scoped to the selected interval.
              </div>
            )}
          {collector?.lastFlushError && (
            <div className="adm-alert adm-tone-warn">
              Latest collector flush error: {collector.lastFlushError}
            </div>
          )}
        </Panel>
      )}
      <div className="adm-alert">
        Lookup rates count instrumented shared-cache reads, not HTTP requests. One request may have
        several hits and misses. The headline hit/miss rates include stale hits but exclude cached
        errors and read failures; the detailed breakdown below counts those separately.
        Process-local caches and client/CDN caches are not measured.
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
          <Panel title="Cache read outcomes by layer">
            <p className="adm-muted">
              Detailed records only; legacy records cannot be backfilled. Each attempt has one
              outcome. Percentages below use all detailed read attempts, including cached errors and
              read failures—not the headline hit-plus-miss denominator. Read failures include
              corrupt entries, not cache write failures.
            </p>
            {coverage && coverage.detailedRequests < coverage.retainedRequests && (
              <div className="adm-alert adm-tone-warn">
                {fmtInt(coverage.retainedRequests - coverage.detailedRequests)} retained request
                rows lack layer/freshness/error detail. Their hit/miss counts remain in the headline
                rates.
              </div>
            )}
            {!coverage || coverage.detailedRequests === 0 ? (
              <div className="adm-empty">
                Detailed cache outcomes are unavailable for these records.
              </div>
            ) : (
              <>
                <div className="adm-stats">
                  {READ_OUTCOMES.map(([key, label]) => (
                    <StatCard
                      key={key}
                      label={label}
                      value={fmtInt(details.totals[key])}
                      sub={`${fmtPct(fraction(details.totals[key], readAttempts))} of ${fmtInt(readAttempts)} detailed read attempts`}
                    />
                  ))}
                </div>
                <div className="adm-table-wrap">
                  <table className="adm-table adm-table-stack">
                    <thead>
                      <tr>
                        <th>Cache layer</th>
                        <th className="num">Read attempts</th>
                        {READ_OUTCOMES.map(([key, label]) => (
                          <th key={key} className="num">
                            {label}
                          </th>
                        ))}
                        <th className="num">Hit % (hits + misses)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {details.layers.map((row) => (
                        <tr key={row.key}>
                          <td>{LAYERS[row.key] || row.key}</td>
                          <td className="num" data-label="Read attempts">
                            {fmtInt(attempts(row))}
                          </td>
                          {READ_OUTCOMES.map(([key, label]) => (
                            <td key={key} className="num" data-label={label}>
                              {fmtInt(row[key])}
                            </td>
                          ))}
                          <td className="num" data-label="Hit % (hits + misses)">
                            {fmtPct(
                              fraction(
                                row.freshHits + row.staleHits,
                                row.freshHits + row.staleHits + row.misses
                              )
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {readAttempts === 0 && (
                  <div className="adm-empty">
                    No instrumented shared-cache reads in detailed records.
                  </div>
                )}
              </>
            )}
            <p className="adm-muted">
              Layers are fixed cache-key families, not API-call categories; no raw keys are
              retained. Fresh/stale describe the shared cache wrapper's TTL, not whether an HTTP
              response or every source considers the result fresh. IMDb also uses separate freshness
              markers. Outcomes are snapshotted when the HTTP response finishes; later background
              refresh work is not included.
            </p>
          </Panel>
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
          movies released more than six calendar months ago and ended/canceled TV: detail TTL;
          movies released 31 days to six months ago: movie detail TTL; upcoming, newly released or
          undated movies: recent detail TTL; active/unknown TV: active series TTL. Season batches
          and individual seasons use recent detail TTL. Other TMDB responses use API response TTL.
          LOGO applies to images. Raw TMDB reads refresh expired data rather than serving it stale.
        </p>
        <p className="adm-muted">
          Catalog server TTL selects TRENDING for
          trending/now-playing/upcoming/on-the-air/popular/airing-today lists, otherwise DISCOVER.
          TMDB discovery uses stable discovery TTL only for stable sort orders without date filters;
          popularity, latest-first, date-filtered and unknown sorts retain trending TTL. IMDb
          advanced search uses search TTL divided by {data.lifecycle?.imdbAdvancedSearchDivisor}.
          Empty results and failures use their separate TTLs below.
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
