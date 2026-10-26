import { useEffect, useMemo, useRef, useState } from 'react';
import { openLiveStream } from '../api.js';
import { Badge, Panel } from '../components/ui.jsx';
import { fmtMs, statusTone } from '../format.js';

const MAX_ROWS = 500;

export function Live({ onOpenTrace, meta }) {
  const [rows, setRows] = useState([]);
  const [paused, setPaused] = useState(false);
  const [status, setStatus] = useState('connecting');
  const [filter, setFilter] = useState({ text: '', errorsOnly: false, minMs: '' });
  const [queuedCount, setQueuedCount] = useState(0);
  const pausedRef = useRef(paused);
  const queueRef = useRef([]);

  useEffect(() => {
    pausedRef.current = paused;
    if (!paused && queueRef.current.length) {
      const queued = queueRef.current;
      queueRef.current = [];
      setQueuedCount(0);
      setRows((r) => [...queued, ...r].slice(0, MAX_ROWS));
    }
  }, [paused]);

  useEffect(() => {
    let retry;
    let close = () => {};
    const connect = () => {
      setStatus('connecting');
      close = openLiveStream({
        onBacklog: (items) => {
          setStatus('live');
          setRows(items.slice(0, MAX_ROWS));
        },
        onRequests: (items) => {
          const newest = [...items].reverse();
          if (pausedRef.current) {
            queueRef.current = [...newest, ...queueRef.current].slice(0, MAX_ROWS);
            setQueuedCount(queueRef.current.length);
          } else {
            setRows((r) => [...newest, ...r].slice(0, MAX_ROWS));
          }
        },
        onError: () => {
          setStatus('reconnecting');
          retry = setTimeout(connect, 5000);
        },
      });
    };
    connect();
    return () => {
      clearTimeout(retry);
      close();
    };
  }, []);

  const visible = useMemo(() => {
    const text = filter.text.toLowerCase();
    const minMs = Number(filter.minMs) || 0;
    return rows.filter(
      (r) =>
        (!filter.errorsOnly || r.status >= 500 || r.errorFp) &&
        r.durationMs >= minMs &&
        (!text ||
          `${r.path} ${r.route} ${r.client} ${r.country} ${r.status} ${r.source}`
            .toLowerCase()
            .includes(text))
    );
  }, [rows, filter]);

  return (
    <Panel
      title={
        <>
          Live requests <Badge tone={status === 'live' ? 'good' : 'warn'}>{status}</Badge>
        </>
      }
      actions={
        <>
          <input
            className="adm-input"
            placeholder="Filter path, client, status…"
            value={filter.text}
            onChange={(e) => setFilter((f) => ({ ...f, text: e.target.value }))}
          />
          <input
            className="adm-input adm-input-sm"
            type="number"
            placeholder="min ms"
            value={filter.minMs}
            onChange={(e) => setFilter((f) => ({ ...f, minMs: e.target.value }))}
          />
          <label className="adm-filter-check">
            <input
              type="checkbox"
              checked={filter.errorsOnly}
              onChange={(e) => setFilter((f) => ({ ...f, errorsOnly: e.target.checked }))}
            />
            <span>Errors</span>
          </label>
          <button type="button" className="adm-btn" onClick={() => setPaused((p) => !p)}>
            {paused ? `Resume (${queuedCount})` : 'Pause'}
          </button>
        </>
      }
    >
      <p className="adm-muted">
        {meta?.capabilities?.sharedLive
          ? 'Requests from all instances'
          : 'Requests on this instance'}
        , delivered in ~5s batches (up to 200 per instance per batch).
      </p>
      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Status</th>
              <th>Method</th>
              <th>Path</th>
              <th className="num">Duration</th>
              <th>Client</th>
              <th>Country</th>
              <th>Instance</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr
                key={`${r.requestId}-${r.ts}`}
                className="adm-clickable"
                onClick={() => onOpenTrace(r.requestId)}
              >
                <td className="nowrap">{new Date(r.ts).toLocaleTimeString()}</td>
                <td>
                  <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                  {r.errorFp && <Badge tone="bad">err</Badge>}
                </td>
                <td>{r.method}</td>
                <td className="mono adm-ellipsis" title={r.path}>
                  {r.path}
                </td>
                <td className="num">{fmtMs(r.durationMs)}</td>
                <td className="nowrap">{r.client}</td>
                <td>{r.country}</td>
                <td className="mono">{r.instance}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
