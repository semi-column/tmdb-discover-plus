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

const PAGES = [
  ['overview', 'Overview'],
  ['requests', 'Requests'],
  ['live', 'Live tail'],
  ['errors', 'Errors'],
  ['upstreams', 'Upstream APIs'],
  ['usage', 'Usage'],
  ['system', 'System'],
  ['diagnostics', 'Proxy diagnostics'],
  ['security', 'Security'],
];

const HISTORY_LABELS = { postgres: 'Postgres', mongo: 'MongoDB', memory: 'in-memory' };

function Dashboard({ onLogout }) {
  const { page, params } = useHashRoute();
  const range = RANGE_OPTIONS.includes(params.range) ? params.range : '1h';
  const [traceId, setTraceId] = useState(null);
  const meta = useAsync(() => adminApi.meta(), [], { pollMs: 60_000 });
  const closeTrace = useCallback(() => setTraceId(null), []);

  const pageProps = { range, params, onOpenTrace: setTraceId, meta: meta.data };
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
      <nav className="adm-nav" aria-label="Admin sections">
        <div className="adm-brand">TMDB Discover+ · Admin</div>
        {PAGES.map(([id, label]) => (
          <a
            key={id}
            href={`#/${id}${showRange && range !== '1h' ? `?range=${range}` : ''}`}
            className={page === id ? 'active' : ''}
          >
            {label}
          </a>
        ))}
        <div className="adm-nav-foot">
          {m && (
            <div className="adm-muted">
              v{m.version} · live: {m.liveDriver} · history:{' '}
              {HISTORY_LABELS[m.persistence] ?? m.persistence}
            </div>
          )}
          <button type="button" className="adm-btn" onClick={onLogout}>
            Sign out
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
          onOpenError={(fp) => {
            setTraceId(null);
            navigate('errors', { fp });
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
