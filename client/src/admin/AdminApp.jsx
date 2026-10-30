import { useCallback, useEffect, useState } from 'react';
import { adminApi } from './api.js';
import { useAsync, useHashRoute, navigate } from './hooks.js';
import { RANGE_OPTIONS } from './format.js';
import { Loading } from './components/ui.jsx';
import { TraceDrawer } from './components/TraceDrawer.jsx';
import { Login } from './pages/Login.jsx';
import { Overview } from './pages/Overview.jsx';
import { Requests } from './pages/Requests.jsx';
import { Live } from './pages/Live.jsx';
import { Errors } from './pages/Errors.jsx';
import { Upstreams } from './pages/Upstreams.jsx';
import { Usage } from './pages/Usage.jsx';
import { System } from './pages/System.jsx';
import { Diagnostics } from './pages/Diagnostics.jsx';
import { Security } from './pages/Security.jsx';
import {
  Activity,
  ArrowLeft,
  ArrowUpRight,
  ChevronRight,
  Menu,
  X,
  LayoutDashboard,
  ListFilter,
  Radio,
  FileWarning,
  Network,
  ChartNoAxesCombined,
  Cpu,
  Route,
  ShieldCheck,
  LogOut,
} from 'lucide-react';

const PAGES = [
  ['overview', 'Overview', LayoutDashboard],
  ['requests', 'Requests', ListFilter],
  ['live', 'Live tail', Radio],
  ['errors', 'Application logs', FileWarning],
  ['upstreams', 'Dependencies', Network],
  ['usage', 'Usage', ChartNoAxesCombined],
  ['system', 'System', Cpu],
  ['diagnostics', 'Proxy diagnostics', Route],
  ['security', 'Security', ShieldCheck],
];

const HISTORY_LABELS = { postgres: 'Postgres', mongo: 'MongoDB', memory: 'in-memory' };

function Dashboard({ onLogout }) {
  const { page, params } = useHashRoute();
  const [navOpen, setNavOpen] = useState(false);
  const range = RANGE_OPTIONS.includes(params.range) ? params.range : '1h';
  const traceId = params.trace || null;
  const meta = useAsync(() => adminApi.meta(), [], { pollMs: 60_000 });
  const closeTrace = useCallback(
    () => navigate(page, { ...params, trace: undefined }),
    [page, params]
  );

  const pageProps = {
    range,
    params,
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
    system: <System {...pageProps} />,
    diagnostics: <Diagnostics {...pageProps} />,
    security: <Security />,
  }[page] ?? <Overview {...pageProps} />;

  const showRange = !['live', 'diagnostics', 'security'].includes(page);
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
          {PAGES.map(([id, label, Icon], index) => (
            <div key={id}>
              {(index === 0 || index === 6) && (
                <div className="adm-nav-section">{index === 0 ? 'Monitor' : 'Administration'}</div>
              )}
              <a
                href={`#/${id}${range !== '1h' ? `?range=${range}` : ''}`}
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
          )}
        </header>
        {page !== 'overview' && (
          <nav className="adm-breadcrumbs" aria-label="Investigation path">
            <button
              type="button"
              className="adm-link"
              onClick={() => navigate('overview', { range })}
            >
              <ArrowLeft size={14} /> Overview
            </button>
            <ChevronRight size={14} aria-hidden="true" />
            <span>{PAGES.find(([id]) => id === page)?.[1]}</span>
            {params.provider && (
              <>
                <ChevronRight size={14} aria-hidden="true" />
                <button
                  type="button"
                  className="adm-link"
                  onClick={() => navigate(page, { range, provider: params.provider })}
                >
                  {params.provider}
                </button>
              </>
            )}
            {params.endpoint && (
              <>
                <ChevronRight size={14} aria-hidden="true" />
                <span className="mono">{params.endpoint}</span>
              </>
            )}
          </nav>
        )}
        {caps?.history === 'memory' && (
          <div className="adm-alert adm-tone-warn">
            No database for history: keeping the last {caps.memoryCapacity?.toLocaleString()}{' '}
            requests of this instance in memory. They are lost on restart.
          </div>
        )}
        {m?.collector?.storagePaused && (
          <div className="adm-alert adm-tone-bad">
            Storage cap reached (OBS_MAX_STORAGE_MB): new request history is paused until older data
            expires.
          </div>
        )}
        {content}
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
