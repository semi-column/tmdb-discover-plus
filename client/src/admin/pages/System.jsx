import { useMemo } from 'react';
import { adminApi } from '../api.js';
import { useAsync } from '../hooks.js';
import { TimeChart } from '../components/TimeChart.jsx';
import { Badge, ErrorNote, Loading, Panel, StatCard } from '../components/ui.jsx';
import { fmtAgo, fmtBytes, fmtInt, fmtMs } from '../format.js';

function seriesByInstance(rows, pick) {
  const instances = [...new Set(rows.map((r) => r.instance))].slice(0, 8);
  const times = [...new Set(rows.map((r) => Math.floor(new Date(r.bucket).getTime() / 1000)))].sort(
    (a, b) => a - b
  );
  const index = new Map(times.map((t, i) => [t, i]));
  const values = instances.map(() => times.map(() => null));
  for (const row of rows) {
    const i = instances.indexOf(row.instance);
    const t = index.get(Math.floor(new Date(row.bucket).getTime() / 1000));
    if (i !== -1 && t !== undefined) values[i][t] = pick(row.data);
  }
  return { data: [times, ...values], series: instances.map((label) => ({ label })) };
}

export function System({ range, meta }) {
  const { data, error, loading } = useAsync(() => adminApi.system({ range }), [range], {
    pollMs: 30_000,
  });

  const charts = useMemo(() => {
    const rows = data?.series || [];
    if (!rows.length) return null;
    return {
      heap: seriesByInstance(rows, (d) => d.heapUsedMb),
      rss: seriesByInstance(rows, (d) => d.rssMb),
      loop: seriesByInstance(rows, (d) => d.eventLoop?.p99Ms),
      cpu: seriesByInstance(rows, (d) => d.cpuPct),
    };
  }, [data]);

  if (loading && !data) return <Loading />;

  const c = meta?.collector;
  return (
    <div className="adm-stack">
      <ErrorNote error={error} />
      <Panel title={meta?.capabilities?.sharedLive ? 'Instances' : 'This instance'}>
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>Instance</th>
                <th>State</th>
                <th>Version</th>
                <th className="num">Uptime</th>
                <th className="num">Heap</th>
                <th className="num">RSS</th>
                <th className="num">CPU</th>
                <th className="num">Loop p99</th>
                <th>TMDB circuit</th>
                <th>Cache</th>
              </tr>
            </thead>
            <tbody>
              {(data?.instances || []).map((inst) => {
                const s = inst.sample;
                // The server only returns a sample for instances that heartbeated in the last 90s.
                const fresh = !!s;
                return (
                  <tr key={inst.instance}>
                    <td className="mono">{inst.instance}</td>
                    <td>
                      <Badge tone={fresh ? 'good' : 'muted'}>
                        {fresh ? 'up' : `gone · ${fmtAgo(inst.lastSeen)}`}
                      </Badge>
                    </td>
                    <td>{s?.version ?? '–'}</td>
                    <td className="num">{s ? `${Math.round(s.uptimeSec / 3600)}h` : '–'}</td>
                    <td className="num">{s ? `${s.heapUsedMb} MB` : '–'}</td>
                    <td className="num">{s ? `${s.rssMb} MB` : '–'}</td>
                    <td className="num">{s ? `${s.cpuPct}%` : '–'}</td>
                    <td className="num">{s ? fmtMs(s.eventLoop?.p99Ms) : '–'}</td>
                    <td>
                      {s?.tmdbCircuit ? (
                        <Badge tone={s.tmdbCircuit.state === 'open' ? 'bad' : 'good'}>
                          {s.tmdbCircuit.state}
                        </Badge>
                      ) : (
                        '–'
                      )}
                    </td>
                    <td className="mono">{s?.cache?.driver ?? '–'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      {charts ? (
        <>
          <div className="adm-grid-2">
            <Panel title="Heap used (MB)">
              <TimeChart data={charts.heap.data} series={charts.heap.series} height={180} />
            </Panel>
            <Panel title="RSS (MB)">
              <TimeChart data={charts.rss.data} series={charts.rss.series} height={180} />
            </Panel>
          </div>
          <div className="adm-grid-2">
            <Panel title="Event loop delay p99 (ms)">
              <TimeChart data={charts.loop.data} series={charts.loop.series} height={180} />
            </Panel>
            <Panel title="CPU (% of one core)">
              <TimeChart data={charts.cpu.data} series={charts.cpu.series} height={180} />
            </Panel>
          </div>
        </>
      ) : (
        data &&
        !data.series && (
          <div className="adm-alert adm-tone-warn">No system history recorded yet.</div>
        )
      )}

      {meta && (
        <Panel title="Observability pipeline">
          <div className="adm-stats">
            <StatCard
              label="Live store"
              value={meta.liveDriver}
              sub={
                meta.liveDriver === 'memory' ? 'single instance only' : 'shared across instances'
              }
            />
            <StatCard
              label="History"
              value={meta.persistence}
              sub={`${meta.retentionDays} days retention`}
            />
            <StatCard
              label="Sample rate"
              value={`${Math.round(meta.sampleRate * 100)}%`}
              sub={`slow ≥ ${fmtMs(meta.slowMs)} always kept`}
            />
            {c && (
              <StatCard
                label="Last flush"
                value={c.lastFlushAt ? fmtAgo(c.lastFlushAt) : '–'}
                sub={`${fmtMs(c.lastFlushMs)} · dropped ${fmtInt(Object.values(c.dropped).reduce((a, b) => a + b, 0))}`}
                tone={c.lastFlushError ? 'warn' : undefined}
              />
            )}
          </div>
          {c?.lastFlushError && (
            <div className="adm-alert adm-tone-warn">Last flush problem: {c.lastFlushError}</div>
          )}
          {meta.storage?.memory && (
            <p className="adm-muted">
              In-memory history: {fmtInt(meta.storage.memory.requests)} /{' '}
              {fmtInt(meta.storage.memory.capacity)} requests,{' '}
              {fmtInt(meta.storage.memory.upstream)} upstream calls,{' '}
              {fmtInt(meta.storage.memory.errorEvents)} error events.
            </p>
          )}
          {meta.storage?.tables?.length > 0 && (
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Table / collection</th>
                  <th className="num">Partitions</th>
                  <th className="num">Size</th>
                </tr>
              </thead>
              <tbody>
                {meta.storage.tables.map((t) => (
                  <tr key={t.table_name}>
                    <td className="mono">{t.table_name}</td>
                    <td className="num">{t.partitions ? fmtInt(t.partitions) : '–'}</td>
                    <td className="num">{fmtBytes(t.bytes)}</td>
                  </tr>
                ))}
                <tr>
                  <td>
                    <strong>Total</strong>
                  </td>
                  <td />
                  <td className="num">
                    <strong>
                      {fmtBytes(meta.storage.totalBytes)}
                      {meta.storage.capBytes ? ` / ${fmtBytes(meta.storage.capBytes)} cap` : ''}
                    </strong>
                  </td>
                </tr>
              </tbody>
            </table>
          )}
          <p className="adm-muted">
            Served by instance <span className="mono">{meta.instance}</span> · v{meta.version}
          </p>
        </Panel>
      )}
    </div>
  );
}
