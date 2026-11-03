import { useCallback, useEffect, useState } from 'react';
import { adminApi } from './api.js';
import { useAsync, useHashRoute, navigate } from './hooks.js';
import { RANGE_OPTIONS } from './format.js';
import { pickFilters } from './filters.js';
import { ErrorNote, Loading } from './components/ui.jsx';
import { TraceDrawer } from './components/TraceDrawer.jsx';
import { Login } from './pages/Login.jsx';
import { Overview } from './pages/Overview.jsx';
import { Requests } from './pages/Requests.jsx';
import { Live } from './pages/Live.jsx';
import { Errors } from './pages/Errors.jsx';
import { Upstreams } from './pages/Upstreams.jsx';
import { Usage } from './pages/Usage.jsx';
import { Caching } from './pages/Caching.jsx';
import { System } from './pages/System.jsx';
import { Diagnostics } from './pages/Diagnostics.jsx';
import { Security } from './pages/Security.jsx';
import {
  Activity,
  ArrowUpRight,
  Menu,
  X,
  LayoutDashboard,
  ListFilter,
  Radio,
  FileWarning,
  Network,
  ChartNoAxesCombined,
  Cpu,
  Database,
  Route,
  ShieldCheck,
  LogOut,
} from 'lucide-react';

const PAGES = [
  ['overview', 'Overview', LayoutDashboard],
  ['requests', 'Requests', ListFilter],
  ['errors', 'Errors', FileWarning],
  ['upstreams', 'Dependencies', Network],
  ['live', 'Live tail', Radio],
  ['usage', 'Usage', ChartNoAxesCombined],
  ['caching', 'Caching', Database],
  ['system', 'System', Cpu],
  ['diagnostics', 'Proxy diagnostics', Route],
  ['security', 'Security', ShieldCheck],
];
const NAV_SECTIONS = { overview: 'Monitor', usage: 'Insights', system: 'Administration' };
/** Pages that share the request filter bar keep its filters when you switch between them. */
const FILTERED_PAGES = new Set(['overview', 'requests', 'caching']);

const HISTORY_LABELS = { postgres: 'Postgres', mongo: 'MongoDB', memory: 'in-memory' };

function CustomRangePicker({ from, to, retentionDays = 7, onSelect }) {
  const [now, setNow] = useState(Date.now);
  const localValue = (time) => {
    const date = new Date(time);
    return new Date(time - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  };
  const [start, setStart] = useState(() => localValue(from ?? now - 3_600_000));
  const [end, setEnd] = useState(() => localValue(to ?? now));
  const [error, setError] = useState('');
  return (
    <details
      onToggle={(event) => {
        if (event.currentTarget.open) setNow(Date.now());
      }}
    >
      <summary>Custom interval</summary>
      <form
        className="adm-filters"
        onSubmit={(event) => {
          event.preventDefault();
          const from = new Date(start).getTime();
          const to = new Date(end).getTime();
          if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
            setError('End must be after start.');
            return;
          }
          setError('');
          onSelect({ from, to });
        }}
      >
        <label className="adm-filter">
          <span>From (local time)</span>
          <input
            type="datetime-local"
            required
            min={localValue(now - retentionDays * 86_400_000)}
            max={localValue(now)}
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label className="adm-filter">
          <span>To (local time)</span>
          <input
            type="datetime-local"
            required
            max={localValue(now)}
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
        <button type="submit" className="adm-btn">
          Apply interval
        </button>
        {error && <span role="alert">{error}</span>}
      </form>
    </details>
  );
}

