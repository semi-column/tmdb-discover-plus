import { useState, useRef, useEffect, memo } from 'react';
import { ChevronDown, Check, X, Search } from 'lucide-react';

export const MultiSelect = memo(function MultiSelect({
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
  hideUnselected = false,
  disabled = false,
}) {
  const safeOptions = Array.isArray(options) ? options : [];
  const safeValue = Array.isArray(value) ? value : [];
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const containerRef = useRef(null);
  const optionsRef = useRef(null);
  const searchRequestIdRef = useRef(0);

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

  useEffect(() => {
    if (!isOpen) setFocusedIndex(-1);
  }, [isOpen]);

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
        if (searchRequestIdRef.current === requestId) {
          setIsSearching(false);
        }
      }
    }, searchDebounceMs);

    return () => clearTimeout(t);
  }, [isOpen, onSearch, search, minSearchLength, searchDebounceMs]);

  const handleToggle = (optionValue) => {
    const newValue = safeValue.includes(optionValue)
      ? safeValue.filter((v) => v !== optionValue)
      : [...safeValue, optionValue];
    onChange(newValue);
  };

  const handleClear = (e) => {
    e.stopPropagation();
    onChange([]);
    setSearch('');
  };

  const getSelectedLabels = () => {
    const selected = safeOptions.filter((opt) => safeValue.includes(opt[valueKey]));
    if (selected.length === 0) return null;
    if (selected.length <= maxDisplay) {
      return selected.map((s) => s[labelKey]).join(', ');
    }
    return `${selected.length} selected`;
  };

  const displayText = getSelectedLabels();

  const isSearchEnabled = Boolean(searchPlaceholder || onSearch);
  const normalizedSearch = String(search || '').toLowerCase();
  const filteredOptions =
    isSearchEnabled && normalizedSearch
      ? safeOptions.filter(
          (opt) =>
            safeValue.includes(opt[valueKey]) ||
            String(opt?.[labelKey] || '')
              .toLowerCase()
              .includes(normalizedSearch)
        )
      : hideUnselected && Array.isArray(safeValue) && safeValue.length > 0
        ? safeOptions.filter((opt) => safeValue.includes(opt[valueKey]))
        : safeOptions;

  const handleDropdownKeyDown = (e) => {
    if (!isOpen || isSearching) return;
    const count = filteredOptions.length;
    if (count === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusedIndex((prev) => (prev + 1) % count);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusedIndex((prev) => (prev <= 0 ? count - 1 : prev - 1));
        break;
      case 'Home':
        e.preventDefault();
        setFocusedIndex(0);
        break;
      case 'End':
        e.preventDefault();
        setFocusedIndex(count - 1);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (focusedIndex >= 0 && focusedIndex < count) {
          handleToggle(filteredOptions[focusedIndex][valueKey]);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        setSearch('');
        break;
      default:
        break;
    }
  };

  useEffect(() => {
    if (focusedIndex >= 0 && optionsRef.current) {
      const el = optionsRef.current.children[focusedIndex];
      if (el) el.scrollIntoView({ block: 'nearest' });
    }
  }, [focusedIndex]);

  return (
    <div
      className={`multi-select ${isOpen ? 'open' : ''} ${disabled ? 'disabled' : ''}`}
      ref={containerRef}
      onKeyDown={handleDropdownKeyDown}
    >
      <div
        className={`multi-select-trigger ${isOpen ? 'open' : ''} ${disabled ? 'disabled' : ''}`}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        role="combobox"
        aria-expanded={isOpen}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        onKeyDown={(e) => !disabled && e.key === 'Enter' && setIsOpen(!isOpen)}
      >
        <span className={displayText ? '' : 'placeholder'}>{displayText || placeholder}</span>
        <div className="multi-select-icons">
          {safeValue.length > 0 && !disabled && (
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

      {isOpen && !disabled && (
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
          <div className="multi-select-options" ref={optionsRef} role="listbox">
            {isSearchEnabled && isSearching && <div className="multi-select-empty">Searching…</div>}
            {!isSearching && filteredOptions.length === 0 && (
              <div className="multi-select-empty">{emptyMessage}</div>
            )}
            {!isSearching &&
              filteredOptions.map((option, index) => {
                const isSelected = safeValue.includes(option[valueKey]);
                const isFocused = index === focusedIndex;
                return (
                  <div
                    key={option[valueKey]}
                    className={`multi-select-option ${isSelected ? 'selected' : ''} ${isFocused ? 'focused' : ''}`}
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
});
