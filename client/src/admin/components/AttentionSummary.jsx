import { AlertTriangle, ArrowRight, CheckCircle2, Clock3, FileWarning } from 'lucide-react';
import { navigate } from '../hooks.js';
import { fmtInt, fmtMs } from '../format.js';

export function AttentionSummary({ totals, range, slowMs = 1500 }) {
  const signals = [
    {
      label: 'Failed HTTP responses',
      count: totals.errors5xx,
      tone: 'bad',
      icon: AlertTriangle,
      detail: 'Server returned 5xx. Investigate these responses first.',
      page: 'requests',
      filters: { status: '5xx' },
    },
    {
      label: 'Rejected HTTP responses',
      count: totals.errors4xx,
      tone: 'warn',
      icon: AlertTriangle,
      detail: '4xx may be invalid config, missing routes or rate limits. Inspect route and client.',
      page: 'requests',
      filters: { status: '4xx' },
    },
    {
      label: 'Slow responses',
      count: totals.slow,
      tone: 'warn',
      icon: Clock3,
      detail: `Responses taking ${fmtMs(slowMs)} or longer.`,
      page: 'requests',
      filters: { minMs: slowMs },
    },
    {
      label: 'Application logs',
      count: (totals.logErrors || 0) + (totals.logWarnings || 0),
      tone: 'muted',
      icon: FileWarning,
      detail: 'Warnings and errors may be recovered or internal. HTTP impact is not established.',
      page: 'errors',
      filters: { status: 'all' },
    },
  ];
  return (
    <section
      className={`adm-attention ${totals.errors5xx || totals.errors4xx ? 'is-alert' : ''}`}
      aria-label="Attention summary"
    >
      <div className="adm-attention-heading">
        {totals.errors5xx || totals.errors4xx ? (
          <AlertTriangle size={20} />
        ) : (
          <CheckCircle2 size={20} />
        )}
        <div>
          <h2>
            {totals.errors5xx
              ? 'Failed responses need attention'
              : totals.errors4xx
                ? 'Rejected responses need investigation'
                : totals.requests
                  ? 'No HTTP 5xx recorded'
                  : 'No requests recorded'}
          </h2>
          <p>HTTP status alone does not confirm that catalog or metadata results were complete.</p>
        </div>
      </div>
      <div className="adm-signal-list">
        {signals.map(({ label, count, tone, icon: Icon, detail, page, filters }) => (
          <button
            key={label}
            type="button"
            className={`adm-signal adm-tone-${count ? tone : 'muted'}`}
            onClick={() => navigate(page, { range, ...filters })}
          >
            <Icon size={18} aria-hidden="true" />
            <span>
              <strong>{label}</strong>
              <small>{detail}</small>
            </span>
            <b>{fmtInt(count || 0)}</b>
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        ))}
      </div>
    </section>
  );
}
