export const RANGE_OPTIONS = ['15m', '1h', '6h', '24h', '7d'];

export const fmtInt = (n) => (n === null || n === undefined ? '–' : Number(n).toLocaleString());

export const fmtPct = (ratio, digits = 2) =>
  ratio === null || ratio === undefined ? '–' : `${(Number(ratio) * 100).toFixed(digits)}%`;

export const fmtMs = (ms) => {
  if (ms === null || ms === undefined) return '–';
  const n = Number(ms);
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}s` : `${Math.round(n)}ms`;
};

/** Percentiles from histogram buckets are upper bounds, so show them as "≤". */
export const fmtBucketMs = (ms) => (ms === null || ms === undefined ? '–' : `≤${fmtMs(ms)}`);

export const fmtTime = (value) => {
  if (!value) return '–';
  const d = new Date(value);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

export const fmtAgo = (value) => {
  if (!value) return '–';
  const sec = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`;
  return `${Math.round(sec / 86400)}d ago`;
};

export const fmtBytes = (bytes) => {
  const n = Number(bytes);
  if (!Number.isFinite(n)) return '–';
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
};

export const statusTone = (status) => {
  const s = Number(status);
  if (s >= 500 || s === 0) return 'bad';
  if (s >= 400) return 'warn';
  if (s >= 300) return 'muted';
  return 'good';
};

export const delta = (current, previous) => {
  if (!previous) return null;
  return (current - previous) / previous;
};
