import { useState, useCallback } from 'react';
import { LabelWithTooltip } from './Tooltip';

/**
 * RangeSlider - Dual-value range selector with editable text inputs
 *
 * Key UX improvements:
 * - Stores input as STRING while editing (allows clearing/typing freely)
 * - Only converts to number and validates on blur/Enter
 * - Escape key cancels edit and restores previous value
 */
export function RangeSlider({ label, tooltip, min, max, step = 1, value = [min, max], onChange }) {
  // Extract values for dependency arrays
  const minVal = value[0];
  const maxVal = value[1];

  // Store as strings to allow free text editing (including empty)
  const [minInputValue, setMinInputValue] = useState(String(value[0]));
  const [maxInputValue, setMaxInputValue] = useState(String(value[1]));
  const [isEditingMin, setIsEditingMin] = useState(false);
  const [isEditingMax, setIsEditingMax] = useState(false);

  // Sync local state when value prop changes (but not while editing)

  // Handle min input change - store as string, allow empty
  const handleMinChange = useCallback((e) => {
    setMinInputValue(e.target.value);
  }, []);

  // Handle max input change - store as string, allow empty
  const handleMaxChange = useCallback((e) => {
    setMaxInputValue(e.target.value);
  }, []);

  // Commit min value - validate and apply
  const commitMinValue = useCallback(() => {
    setIsEditingMin(false);

    const parsed = parseFloat(minInputValue);

    // If empty or invalid, restore to current prop value
    if (minInputValue === '' || isNaN(parsed)) {
      setMinInputValue(String(value[0]));
      return;
    }

    // Clamp and round to step
    let newMin = Math.max(min, Math.min(parsed, value[1]));
    newMin = Math.round(newMin / step) * step;

    setMinInputValue(String(newMin));
    onChange([newMin, value[1]]);
  }, [minInputValue, value, min, step, onChange]);

  // Commit max value - validate and apply
  const commitMaxValue = useCallback(() => {
    setIsEditingMax(false);

    const parsed = parseFloat(maxInputValue);

    // If empty or invalid, restore to current prop value
    if (maxInputValue === '' || isNaN(parsed)) {
      setMaxInputValue(String(value[1]));
      return;
    }

    // Clamp and round to step
    let newMax = Math.min(max, Math.max(parsed, value[0]));
    newMax = Math.round(newMax / step) * step;

    setMaxInputValue(String(newMax));
    onChange([value[0], newMax]);
  }, [maxInputValue, value, max, step, onChange]);

  const handleMinKeyDown = (e) => {
    if (e.key === 'Enter') {
      commitMinValue();
      e.target.blur();
    } else if (e.key === 'Escape') {
      setMinInputValue(String(value[0]));
      setIsEditingMin(false);
      e.target.blur();
    }
  };

  const handleMaxKeyDown = (e) => {
    if (e.key === 'Enter') {
      commitMaxValue();
      e.target.blur();
    } else if (e.key === 'Escape') {
      setMaxInputValue(String(value[1]));
      setIsEditingMax(false);
      e.target.blur();
    }
  };

  // Select all text on focus for easy replacement
  const handleFocus = (e) => {
    e.target.select();
  };

  // Calculate percentages for visual track
  const minPercent = ((value[0] - min) / (max - min)) * 100;
  const maxPercent = ((value[1] - min) / (max - min)) * 100;

  return (
    <div className="range-slider">
      <div className="range-slider-header">
        {tooltip ? (
          <LabelWithTooltip label={label} tooltip={tooltip} />
        ) : (
          <span className="range-slider-label">{label}</span>
        )}
        <div className="range-slider-value-display">
          {/* Min Input */}
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*\.?[0-9]*"
            className="range-input-field"
            value={isEditingMin ? minInputValue : String(minVal)}
            onChange={handleMinChange}
            onFocus={(e) => {
              setIsEditingMin(true);
              setMinInputValue(String(minVal));
              handleFocus(e);
            }}
            onBlur={commitMinValue}
            onKeyDown={handleMinKeyDown}
          />
          <span className="range-separator">—</span>
          {/* Max Input */}
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*\.?[0-9]*"
            className="range-input-field"
            value={isEditingMax ? maxInputValue : String(maxVal)}
            onChange={handleMaxChange}
            onFocus={(e) => {
              setIsEditingMax(true);
              setMaxInputValue(String(maxVal));
              handleFocus(e);
            }}
            onBlur={commitMaxValue}
            onKeyDown={handleMaxKeyDown}
          />
        </div>
      </div>

      {/* Visual Track */}
      <div className="range-slider-track-container">
        <div className="range-slider-track">
          <div
            className="range-slider-range"
            style={{
              left: `${minPercent}%`,
              width: `${maxPercent - minPercent}%`,
            }}
          />
        </div>
        {/* Min Thumb */}
        <input
          type="range"
          className="range-slider-thumb"
          min={min}
          max={max}
          step={step}
          value={value[0]}
          onChange={(e) => {
            const newMin = Math.min(parseFloat(e.target.value), value[1] - step);
            onChange([newMin, value[1]]);
          }}
        />
        {/* Max Thumb */}
        <input
          type="range"
          className="range-slider-thumb"
          min={min}
          max={max}
          step={step}
          value={value[1]}
          onChange={(e) => {
            const newMax = Math.max(parseFloat(e.target.value), value[0] + step);
            onChange([value[0], newMax]);
          }}
        />
      </div>
    </div>
  );
}

/**
 * SingleSlider - Single-value slider with editable text input
 */
export function SingleSlider({ label, tooltip, min, max, step = 1, value = min, onChange }) {
  // Store as string to allow free text editing
  const [inputValue, setInputValue] = useState(String(value));
  const [isEditing, setIsEditing] = useState(false);

  // Sync from prop when not editing

  const handleInputChange = (e) => {
    setInputValue(e.target.value);
  };

  const commitValue = useCallback(() => {
    setIsEditing(false);

    const parsed = parseFloat(inputValue);

    // If empty or invalid, restore to current prop value
    if (inputValue === '' || isNaN(parsed)) {
      setInputValue(String(value));
      return;
    }

    // Clamp and round to step
    let newVal = Math.max(min, Math.min(max, parsed));
    newVal = Math.round(newVal / step) * step;

    setInputValue(String(newVal));
    onChange(newVal);
  }, [inputValue, value, min, max, step, onChange]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      commitValue();
      e.target.blur();
    } else if (e.key === 'Escape') {
      setInputValue(String(value));
      setIsEditing(false);
      e.target.blur();
    }
  };

  const handleFocus = (e) => {
    e.target.select();
  };

  const percent = ((value - min) / (max - min)) * 100;

  return (
    <div className="range-slider">
      <div className="range-slider-header">
        {tooltip ? (
          <LabelWithTooltip label={label} tooltip={tooltip} />
        ) : (
          <span className="range-slider-label">{label}</span>
        )}
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*\.?[0-9]*"
          className="range-input-field single"
          value={isEditing ? inputValue : String(value)}
          onChange={handleInputChange}
          onFocus={(e) => {
            setIsEditing(true);
            setInputValue(String(value));
            handleFocus(e);
          }}
          onBlur={commitValue}
          onKeyDown={handleKeyDown}
        />
      </div>

      <div className="range-slider-track-container">
        <div className="range-slider-track">
          <div className="range-slider-range" style={{ left: 0, width: `${percent}%` }} />
        </div>
        <input
          type="range"
          className="range-slider-thumb"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
        />
      </div>
    </div>
  );
}
