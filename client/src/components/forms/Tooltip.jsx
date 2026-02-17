import { useState, useId } from 'react';
import { HelpCircle } from 'lucide-react';

export function Tooltip({ text, children }) {
  const [show, setShow] = useState(false);
  const tooltipId = useId();

  return (
    <span
      className="tooltip-wrapper"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onFocus={() => setShow(true)}
      onBlur={() => setShow(false)}
      tabIndex={0}
      role="button"
      aria-describedby={show ? tooltipId : undefined}
    >
      {children || <HelpCircle size={14} className="tooltip-icon" />}
      {show && (
        <span className="tooltip-content" role="tooltip" id={tooltipId}>
          {text}
          <span className="tooltip-arrow" />
        </span>
      )}
    </span>
  );
}

export function LabelWithTooltip({ label, tooltip, required = false }) {
  return (
    <label className="filter-label label-with-tooltip">
      <span className="label-text">
        {label}
        {required && <span className="required-mark">*</span>}
      </span>
      {tooltip && <Tooltip text={tooltip} />}
    </label>
  );
}
