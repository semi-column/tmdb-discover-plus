import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, X, Search } from 'lucide-react';

export function MultiSelect({ 
  options = [], 
  value = [], 
  onChange, 
  placeholder = 'Select...',
  searchPlaceholder = null,
  emptyMessage = 'No options found',
  labelKey = 'label',
  valueKey = 'value',
  showImages = false,
  imageKey = 'image',
  maxDisplay = 3,
  onSearch,
  minSearchLength = 2,
  searchDebounceMs = 250,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const containerRef = useRef(null);
  const searchRequestIdRef = useRef(0);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
        setSearch('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Debounced remote search (optional)
  useEffect(() => {
    if (!isOpen) return;
    if (!onSearch) return;

    const q = String(search || '').trim();
    if (q.length < minSearchLength) return;

    const requestId = ++searchRequestIdRef.current;
    const t = setTimeout(async () => {
      setIsSearching(true);
      try {
        await onSearch(q);
      } finally {
        // Only clear searching state if this is the latest request
        if (searchRequestIdRef.current === requestId) {
          setIsSearching(false);
        }
      }
    }, searchDebounceMs);

    return () => clearTimeout(t);
  }, [isOpen, onSearch, search, minSearchLength, searchDebounceMs]);

  const handleToggle = (optionValue) => {
    const newValue = value.includes(optionValue)
      ? value.filter(v => v !== optionValue)
      : [...value, optionValue];
    onChange(newValue);
  };

  const handleClear = (e) => {
    e.stopPropagation();
    onChange([]);
    setSearch('');
  };

  const getSelectedLabels = () => {
    const selected = options.filter(opt => value.includes(opt[valueKey]));
    if (selected.length === 0) return null;
    if (selected.length <= maxDisplay) {
      return selected.map(s => s[labelKey]).join(', ');
    }
    return `${selected.length} selected`;
  };

  const displayText = getSelectedLabels();

  const isSearchEnabled = Boolean(searchPlaceholder || onSearch);
  const normalizedSearch = String(search || '').toLowerCase();
  const filteredOptions = isSearchEnabled && normalizedSearch
    ? options.filter(opt => String(opt?.[labelKey] || '').toLowerCase().includes(normalizedSearch))
    : options;

  return (
    <div className={`multi-select ${isOpen ? 'open' : ''}`} ref={containerRef}>
      <div 
        className={`multi-select-trigger ${isOpen ? 'open' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        role="combobox"
        aria-expanded={isOpen}
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && setIsOpen(!isOpen)}
      >
        <span className={displayText ? '' : 'placeholder'}>
          {displayText || placeholder}
        </span>
        <div className="multi-select-icons">
          {value.length > 0 && (
            <button 
              className="multi-select-clear"
              onClick={handleClear}
              type="button"
              aria-label="Clear selection"
            >
              <X size={14} />
            </button>
          )}
          <ChevronDown size={16} className={`chevron ${isOpen ? 'rotate' : ''}`} />
        </div>
      </div>

      {isOpen && (
        <div className="multi-select-dropdown">
          {isSearchEnabled && (
            <div className="multi-select-search">
              <Search size={14} />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={searchPlaceholder || 'Search...'}
                className="multi-select-input"
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setIsOpen(false);
                    setSearch('');
                  }
                }}
              />
              {search && (
                <button
                  type="button"
                  className="multi-select-search-clear"
                  onClick={() => setSearch('')}
                  aria-label="Clear search"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          )}
          <div className="multi-select-options">
            {isSearchEnabled && isSearching && (
              <div className="multi-select-empty">Searching…</div>
            )}
            {!isSearching && filteredOptions.length === 0 && (
              <div className="multi-select-empty">{emptyMessage}</div>
            )}
            {!isSearching && filteredOptions.map((option) => {
              const isSelected = value.includes(option[valueKey]);
              return (
                <div
                  key={option[valueKey]}
                  className={`multi-select-option ${isSelected ? 'selected' : ''}`}
                  onClick={() => handleToggle(option[valueKey])}
                  role="option"
                  aria-selected={isSelected}
                >
                  <div className={`multi-select-checkbox ${isSelected ? 'checked' : ''}`}>
                    {isSelected && <Check size={12} />}
                  </div>
                  {showImages && option[imageKey] && (
                    <img 
                      src={option[imageKey]} 
                      alt={option[labelKey]}
                      className="multi-select-option-image"
                    />
                  )}
                  <span>{option[labelKey]}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
