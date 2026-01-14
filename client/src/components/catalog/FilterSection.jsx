import { ChevronDown, ChevronUp } from 'lucide-react';

export function FilterSection({
    id,
    title,
    icon: Icon,
    description,
    isOpen,
    onToggle,
    badgeCount,
    children
}) {
    return (
        <div className="filter-section">
            <button className="filter-section-header" onClick={() => onToggle(id)}>
                {Icon && <Icon size={18} />}
                <div className="filter-section-title-group">
                    <h4 className="filter-section-title">{title}</h4>
                    {description && <span className="filter-section-desc">{description}</span>}
                </div>
                {badgeCount > 0 && (
                    <span className="filter-count-badge">{badgeCount}</span>
                )}
                {isOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>
            {isOpen && (
                <div className="filter-section-content">
                    {children}
                </div>
            )}
        </div>
    );
}
