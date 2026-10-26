import { useEffect } from 'react';
import { adminApi } from '../api.js';
import { useAsync } from '../hooks.js';
import { Badge, ErrorNote, Loading, Panel } from '../components/ui.jsx';
import { fmtMs, fmtTime, statusTone } from '../format.js';

function Field({ label, children }) {
  return (
    <div className="adm-trace-field">
      <span className="adm-muted">{label}</span>
      <span className="mono">{children || '–'}</span>
    </div>
  );
}

export function TraceDrawer({ requestId, onClose, onOpenError }) {
  const { data, error, loading } = useAsync(() => adminApi.trace(requestId), [requestId]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const req = data?.requests?.[0];
  const total = req ? Number(req.duration_ms) || 1 : 1;
  const start = req ? new Date(req.ts).getTime() : 0;

  return (
    <div
      className="adm-drawer-backdrop"
      role="presentation"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <aside className="adm-drawer" role="dialog" aria-modal="true" aria-label="Request trace">
        <header className="adm-panel-head">
          <h2>
            Request <span className="mono">{requestId}</span>
          </h2>
          <button type="button" className="adm-btn" onClick={onClose}>
            Close
          </button>
        </header>
        {loading && <Loading />}
        <ErrorNote error={error} />
        {data && !req && (
          <div className="adm-empty">
            Not stored. It may be older than retention or still in the flush buffer (≈5s).
          </div>
        )}
        {req && (
          <div className="adm-stack">
            <div className="adm-trace-grid">
              <Field label="Time">{fmtTime(req.ts)}</Field>
              <Field label="Status">
                <Badge tone={statusTone(req.status)}>{req.status}</Badge>
              </Field>
              <Field label="Duration">{fmtMs(req.duration_ms)}</Field>
              <Field label="Method">{req.method}</Field>
              <Field label="Route">{req.route}</Field>
              <Field label="Path">{req.path}</Field>
              <Field label="Source">{req.source}</Field>
              <Field label="Content type">{req.content_type}</Field>
              <Field label="Catalog">{req.catalog_id}</Field>
              <Field label="Config (hashed)">{req.user_hash}</Field>
              <Field label="Client">{req.client}</Field>
              <Field label="User-Agent">{req.ua}</Field>
              <Field label="Country / edge">
                {[req.country, req.colo].filter(Boolean).join(' / ')}
              </Field>
              <Field label="Instance">{req.instance}</Field>
              <Field label="Cache hits / misses">{`${req.cache_hits} / ${req.cache_misses}`}</Field>
              <Field label="Upstream calls">{`${req.upstream_calls} (${fmtMs(req.upstream_ms)} total)`}</Field>
            </div>

            <Panel title={`Upstream calls (${data.upstream.length})`}>
              {data.upstream.length === 0 ? (
                <div className="adm-empty">None — served from cache or no outbound calls.</div>
              ) : (
                <div className="adm-waterfall">
                  {data.upstream.map((u, i) => {
                    const offset = Math.max(0, new Date(u.ts).getTime() - start);
                    return (
                      <div key={i} className="adm-waterfall-row">
                        <span className="adm-waterfall-label mono" title={`${u.host}${u.path}`}>
                          <Badge tone={statusTone(u.status)}>{u.status || 'ERR'}</Badge>{' '}
                          {u.provider} {u.path}
                        </span>
                        <span className="adm-waterfall-track">
                          <span
                            className={`adm-waterfall-bar adm-tone-${statusTone(u.status)}`}
                            style={{
                              left: `${Math.min(100, (offset / total) * 100)}%`,
                              width: `${Math.max(0.5, Math.min(100, (u.duration_ms / total) * 100))}%`,
                            }}
                          />
                        </span>
                        <span className="num">{fmtMs(u.duration_ms)}</span>
                        {u.error && (
                          <span className="adm-text-bad adm-waterfall-error">{u.error}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Panel>

            <Panel title={`Errors & warnings (${data.errors.length})`}>
              {data.errors.length === 0 ? (
                <div className="adm-empty">None logged during this request.</div>
              ) : (
                <ul className="adm-list">
                  {data.errors.map((e, i) => (
                    <li key={i}>
                      <Badge tone={e.level === 'error' ? 'bad' : 'warn'}>{e.level}</Badge>{' '}
                      <span className="adm-muted">{e.context}</span>{' '}
                      <button
                        type="button"
                        className="adm-link"
                        onClick={() => onOpenError(e.fingerprint)}
                      >
                        {e.message}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        )}
      </aside>
    </div>
  );
}
