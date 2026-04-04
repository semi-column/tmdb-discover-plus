import { memo } from 'react';
import { Check } from 'lucide-react';
import { LabelWithTooltip } from './Tooltip';

export const Checkbox = memo(function Checkbox({
  checked,
  onChange,
  label,
  tooltip,
  disabled = false,
  className = '',
}) {
  const handleKeyDown = (e) => {
    if (disabled) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      onChange(!checked);
    }
  };

  return (
    <label
      className={`checkbox-label-row ${className} ${disabled ? 'disabled' : ''}`}
      style={{ cursor: disabled ? 'not-allowed' : 'pointer' }}
    >
      <div
        className={`checkbox ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}`}
        role="checkbox"
        aria-checked={!!checked}
        tabIndex={disabled ? -1 : 0}
        onClick={() => !disabled && onChange(!checked)}
        onKeyDown={handleKeyDown}
      >
        {checked && <Check size={14} />}
      </div>
      <LabelWithTooltip label={label} tooltip={tooltip} />
    </label>
  );
});
