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
  allowClear = true,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const optionsRef = useRef(null);

  const safeOptions = Array.isArray(options) ? options : [];
  const selectedOption = safeOptions.find((opt) => opt[valueKey] === value);
  const displayValue = selectedOption ? selectedOption[labelKey] : '';

  const filteredOptions = safeOptions.filter((opt) =>
    opt[labelKey]?.toLowerCase().includes(search.toLowerCase())
  );

  const allNavOptions = allowClear ? [{ isClear: true }, ...filteredOptions] : filteredOptions;

  const handleOpenToggle = () => {
    const newIsOpen = !isOpen;
    setIsOpen(newIsOpen);
    if (newIsOpen) {
      setHighlightedIndex(-1);
    }
  };

  const handleSearchChange = (e) => {
    setSearch(e.target.value);
    setHighlightedIndex(-1);
  };

  useEffect(() => {
    if (highlightedIndex >= 0 && optionsRef.current) {
      const highlightedEl = optionsRef.current.children[highlightedIndex];
      if (highlightedEl) {
        highlightedEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [highlightedIndex]);

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
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev < allNavOptions.length - 1 ? prev + 1 : prev));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : prev));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightedIndex >= 0) {
        const option = allNavOptions[highlightedIndex];
        if (option.isClear) {
          handleSelect('');
        } else {
          handleSelect(option[valueKey]);
        }
      } else if (filteredOptions.length === 1) {
        handleSelect(filteredOptions[0][valueKey]);
      }
    }
  };

  const handleTriggerKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleOpenToggle();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        setHighlightedIndex(0);
      } else {
        setHighlightedIndex((prev) => (prev < allNavOptions.length - 1 ? prev + 1 : prev));
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        setHighlightedIndex(allNavOptions.length - 1);
      } else {
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : prev));
      }
    }
  };

  return (
    <div className={`searchable-select ${isOpen ? 'open' : ''}`} ref={containerRef}>
      <div
        className={`searchable-select-trigger ${isOpen ? 'open' : ''}`}
        onClick={handleOpenToggle}
        role="combobox"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        tabIndex={0}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className={displayValue ? '' : 'placeholder'}>{displayValue || placeholder}</span>
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
              onChange={handleSearchChange}
              onKeyDown={handleKeyDown}
              placeholder={searchPlaceholder}
              className="searchable-select-input"
            />
          </div>
          <div className="searchable-select-options" ref={optionsRef}>
            {allowClear && (
              <div
                className={`searchable-select-option ${!value ? 'selected' : ''} ${highlightedIndex === 0 ? 'highlighted' : ''}`}
                onClick={() => handleSelect('')}
                onMouseMove={() => setHighlightedIndex(0)}
                role="option"
                aria-selected={!value}
              >
                {placeholder}
              </div>
            )}
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option, index) => {
                const navIndex = allowClear ? index + 1 : index;
                return (
                  <div
                    key={option[valueKey]}
                    className={`searchable-select-option ${value === option[valueKey] ? 'selected' : ''} ${highlightedIndex === navIndex ? 'highlighted' : ''}`}
                    onClick={() => handleSelect(option[valueKey])}
                    onMouseMove={() => setHighlightedIndex(navIndex)}
                    role="option"
                    aria-selected={value === option[valueKey]}
                  >
                    {option[labelKey]}
                  </div>
                );
              })
            ) : (
              <div className="searchable-select-empty">{emptyMessage}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
