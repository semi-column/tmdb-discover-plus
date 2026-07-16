import { Search, X } from 'lucide-react';

/**
 * MarketplaceSearchBar — controlled search input for the catalog marketplace.
 *
 * Mirrors the inline search the modal previously rendered: a leading search
 * icon, a controlled text input, and a clear button that resets the query.
 *
 * Props:
 *   - value: string        current query text (controlled)
 *   - onChange: (q) => void invoked with the next query string on input/clear
 *   - id: string           optional input id (for the associated label)
 *   - placeholder: string  optional placeholder text
 *
 * Requirements: 6.1 (search by catalog name)
 */
export function MarketplaceSearchBar({
  value = '',
  onChange,
  id = 'marketplace-search',
  placeholder = 'Search catalogs...',
}) {
  const handleInput = (e) => onChange?.(e.target.value);
  const handleClear = () => onChange?.('');

  const hasValue = typeof value === 'string' && value.length > 0;

  return (
    <div className="marketplace-search-bar" style={{ position: 'relative' }}>
      <Search
        size={16}
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: 10,
          top: '50%',
          transform: 'translateY(-50%)',
          opacity: 0.6,
          pointerEvents: 'none',
        }}
      />
      <input
        id={id}
        type="search"
        className="input"
        placeholder={placeholder}
        value={value}
        onChange={handleInput}
        style={{ paddingLeft: '32px', paddingRight: hasValue ? '32px' : undefined }}
      />
      {hasValue && (
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          onClick={handleClear}
          aria-label="Clear search"
          title="Clear search"
          style={{
            position: 'absolute',
            right: 4,
            top: '50%',
            transform: 'translateY(-50%)',
            height: '24px',
            width: '24px',
            minHeight: 'unset',
            padding: 0,
          }}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
