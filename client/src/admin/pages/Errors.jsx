import { useState } from 'react';
import { adminApi, downloadExport } from '../api.js';
import { useAsync, navigate } from '../hooks.js';
import { Badge, ErrorNote, Loading, Panel, Sparkline } from '../components/ui.jsx';
import { fmtAgo, fmtInt, fmtTime } from '../format.js';

const STATUS_TONES = { open: 'bad', regressed: 'bad', resolved: 'good', ignored: 'muted' };

function ErrorDetail({ fingerprint, onOpenTrace, onChanged }) {
  const { data, error, loading, reload } = useAsync(
    () => adminApi.errorGroup(fingerprint),
    [fingerprint]
  );
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  const setStatus = async (status) => {
    setBusy(true);
    setActionError(null);
    try {
      await adminApi.setErrorStatus(fingerprint, status);
      reload();
      onChanged();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) return <Loading />;
  if (!data) return <ErrorNote error={error} />;
  const g = data.group;

  return (
    <Panel
      title={
        <>
          <Badge tone={g.level === 'error' ? 'bad' : 'warn'}>{g.level}</Badge> {g.context}
        </>
      }
      actions={
        <>
          {g.status !== 'resolved' && (
            <button
              type="button"
              className="adm-btn adm-btn-primary"
              disabled={busy}
              onClick={() => setStatus('resolved')}
            >
              Resolve
            </button>
          )}
          {g.status !== 'ignored' && (
            <button
              type="button"
              className="adm-btn"
              disabled={busy}
              onClick={() => setStatus('ignored')}
            >
              Ignore
            </button>
          )}
          {g.status !== 'open' && (
            <button
              type="button"
              className="adm-btn"
              disabled={busy}
              onClick={() => setStatus('open')}
            >
              Reopen
            </button>
          )}
          <button type="button" className="adm-btn" onClick={() => navigate('errors')}>
            Back
          </button>
        </>
      }
    >
      <ErrorNote error={actionError} />
      <p className="mono adm-error-message">{g.message}</p>
      <div className="adm-trace-grid">
        <div className="adm-trace-field">
          <span className="adm-muted">Status</span>
          <Badge tone={STATUS_TONES[g.status]}>{g.status}</Badge>
        </div>
        <div className="adm-trace-field">
          <span className="adm-muted">Occurrences</span>
          <span>{fmtInt(g.count)}</span>
        </div>
        <div className="adm-trace-field">
          <span className="adm-muted">First seen</span>
          <span>
            {fmtTime(g.first_seen)} (v{g.first_version})
          </span>
        </div>
        <div className="adm-trace-field">
          <span className="adm-muted">Last seen</span>
          <span>
            {fmtTime(g.last_seen)} (v{g.last_version})
          </span>
        </div>
        <div className="adm-trace-field">
          <span className="adm-muted">Fingerprint</span>
          <span className="mono">{g.fingerprint}</span>
        </div>
      </div>
      {g.sample_stack && (
        <details open>
          <summary>Stack trace (sample)</summary>
          <pre className="adm-pre">{g.sample_stack}</pre>
        </details>
      )}
      <div className="adm-grid-2">
        <div>
          <h3>Affected routes</h3>
          <ul className="adm-list">
            {data.routes.map((r) => (
              <li key={r.route}>
                <span className="mono">{r.route || '(background job)'}</span> · {fmtInt(r.count)}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3>Recent occurrences</h3>
          <ul className="adm-list">
            {data.events.map((e, i) => (
              <li key={i}>
                <span className="nowrap">{fmtTime(e.ts)}</span>{' '}
                {e.request_id ? (
                  <button
                    type="button"
                    className="adm-link mono"
                    onClick={() => onOpenTrace(e.request_id)}
                  >
                    {e.request_id}
                  </button>
                ) : (
                  <span className="adm-muted">no request</span>
                )}{' '}
                <span className="adm-muted mono">{e.instance}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Panel>
  );
}

export function Errors({ range, params, onOpenTrace }) {
  const status = params.status || 'active';
  const level = params.level || '';
  const q = params.q || '';
  const [search, setSearch] = useState(q);
  const list = useAsync(
    () => adminApi.errors({ range, status, level, q }),
    [range, status, level, q],
    {
      pollMs: 60_000,
    }
  );

  if (params.fp) {
    return (
      <ErrorDetail fingerprint={params.fp} onOpenTrace={onOpenTrace} onChanged={list.reload} />
    );
  }

  const go = (next) => navigate('errors', { range, status, level, q, ...next });
  const groups = list.data?.groups || [];
  const version = list.data?.version;
  // On the first version ever deployed every group is "new", so only flag once older versions exist.
  const flagNew = !!version && groups.some((g) => g.first_version && g.first_version !== version);

  return (
    <Panel
      title="Errors & warnings (grouped)"
      actions={
        <>
          <select
            className="adm-input"
            value={status}
            onChange={(e) => go({ status: e.target.value })}
          >
            <option value="active">Active (open + regressed)</option>
            <option value="open">Open</option>
            <option value="regressed">Regressed</option>
            <option value="resolved">Resolved</option>
            <option value="ignored">Ignored</option>
            <option value="all">All</option>
          </select>
          <select
            className="adm-input"
            value={level}
            onChange={(e) => go({ level: e.target.value })}
          >
            <option value="">Errors + warnings</option>
            <option value="error">Errors only</option>
            <option value="warn">Warnings only</option>
          </select>
          <input
            className="adm-input"
            placeholder="Search message…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && go({ q: search })}
          />
          <button
            type="button"
            className="adm-btn"
            onClick={() => downloadExport({ kind: 'errors', range, status, level, q })}
          >
            Export CSV
          </button>
        </>
      }
    >
      <ErrorNote error={list.error} />
      {list.loading && !list.data ? (
        <Loading />
      ) : groups.length === 0 ? (
        <div className="adm-empty">No error groups seen in this range.</div>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>Issue</th>
                <th>Status</th>
                <th className="num">Total</th>
                <th>Trend</th>
                <th>Last seen</th>
                <th>First seen</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr
                  key={g.fingerprint}
                  className="adm-clickable"
                  onClick={() => go({ fp: g.fingerprint })}
                >
                  <td>
                    <div>
                      <Badge tone={g.level === 'error' ? 'bad' : 'warn'}>{g.level}</Badge>{' '}
                      <span className="adm-muted">{g.context}</span>{' '}
                      {flagNew && g.first_version === version && (
                        <Badge tone="warn" title="First seen in the currently deployed version">
                          new in v{version}
                        </Badge>
                      )}
                    </div>
                    <div className="mono adm-ellipsis adm-error-line" title={g.message}>
                      {g.message}
                    </div>
                    {g.sample_route && <div className="adm-muted mono">{g.sample_route}</div>}
                  </td>
                  <td>
                    <Badge tone={STATUS_TONES[g.status]}>{g.status}</Badge>
                  </td>
                  <td className="num">{fmtInt(g.count)}</td>
                  <td className={g.level === 'error' ? 'adm-text-bad' : 'adm-text-warn'}>
                    <Sparkline points={g.spark || []} />
                  </td>
                  <td className="nowrap">{fmtAgo(g.last_seen)}</td>
                  <td className="nowrap">{fmtAgo(g.first_seen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="adm-muted">
        Grouped from every warn/error the server logs. Totals are exact; trend lines use stored
        occurrences (capped at 50 per group per 5s per instance).
      </p>
    </Panel>
  );
}
