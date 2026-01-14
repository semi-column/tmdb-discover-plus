import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';

export function SearchableSelect({ 
  options = [], 
  value, 
  onChange, 
  placeholder = 'Select...', 
  searchPlaceholder = 'Search...',
  emptyMessage = 'No options found',
  labelKey = 'name',
  valueKey = 'code',
  allowClear = true
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  // Find selected option label
  const selectedOption = options.find(opt => opt[valueKey] === value);
  const displayValue = selectedOption ? selectedOption[labelKey] : '';

  // Filter options based on search
  const filteredOptions = options.filter(opt => 
    opt[labelKey]?.toLowerCase().includes(search.toLowerCase())
  );

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

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const handleSelect = (optionValue) => {
    onChange(optionValue);
    setIsOpen(false);
    setSearch('');
  };

  const handleClear = (e) => {
    e.stopPropagation();
    onChange('');
    setSearch('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
      setSearch('');
    } else if (e.key === 'Enter' && filteredOptions.length === 1) {
      handleSelect(filteredOptions[0][valueKey]);
    }
  };

  return (
    <div className={`searchable-select ${isOpen ? 'open' : ''}`} ref={containerRef}>
      <div 
        className={`searchable-select-trigger ${isOpen ? 'open' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        role="combobox"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && setIsOpen(!isOpen)}
      >
        <span className={displayValue ? '' : 'placeholder'}>
          {displayValue || placeholder}
        </span>
        <div className="searchable-select-icons">
          {allowClear && value && (
            <button 
              className="searchable-select-clear"
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
        <div className="searchable-select-dropdown">
          <div className="searchable-select-search">
            <Search size={14} />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={searchPlaceholder}
              className="searchable-select-input"
            />
          </div>
          <div className="searchable-select-options">
            {allowClear && (
              <div
                className={`searchable-select-option ${!value ? 'selected' : ''}`}
                onClick={() => handleSelect('')}
                role="option"
                aria-selected={!value}
              >
                {placeholder}
              </div>
            )}
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option) => (
                <div
                  key={option[valueKey]}
                  className={`searchable-select-option ${value === option[valueKey] ? 'selected' : ''}`}
                  onClick={() => handleSelect(option[valueKey])}
                  role="option"
                  aria-selected={value === option[valueKey]}
                >
                  {option[labelKey]}
                </div>
              ))
            ) : (
              <div className="searchable-select-empty">
                {emptyMessage}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
