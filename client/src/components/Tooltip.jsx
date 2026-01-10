import { useState } from 'react';
import { HelpCircle } from 'lucide-react';

export function Tooltip({ text, children }) {
  const [show, setShow] = useState(false);

  return (
    <span 
      className="tooltip-wrapper"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children || <HelpCircle size={14} className="tooltip-icon" />}
      {show && (
        <span className="tooltip-content">
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
