import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, X } from 'lucide-react';

export function MultiSelect({ 
  options = [], 
  value = [], 
  onChange, 
  placeholder = 'Select...',
  labelKey = 'label',
  valueKey = 'value',
  showImages = false,
  imageKey = 'image',
  maxDisplay = 3
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleToggle = (optionValue) => {
    const newValue = value.includes(optionValue)
      ? value.filter(v => v !== optionValue)
      : [...value, optionValue];
    onChange(newValue);
  };

  const handleClear = (e) => {
    e.stopPropagation();
    onChange([]);
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
          <div className="multi-select-options">
            {options.map((option) => {
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