function Dashboard({ onLogout }) {
  const { page, params } = useHashRoute();
  const [navOpen, setNavOpen] = useState(false);
  const customFrom = params.from?.trim() ? Number(params.from) : NaN;
  const customTo = params.to?.trim() ? Number(params.to) : NaN;
  const hasCustomRange =
    params.range === 'custom' &&
    Number.isFinite(customFrom) &&
    Number.isFinite(customTo) &&
    Number.isFinite(new Date(customFrom).getTime()) &&
    Number.isFinite(new Date(customTo).getTime()) &&
    customTo > customFrom;
  const range = hasCustomRange
    ? 'custom'
    : RANGE_OPTIONS.includes(params.range)
      ? params.range
      : '1h';
  const rangeParams = hasCustomRange
    ? { range: 'custom', from: customFrom, to: customTo }
    : { range };
  const formatRangeBound = (value) =>
    new Date(value).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  const traceId = params.trace || null;
  const meta = useAsync(() => adminApi.meta(), [], { pollMs: 60_000 });
  // Hash routing keeps the old scroll offset; a new page should start at its header.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page]);
  const closeTrace = useCallback(
    () => navigate(page, { ...params, trace: undefined }),
    [page, params]
  );
  const selectCustomRange = useCallback(
    ({ from, to }) => navigate(page, { ...params, range: 'custom', from, to, cursor: undefined }),
    [page, params]
  );

  const pageProps = {
    range,
    rangeParams,
    params,
    onSelectRange: selectCustomRange,
    onOpenTrace: (trace) => navigate(page, { ...params, trace }),
    meta: meta.data,
  };
  const content = {
    overview: <Overview {...pageProps} />,
    requests: <Requests {...pageProps} />,
    live: <Live {...pageProps} />,
    errors: <Errors {...pageProps} />,
    upstreams: <Upstreams {...pageProps} />,
    usage: <Usage {...pageProps} />,
    caching: <Caching {...pageProps} />,
    system: <System {...pageProps} />,
    diagnostics: <Diagnostics {...pageProps} />,
    security: <Security />,
  }[page] ?? <Overview {...pageProps} />;

  const showRange = !['live', 'diagnostics', 'security'].includes(page);
  const sharedFilters = FILTERED_PAGES.has(page) ? pickFilters(params) : {};
  const linkQuery = (id) => {
    const query = new URLSearchParams({
      ...(range !== '1h' || hasCustomRange ? rangeParams : {}),
      ...(FILTERED_PAGES.has(id) ? sharedFilters : {}),
    }).toString();
    return query ? `?${query}` : '';
  };
  const m = meta.data;
  const caps = m?.capabilities;

  return (
    <div className="adm-shell">
      <nav className={`adm-nav ${navOpen ? 'is-open' : ''}`} aria-label="Admin sections">
        <div className="adm-nav-heading">
          <div className="adm-brand">
            <span className="adm-brand-mark">
              <Activity size={20} aria-hidden="true" />
            </span>
            <span>
              TMDB Discover+<small>OPERATIONS</small>
            </span>
          </div>
          <button
            type="button"
            className="adm-btn adm-icon-btn adm-mobile-menu"
            aria-label={navOpen ? 'Close navigation' : 'Open navigation'}
            title={navOpen ? 'Close navigation' : 'Open navigation'}
            aria-expanded={navOpen}
            aria-controls="adm-nav-links"
            onClick={() => setNavOpen(!navOpen)}
          >
            {navOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
        <div id="adm-nav-links" className="adm-nav-links">
          {PAGES.map(([id, label, Icon]) => (
            <div key={id}>
              {NAV_SECTIONS[id] && <div className="adm-nav-section">{NAV_SECTIONS[id]}</div>}
              <a
                href={`#/${id}${linkQuery(id)}`}
                className={page === id ? 'active' : ''}
                aria-current={page === id ? 'page' : undefined}
                onClick={() => setNavOpen(false)}
              >
                <Icon size={17} aria-hidden="true" />
                {label}
              </a>
            </div>
          ))}
        </div>
        <div className="adm-nav-foot">
          {m && (
            <div className="adm-muted">
              v{m.version} · live: {m.liveDriver} · history:{' '}
              {HISTORY_LABELS[m.persistence] ?? m.persistence}
            </div>
          )}
          <a
            className="adm-builder-link"
            href="/configure"
            target="_blank"
            rel="noopener noreferrer"
          >
            Catalog builder <ArrowUpRight size={14} aria-hidden="true" />
          </a>
          <button type="button" className="adm-btn" onClick={onLogout}>
            <LogOut size={15} aria-hidden="true" /> Sign out
          </button>
        </div>
      </nav>
      <main className="adm-main">
        <header className="adm-topbar">
          <h1>{PAGES.find(([id]) => id === page)?.[1] ?? 'Overview'}</h1>
          {showRange && (
            <div className="adm-range-control">
              <div className="adm-range" role="group" aria-label="Time range">
                {RANGE_OPTIONS.map((r) => (
                  <button
                    type="button"
                    key={r}
                    className={r === range ? 'active' : ''}
                    onClick={() => navigate(page, { ...params, range: r, cursor: undefined })}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <CustomRangePicker
                key={`${customFrom}:${customTo}`}
                from={hasCustomRange ? customFrom : undefined}
                to={hasCustomRange ? customTo : undefined}
                retentionDays={meta.data?.retentionDays}
                onSelect={selectCustomRange}
              />
              {hasCustomRange && (
                <button
                  type="button"
                  className="adm-range-current"
                  aria-label="Clear custom time interval and return to 1h"
                  title="Clear custom time interval"
                  onClick={() =>
                    navigate(page, { ...params, range: '1h', from: undefined, to: undefined })
                  }
                >
                  <span>
                    {formatRangeBound(customFrom)} – {formatRangeBound(customTo)}
                  </span>
                  <X size={14} aria-hidden="true" />
                </button>
              )}
            </div>
          )}
        </header>
        {caps?.history === 'memory' && (
          <div className="adm-alert adm-tone-warn">
            No database for history: keeping the last {caps.memoryCapacity?.toLocaleString()}{' '}
            requests of this instance in memory. They are lost on restart.
          </div>
        )}
        <ErrorNote error={meta.error} />
        {m?.sampleRate < 1 && (
          <div className="adm-alert adm-tone-warn">
            Request history is sampled ({Math.round(m.sampleRate * 100)}% of ordinary responses).
            Counts are weighted estimates; percentiles and config counts describe stored requests.
            Explorer totals are stored matches, not all traffic.
          </div>
        )}
        {(m?.storage?.paused || m?.collector?.storagePaused) && (
          <div className="adm-alert adm-tone-bad">
            Storage cap reached (OBS_MAX_STORAGE_MB): raw request, dependency, log and system
            history is paused until older data expires.
          </div>
        )}
        {m?.collector?.failedWrites?.historyBatches > 0 && (
          <div className="adm-alert adm-tone-warn">
            History writes have failed on {m.collectorScope || m.instance}. Recorded history may
            have gaps; inspect per-instance counters in System. Missing rows cannot be inferred as
            zero traffic.
          </div>
        )}
        {params.range === 'custom' && !hasCustomRange ? (
          <div className="adm-alert adm-tone-bad" role="alert">
            Invalid custom interval. Choose a preset or enter valid start and end times.
          </div>
        ) : (
          content
        )}
      </main>
      {traceId && (
        <TraceDrawer
          requestId={traceId}
          onClose={closeTrace}
          onInvestigate={(target, filters) => navigate(target, { range, ...filters })}
          onOpenError={(fp) => {
            navigate('errors', { range, fp });
          }}
        />
      )}
    </div>
  );
}

export function AdminApp() {
  const [session, setSession] = useState(null);
  const [error, setError] = useState(null);

  const refresh = useCallback(() => {
    adminApi
      .session()
      .then((s) => {
        setSession(s);
        setError(null);
      })
      .catch((err) => setError(err));
  }, []);

  useEffect(() => {
    refresh();
    const onUnauthorized = () => setSession((s) => (s ? { ...s, authenticated: false } : s));
    window.addEventListener('admin:unauthorized', onUnauthorized);
    return () => window.removeEventListener('admin:unauthorized', onUnauthorized);
  }, [refresh]);

  if (error) {
    return (
      <div className="adm-login">
        <div className="adm-login-card">
          <h1>Admin unavailable</h1>
          <p className="adm-muted">
            {error.status === 404
              ? 'The admin dashboard is not enabled on this server.'
              : error.message}
          </p>
        </div>
      </div>
    );
  }
  if (!session) return <Loading />;
  if (!session.authenticated)
    return <Login totpRequired={session.totpRequired} onSuccess={refresh} />;

  return (
    <Dashboard
      onLogout={async () => {
        await adminApi.logout().catch(() => undefined);
        refresh();
      }}
    />
  );
}
