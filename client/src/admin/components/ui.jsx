import { fmtInt } from '../format.js';

export function Panel({ title, actions, children, className = '' }) {
  return (
    <section className={`adm-panel ${className}`}>
      {(title || actions) && (
        <header className="adm-panel-head">
          {title && <h2>{title}</h2>}
          {actions && <div className="adm-panel-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function StatCard({ label, value, sub, tone, onClick }) {
  const content = (
    <span className={`adm-stat ${tone ? `adm-tone-${tone}` : ''}`}>
      <span className="adm-stat-label">{label}</span>
      <span className="adm-stat-value">{value}</span>
      {sub && <span className="adm-stat-sub">{sub}</span>}
    </span>
  );
  return onClick ? (
    <button type="button" className="adm-stat-button" onClick={onClick}>
      {content}
    </button>
  ) : (
    content
  );
}

export function Badge({ tone = 'muted', children, title }) {
  return (
    <span className={`adm-badge adm-tone-${tone}`} title={title}>
      {children}
    </span>
  );
}

export function BarList({ items, onSelect, format = fmtInt, empty = 'No data' }) {
  if (!items?.length) return <div className="adm-empty">{empty}</div>;
  const max = Math.max(...items.map((i) => Number(i.count) || 0), 1);
  return (
    <ul className="adm-barlist">
      {items.map((item) => (
        <li key={item.key}>
          <button
            type="button"
            className="adm-barlist-row"
            onClick={onSelect ? () => onSelect(item.key, item) : undefined}
            disabled={!onSelect}
          >
            <span
              className="adm-barlist-fill"
              style={{ width: `${(Number(item.count) / max) * 100}%` }}
            />
            <span className="adm-barlist-label">{item.key || '(none)'}</span>
            <span className="adm-barlist-value">{format(item.count)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function ErrorNote({ error }) {
  if (!error) return null;
  return <div className="adm-alert adm-tone-bad">{error.message || String(error)}</div>;
}

export function Loading() {
  return <div className="adm-empty">Loading…</div>;
}

export function Sparkline({ points: raw, width = 120, height = 24 }) {
  if (!raw?.length) return <svg width={width} height={height} aria-hidden="true" />;
  const points = raw.length === 1 ? [[raw[0][0] - 1, raw[0][1]], raw[0]] : raw;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const minX = Math.min(...xs);
  const spanX = Math.max(...xs) - minX || 1;
  const maxY = Math.max(...ys, 1);
  const d = points
    .map(
      (p, i) =>
        `${i ? 'L' : 'M'}${(((p[0] - minX) / spanX) * (width - 2) + 1).toFixed(1)},${(
          height -
          1 -
          (p[1] / maxY) * (height - 2)
        ).toFixed(1)}`
    )
    .join(' ');
  return (
    <svg width={width} height={height} className="adm-spark" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
