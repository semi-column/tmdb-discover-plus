import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Search, X, Loader, User, Building, Tag } from 'lucide-react';
import { logger } from '../../utils/logger';

export function SearchInput({
  onSearch,
  onSelect,
  selectedItems = [],
  onRemove,
  placeholder = 'Search...',
  type = 'person',
  multiple = true,
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const dropdownRef = useRef(null);
  const [dropdownStyle, setDropdownStyle] = useState(null);
  const searchTimeoutRef = useRef(null);

  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      return;
    }

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await onSearch(query);
        setResults(data || []);
        setIsOpen(true);
      } catch (err) {
        if (err?.name !== 'AbortError') {
          logger.error('Search error:', err);
        }
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [query, onSearch]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      const target = event.target;
      if (containerRef.current && containerRef.current.contains(target)) return;
      if (dropdownRef.current && dropdownRef.current.contains(target)) return;
      setIsOpen(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const updateDropdownPosition = useCallback(() => {
    const inputEl = inputRef.current;
    if (!inputEl) return setDropdownStyle(null);
    const rect = inputEl.getBoundingClientRect();
    setDropdownStyle({
      position: 'absolute',
      left: `${rect.left}px`,
      top: `${rect.bottom + window.scrollY + 4}px`,
      width: `${rect.width}px`,
      zIndex: 100000,
    });
  }, []);

  useEffect(() => {
    if (isOpen && results.length > 0) {
      updateDropdownPosition();
      window.addEventListener('resize', updateDropdownPosition);
      window.addEventListener('scroll', updateDropdownPosition, true);
      return () => {
        window.removeEventListener('resize', updateDropdownPosition);
        window.removeEventListener('scroll', updateDropdownPosition, true);
      };
    }
    setDropdownStyle(null);
    return undefined;
  }, [isOpen, results, updateDropdownPosition]);

  const handleSelect = (item) => {
    if (multiple) {
      if (!selectedItems.find((i) => i.id === item.id)) {
        onSelect([...selectedItems, item]);
      }
    } else {
      onSelect(item);
    }
    setQuery('');
    setResults([]);
    setIsOpen(false);
  };

  const handleRemove = (itemId) => {
    if (multiple) {
      onRemove(selectedItems.filter((i) => i.id !== itemId));
    } else {
      onRemove(null);
    }
  };

  const getIcon = () => {
    switch (type) {
      case 'person':
        return <User size={14} />;
      case 'company':
        return <Building size={14} />;
      case 'keyword':
        return <Tag size={14} />;
      default:
        return <Search size={14} />;
    }
  };

  return (
    <div className="search-input-container" ref={containerRef}>
      {multiple && selectedItems.length > 0 && (
        <div className="search-input-selected">
          {selectedItems.map((item) => (
            <div key={item.id} className="search-input-tag">
              {getIcon()}
              <span>{item.name}</span>
              <button
                type="button"
                onClick={() => handleRemove(item.id)}
                className="search-input-tag-remove"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="search-input-wrapper">
        <Search size={14} className="search-input-icon" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setIsOpen(true)}
          placeholder={placeholder}
          className="search-input"
        />
        {loading && <Loader size={14} className="search-input-loader animate-spin" />}
      </div>

      {isOpen &&
        results.length > 0 &&
        dropdownStyle &&
        createPortal(
          <div className="search-input-dropdown" ref={dropdownRef} style={dropdownStyle}>
            {results.map((item) => (
              <div key={item.id} className="search-input-option" onClick={() => handleSelect(item)}>
                {item.profilePath || item.logoPath ? (
                  <img
                    src={item.profilePath || item.logoPath}
                    alt={item.name}
                    className="search-input-option-image"
                  />
                ) : (
                  <div className="search-input-option-placeholder">{getIcon()}</div>
                )}
                <div className="search-input-option-info">
                  <span className="search-input-option-name">{item.name}</span>
                  {item.knownFor && (
                    <span className="search-input-option-meta">{item.knownFor}</span>
                  )}
                </div>
              </div>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}
