import { getAllSources } from '../../sources';
import { MARKETPLACE_TYPES as TYPES } from '../../constants/marketplaceTypes';

const SOURCES = getAllSources()
  .filter((s) => s.id !== 'mal')
  .map((s) => ({ id: s.id, label: s.label }));

/**
 * MarketplaceFacets — source/type facet controls for marketplace search.
 *
 * Selecting a facet toggles it on; selecting it again clears it. Source and
 * type are single-select (one active value or undefined). Any change reports
 * the full next facet selection via `onChange`. (Requirement 6.2 — facets filter)
 *
 * Props:
 *   - source: string|undefined   currently selected source facet
 *   - type: string|undefined     currently selected type facet
 *   - onChange: ({ source, type }) => void
 *
 * Requirements: 6.1, 6.2
 */
export function MarketplaceFacets({ source, type, onChange }) {
  const activeSources = Array.isArray(source) ? source : [];
  const emit = (next) => onChange?.({ source: activeSources, type, ...next });

  const toggleSource = (id) => {
    if (activeSources.includes(id)) {
      emit({ source: activeSources.filter((s) => s !== id) });
      return;
    }
    emit({ source: [...activeSources, id] });
  };
  const toggleType = (id) => emit({ type: type === id ? undefined : id });

  return (
    <div className="marketplace-facets">
      {/* Source facets */}
      <div className="filter-group">
        <span className="filter-label">Source</span>
        <div className="source-selector">
          <button
            type="button"
            className={`source-pill ${activeSources.length === 0 ? 'active' : ''}`}
            onClick={() => emit({ source: [] })}
            aria-pressed={activeSources.length === 0}
            title="Search across all sources"
          >
            All sources
          </button>
          {SOURCES.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`source-pill ${activeSources.includes(s.id) ? 'active' : ''}`}
              onClick={() => toggleSource(s.id)}
              aria-pressed={activeSources.includes(s.id)}
            >
              <span className={`source-dot ${s.id}`} />
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Type facets */}
      <div className="filter-group" style={{ marginTop: '16px' }}>
        <span className="filter-label">Type</span>
        <div
          className="content-type-toggle marketplace-type-toggle"
          style={{ marginBottom: 0, flexWrap: 'wrap' }}
        >
          {TYPES.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`type-btn ${type === t.id ? 'active' : ''}`}
              onClick={() => toggleType(t.id)}
              aria-pressed={type === t.id}
              aria-label={t.label}
              title={t.label}
            >
              <t.Icon size={16} />
              <span className="marketplace-type-label">{t.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
