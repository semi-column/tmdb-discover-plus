import { useState, useEffect, useCallback } from 'react';
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
  showInputs = false,
}) {
  const [localValue, setLocalValue] = useState(value);
  
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

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
          <span className="range-slider-value">
            {formatValue(localValue[0])} — {formatValue(localValue[1])}
          </span>
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

      {showInputs && (
        <div className="range-slider-inputs">
          <input
            type="number"
            min={min}
            max={localValue[1]}
            step={step}
            value={localValue[0]}
            onChange={(e) => handleMinChange(Number(e.target.value))}
            className="range-slider-input"
          />
          <span className="range-slider-separator">to</span>
          <input
            type="number"
            min={localValue[0]}
            max={max}
            step={step}
            value={localValue[1]}
            onChange={(e) => handleMaxChange(Number(e.target.value))}
            className="range-slider-input"
          />
        </div>
      )}
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
}) {
  const [localValue, setLocalValue] = useState(value);
  
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

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
          <span className="range-slider-value">{formatValue(localValue)}</span>
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
