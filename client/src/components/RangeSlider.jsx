import { useState, useEffect, useCallback, useRef } from 'react';
import { Tooltip } from './Tooltip';

export function RangeSlider({
  min = 0,
  max = 100,
  step = 1,
  value = [min, max],
  onChange,
  label,
  tooltip,
  formatValue = (v) => v,
  // When true, the value pill becomes editable (click to type exact values)
  showInputs = false,
}) {
  const [localValue, setLocalValue] = useState(value);
  const [editing, setEditing] = useState(false);
  const minInputRef = useRef(null);
  
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  useEffect(() => {
    if (!showInputs) {
      setEditing(false);
      return;
    }
    if (editing) {
      // Focus first input when entering edit mode
      queueMicrotask(() => {
        try {
          minInputRef.current?.focus();
          minInputRef.current?.select?.();
        } catch {
          // ignore
        }
      });
    }
  }, [editing, showInputs]);

  const handleMinChange = useCallback((newMin) => {
    const clampedMin = Math.min(Math.max(min, newMin), localValue[1]);
    const newValue = [clampedMin, localValue[1]];
    setLocalValue(newValue);
    onChange?.(newValue);
  }, [min, localValue, onChange]);

  const handleMaxChange = useCallback((newMax) => {
    const clampedMax = Math.max(Math.min(max, newMax), localValue[0]);
    const newValue = [localValue[0], clampedMax];
    setLocalValue(newValue);
    onChange?.(newValue);
  }, [max, localValue, onChange]);

  const getPercent = (val) => ((val - min) / (max - min)) * 100;

  const minPercent = getPercent(localValue[0]);
  const maxPercent = getPercent(localValue[1]);

  return (
    <div className="range-slider">
      {label && (
        <div className="range-slider-header">
          <span className="range-slider-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {label}
            {tooltip && <Tooltip text={tooltip} />}
          </span>
          {showInputs ? (
            <div
              className={`range-slider-value editable ${editing ? 'editing' : ''}`}
              role="button"
              tabIndex={0}
              title="Click to edit"
              onClick={() => setEditing(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setEditing(true);
                if (e.key === 'Escape') setEditing(false);
              }}
              onBlurCapture={(e) => {
                // close edit mode when focus leaves the value container
                if (editing && !e.currentTarget.contains(e.relatedTarget)) {
                  setEditing(false);
                }
              }}
            >
              {editing ? (
                <div className="range-slider-value-edit">
                  <input
                    ref={minInputRef}
                    type="number"
                    min={min}
                    max={localValue[1]}
                    step={step}
                    value={localValue[0]}
                    onChange={(e) => handleMinChange(Number(e.target.value))}
                    className="range-slider-value-input"
                  />
                  <span className="range-slider-separator">to</span>
                  <input
                    type="number"
                    min={localValue[0]}
                    max={max}
                    step={step}
                    value={localValue[1]}
                    onChange={(e) => handleMaxChange(Number(e.target.value))}
                    className="range-slider-value-input"
                  />
                </div>
              ) : (
                <span>
                  {formatValue(localValue[0])} — {formatValue(localValue[1])}
                </span>
              )}
            </div>
          ) : (
            <span className="range-slider-value">
              {formatValue(localValue[0])} — {formatValue(localValue[1])}
            </span>
          )}
        </div>
      )}
      
      <div className="range-slider-track-container">
        <div className="range-slider-track">
          <div 
            className="range-slider-range"
            style={{
              left: `${minPercent}%`,
              width: `${maxPercent - minPercent}%`
            }}
          />
        </div>
        
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={localValue[0]}
          onChange={(e) => handleMinChange(Number(e.target.value))}
          className="range-slider-thumb range-slider-thumb-min"
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={localValue[1]}
          onChange={(e) => handleMaxChange(Number(e.target.value))}
          className="range-slider-thumb range-slider-thumb-max"
        />
      </div>

    </div>
  );
}

export function SingleSlider({
  min = 0,
  max = 100,
  step = 1,
  value = min,
  onChange,
  label,
  tooltip,
  formatValue = (v) => v,
  // When true, the value pill becomes editable (click to type an exact value)
  showInput = false,
}) {
  const [localValue, setLocalValue] = useState(value);
  const [editing, setEditing] = useState(false);
  const inputRef = useRef(null);
  
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  useEffect(() => {
    if (!showInput) {
      setEditing(false);
      return;
    }
    if (editing) {
      queueMicrotask(() => {
        try {
          inputRef.current?.focus();
          inputRef.current?.select?.();
        } catch {
          // ignore
        }
      });
    }
  }, [editing, showInput]);

  const handleChange = (newValue) => {
    const clamped = Math.min(Math.max(min, newValue), max);
    setLocalValue(clamped);
    onChange?.(clamped);
  };

  const percent = ((localValue - min) / (max - min)) * 100;

  return (
    <div className="range-slider">
      {label && (
        <div className="range-slider-header">
          <span className="range-slider-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {label}
            {tooltip && <Tooltip text={tooltip} />}
          </span>
          {showInput ? (
            <div
              className={`range-slider-value editable ${editing ? 'editing' : ''}`}
              role="button"
              tabIndex={0}
              title="Click to edit"
              onClick={() => setEditing(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setEditing(true);
                if (e.key === 'Escape') setEditing(false);
              }}
              onBlurCapture={(e) => {
                if (editing && !e.currentTarget.contains(e.relatedTarget)) {
                  setEditing(false);
                }
              }}
            >
              {editing ? (
                <input
                  ref={inputRef}
                  type="number"
                  min={min}
                  max={max}
                  step={step}
                  value={localValue}
                  onChange={(e) => handleChange(Number(e.target.value))}
                  className="range-slider-value-input"
                />
              ) : (
                <span>{formatValue(localValue)}</span>
              )}
            </div>
          ) : (
            <span className="range-slider-value">{formatValue(localValue)}</span>
          )}
        </div>
      )}
      
      <div className="range-slider-track-container single">
        <div className="range-slider-track">
          <div 
            className="range-slider-range"
            style={{ left: 0, width: `${percent}%` }}
          />
        </div>
        
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={localValue}
          onChange={(e) => handleChange(Number(e.target.value))}
          className="range-slider-thumb"
        />
      </div>

    </div>
  );
}
