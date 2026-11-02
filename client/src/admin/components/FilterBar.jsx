import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { fmtInt } from '../format.js';
import {
  DIMENSIONS,
  EXTRA_FILTERS,
  NOISE_ROUTES,
  addFilter,
  hidesNoise,
  notKey,
  splitList,
  withNoiseHidden,
} from '../filters.js';

function Chip({ children, onRemove, label }) {
  return (
    <button
      type="button"
      className="adm-filter-chip"
      onClick={onRemove}
      title={`Remove filter: ${label}`}
      aria-label={`Remove filter: ${label}`}
    >
      {children}
      <X size={12} aria-hidden="true" />
    </button>
  );
}

function FilterEditor({ facets, onApply, onCancel }) {
  const [field, setField] = useState(DIMENSIONS[0].key);
  const [exclude, setExclude] = useState(false);
  const [value, setValue] = useState('');
  const dimension = DIMENSIONS.find((d) => d.key === field);
  const extra = EXTRA_FILTERS.find((f) => f.key === field);
  const options = dimension?.facet
    ? (facets?.[dimension.facet] || []).map((o) => ({ value: o.value, count: o.count }))
    : (dimension?.options || []).map((o) => ({ value: o }));

  return (
    <form
      className="adm-filter-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (extra?.type === 'flag') return onApply({ [field]: 'true' });
        if (!value.trim()) return undefined;
        onApply(dimension ? { field, value: value.trim(), exclude } : { [field]: value.trim() });
      }}
    >
      <select
        aria-label="Filter field"
        value={field}
        onChange={(e) => {
          setField(e.target.value);
          setValue('');
        }}
      >
        <optgroup label="Dimensions">
          {DIMENSIONS.map((d) => (
            <option key={d.key} value={d.key}>
              {d.label}
            </option>
          ))}
        </optgroup>
        <optgroup label="Other">
          {EXTRA_FILTERS.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </optgroup>
      </select>
      {dimension && (
        <select
          aria-label="Filter operator"
          value={exclude ? 'not' : 'is'}
          onChange={(e) => setExclude(e.target.value === 'not')}
        >
          <option value="is">is</option>
          <option value="not">is not</option>
        </select>
      )}
      {dimension && options.length > 0 ? (
        <select aria-label="Filter value" value={value} onChange={(e) => setValue(e.target.value)}>
          <option value="">Choose…</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.value || '(none)'}
              {o.count !== undefined ? ` · ${fmtInt(o.count)}` : ''}
            </option>
          ))}
        </select>
      ) : (
        extra?.type !== 'flag' && (
          <input
            aria-label="Filter value"
            type={extra?.type === 'number' ? 'number' : 'text'}
            min={extra?.type === 'number' ? 0 : undefined}
            placeholder={extra?.placeholder || 'Value'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        )
      )}
      <button type="submit" className="adm-btn adm-btn-primary">
        Apply
      </button>
      <button type="button" className="adm-btn" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}

/** Shared include/exclude filter chips; `onChange` receives the full next filter object. */
export function FilterBar({ filters, facets, onChange }) {
  const [editing, setEditing] = useState(false);
  const noiseHidden = hidesNoise(filters);
  const remove = (patch) => onChange({ ...filters, ...patch });
  const chips = [];

  for (const d of DIMENSIONS) {
    if (filters[d.key]) {
      const label = `${d.label} is ${filters[d.key]}`;
      chips.push(
        <Chip key={d.key} label={label} onRemove={() => remove({ [d.key]: undefined })}>
          <span className="adm-chip-field">{d.label}</span> is{' '}
          <span className={d.mono ? 'mono' : ''}>{filters[d.key]}</span>
        </Chip>
      );
    }
    const excluded = splitList(filters[notKey(d.key)]).filter(
      (value) => !(d.key === 'route' && noiseHidden && NOISE_ROUTES.includes(value))
    );
    for (const value of excluded) {
      const label = `${d.label} is not ${value}`;
      chips.push(
        <Chip
          key={`${d.key}!${value}`}
          label={label}
          onRemove={() =>
            remove({
              [notKey(d.key)]:
                splitList(filters[notKey(d.key)])
                  .filter((v) => v !== value)
                  .join(',') || undefined,
            })
          }
        >
          <span className="adm-chip-field">{d.label}</span>{' '}
          <span className="adm-chip-not">is not</span>{' '}
          <span className={d.mono ? 'mono' : ''}>{value}</span>
        </Chip>
      );
    }
  }
  for (const f of EXTRA_FILTERS) {
    if (!filters[f.key]) continue;
    const label = f.type === 'flag' ? f.label : `${f.label} ${filters[f.key]}`;
    chips.push(
      <Chip key={f.key} label={label} onRemove={() => remove({ [f.key]: undefined })}>
        {label}
      </Chip>
    );
  }

  return (
    <div className="adm-filterbar" aria-label="Request filters">
      <div className="adm-filterbar-row">
        <label className="adm-switch" title={NOISE_ROUTES.join('\n')}>
          <input
            type="checkbox"
            checked={noiseHidden}
            onChange={(e) => onChange(withNoiseHidden(filters, e.target.checked))}
          />
          <span>Hide config-less &amp; unmatched</span>
        </label>
        {chips}
        {!editing && (
          <button type="button" className="adm-btn adm-btn-ghost" onClick={() => setEditing(true)}>
            <Plus size={14} aria-hidden="true" /> Add filter
          </button>
        )}
        {chips.length > 0 && (
          <button
            type="button"
            className="adm-link adm-filterbar-clear"
            onClick={() => onChange(withNoiseHidden({}, noiseHidden))}
          >
            Clear filters
          </button>
        )}
      </div>
      {editing && (
        <FilterEditor
          facets={facets}
          onCancel={() => setEditing(false)}
          onApply={(result) => {
            setEditing(false);
            onChange(
              result.field
                ? addFilter(filters, result.field, result.value, result.exclude)
                : { ...filters, ...result }
            );
          }}
        />
      )}
    </div>
  );
}
