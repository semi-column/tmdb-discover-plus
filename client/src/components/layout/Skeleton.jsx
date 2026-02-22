export function Skeleton({ width, height, borderRadius, className = '', style = {} }) {
  return (
    <div
      className={`skeleton-box ${className}`}
      style={{ width, height, borderRadius, ...style }}
    />
  );
}

export function CatalogListSkeleton({ count = 4 }) {
  return (
    <div className="catalog-list">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="catalog-item skeleton-item">
          <Skeleton width={32} height={32} borderRadius="var(--radius-sm)" />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Skeleton width="70%" height={14} borderRadius={4} />
            <Skeleton width="40%" height={10} borderRadius={4} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function FilterPanelSkeleton() {
  return (
    <div className="filter-grid">
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="filter-group">
          <Skeleton width="50%" height={12} borderRadius={4} style={{ marginBottom: 8 }} />
          <Skeleton width="100%" height={42} borderRadius="var(--radius-md)" />
        </div>
      ))}
    </div>
  );
}

export function PreviewGridSkeleton({ count = 10 }) {
  return (
    <div className="preview-grid">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="preview-card">
          <Skeleton width="100%" height="100%" borderRadius="var(--radius-md)" />
        </div>
      ))}
    </div>
  );
}
