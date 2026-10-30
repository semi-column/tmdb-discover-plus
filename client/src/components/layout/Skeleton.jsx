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

export function MobileBuilderSkeleton() {
  return (
    <section
      className="mobile-builder-skeleton"
      aria-busy="true"
      aria-label="Loading catalog workspace"
    >
      <span className="mobile-loading-status" role="status">
        Loading catalog workspace...
      </span>
      <div aria-hidden="true">
        <div className="builder-toolbar">
          <div className="actions-toolbar">
            <Skeleton width={44} height={44} borderRadius={6} className="mobile-loading-focus" />
            <div className="config-dropdown">
              <Skeleton width="100%" height={44} borderRadius={6} />
            </div>
          </div>
        </div>
        <div className="mobile-workspace-navigation">
          <Skeleton width="100%" height={48} borderRadius={6} />
          <Skeleton width={44} height={48} borderRadius={6} />
          <Skeleton width={44} height={48} borderRadius={6} />
        </div>
        <div className="editor-panel">
          <div className="editor-header mobile-loading-editor-header">
            <Skeleton width={36} height={36} borderRadius={6} />
            <div>
              <Skeleton width="70%" height={18} borderRadius={4} />
              <Skeleton width="40%" height={12} borderRadius={4} />
            </div>
          </div>
          <div className="editor-content">
            <div className="content-type-toggle">
              {[0, 1, 2].map((key) => (
                <Skeleton key={key} width="100%" height={44} borderRadius={4} />
              ))}
            </div>
            <FilterPanelSkeleton />
          </div>
        </div>
        <div className="mobile-editor-actions">
          <Skeleton width="100%" height={46} borderRadius={6} />
          <Skeleton width="100%" height={46} borderRadius={6} />
        </div>
      </div>
    </section>
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
