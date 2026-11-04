import { useState } from 'react';
import { adminApi, downloadExport } from '../api.js';
import { useAsync, navigate } from '../hooks.js';
import { Badge, ErrorNote, Loading, Panel, Sparkline } from '../components/ui.jsx';
import { fmtAgo, fmtInt, fmtTime } from '../format.js';

const STATUS_TONES = { open: 'warn', regressed: 'warn', resolved: 'good', ignored: 'muted' };

function ErrorDetail({ fingerprint, onOpenTrace, onChanged, range, params }) {
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
          <button
            type="button"
            className="adm-btn"
            onClick={() =>
              navigate('errors', { ...params, range, fp: undefined, trace: undefined })
            }
          >
            Back
          </button>
        </>
      }
    >
      <ErrorNote error={actionError} />
      <p className="mono adm-error-message">{g.message}</p>
      <p className="adm-muted">
        Message and stack are all-time samples; events below show their individual causes.
      </p>
      <Badge tone={g.classification === 'user_config' ? 'warn' : 'muted'}>
        {g.classification || 'Unclassified historical event'}
      </Badge>
      <div className="adm-trace-grid">
        <div className="adm-trace-field">
          <span className="adm-muted">Status</span>
          <Badge tone={STATUS_TONES[g.status]}>{g.status}</Badge>
        </div>
        <div className="adm-trace-field">
          <span className="adm-muted">All-time occurrences</span>
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
      <button
        type="button"
        className="adm-btn"
        onClick={() =>
          navigate('errors', {
            range: '7d',
            status: 'all',
            q: g.message.slice(0, 40),
          })
        }
      >
        Find related historical logs
      </button>
      <div className="adm-grid-2">
        <div>
          <h3>Affected routes</h3>
          <ul className="adm-list">
            {data.routes.map((r) => (
              <li key={r.route}>
                {r.route ? (
                  <button
                    type="button"
                    className="adm-link mono"
                    onClick={() =>
                      navigate('requests', {
                        range,
                        route: r.route,
                        errorsOnly: 'true',
                        view: 'events',
                      })
                    }
                  >
                    {r.route}
                  </button>
                ) : (
                  <span className="mono">Background job</span>
                )}{' '}
                · {fmtInt(r.count)}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3>Recent event samples</h3>
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

export function Errors({ range, rangeParams = { range }, params, onOpenTrace }) {
  const status = params.status || 'active';
  const level = params.level || '';
  const classification = params.classification || '';
  const q = params.q || '';
  const [search, setSearch] = useState(q);
  const list = useAsync(
    () => adminApi.errors({ ...rangeParams, status, level, q, classification }),
    [range, rangeParams.from, rangeParams.to, status, level, q, classification],
    {
      pollMs: 60_000,
    }
  );

  if (params.fp) {
    return (
      <ErrorDetail
        key={params.fp}
        fingerprint={params.fp}
        onOpenTrace={onOpenTrace}
        onChanged={list.reload}
        range={range}
        params={params}
      />
    );
  }

  const go = (next) => navigate('errors', { range, status, level, q, classification, ...next });
  // Busiest in the selected range first; `count` is all-time.
  const groups = [...(list.data?.groups || [])].sort(
    (a, b) => Number(b.range_count ?? 0) - Number(a.range_count ?? 0)
  );
  const sparkMax = Math.max(
    1,
    ...groups.flatMap((g) => (g.spark || []).map((point) => Number(point[1])))
  );

  return (
    <Panel
      title="Application log groups"
      actions={
        <>
          <select
            className="adm-input"
            aria-label="Log classification"
            value={classification}
            onChange={(e) => go({ classification: e.target.value })}
          >
            <option value="">All causes</option>
            <option value="application">Application</option>
            <option value="user_config">User configuration</option>
          </select>
          <select
            className="adm-input"
            aria-label="Triage status"
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
            aria-label="Log level"
            value={level}
            onChange={(e) => go({ level: e.target.value })}
          >
            <option value="">Errors + warnings</option>
            <option value="error">Errors only</option>
            <option value="warn">Warnings only</option>
          </select>
          <input
            className="adm-input"
            aria-label="Search log message"
            placeholder="Search message…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && go({ q: search })}
          />
          <button
            type="button"
            className="adm-btn"
            onClick={() =>
              downloadExport({ kind: 'errors', ...rangeParams, status, level, q, classification })
            }
          >
            Export CSV
          </button>
        </>
      }
    >
      <ErrorNote error={list.error} />
      <p className="adm-muted">
        Issue labels are all-time samples. Inspect individual events before attributing a cause to
        this range.
      </p>
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
                <th>Triage</th>
                <th className="num">In range</th>
                <th className="num">All-time</th>
                <th>Trend</th>
                <th>Last seen</th>
                <th>First seen</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.fingerprint} className="adm-clickable">
                  <td>
                    <div>
                      <Badge tone={g.level === 'error' ? 'bad' : 'warn'}>{g.level}</Badge>{' '}
                      <span className="adm-muted">{g.context}</span>{' '}
                      {g.classification && <Badge>{g.classification}</Badge>}
                    </div>
                    <div className="mono adm-ellipsis adm-error-line" title={g.message}>
                      <button
                        type="button"
                        className="adm-link mono"
                        onClick={() => go({ fp: g.fingerprint })}
                      >
                        {g.message}
                      </button>
                    </div>
                    {g.sample_route && <div className="adm-muted mono">{g.sample_route}</div>}
                  </td>
                  <td>
                    <Badge tone={STATUS_TONES[g.status]}>{g.status}</Badge>
                  </td>
                  <td className="num">{fmtInt(g.range_count)}</td>
                  <td className="num">{fmtInt(g.count)}</td>
                  <td className={g.level === 'error' ? 'adm-text-bad' : 'adm-text-warn'}>
                    <span
                      title={`Shared scale: 0–${fmtInt(sparkMax)} recorded occurrences per bucket`}
                    >
                      <Sparkline points={g.spark || []} max={sparkMax} />
                    </span>
                  </td>
                  <td className="nowrap">{fmtAgo(g.last_seen)}</td>
                  <td className="nowrap">{fmtAgo(g.first_seen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
