import { memo } from 'react';
import { X } from 'lucide-react';

export const ActiveFiltersBar = memo(function ActiveFiltersBar({
  activeFilters,
  onClearFilter,
  onClearAll,
  onToggleSection,
}) {
  if (activeFilters.length === 0) return null;

  return (
    <div className="active-filters-bar">
      <div className="active-filters-chips">
        {activeFilters.map((filter) => (
          <div
            key={filter.key}
            className="active-filter-chip"
            data-section={filter.section}
            onClick={() => onToggleSection(filter.section)}
          >
            <span>{filter.label}</span>
            <button
              className="chip-remove"
              aria-label={`Remove ${filter.label} filter`}
              onClick={(e) => {
                e.stopPropagation();
                onClearFilter(filter.key);
              }}
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
      <button className="clear-all-btn" onClick={onClearAll}>
        Clear All
      </button>
    </div>
  );
});
