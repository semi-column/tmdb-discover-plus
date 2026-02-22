import { useState } from 'react';
import { X, Film, Tv, Award, Square, CheckSquare } from 'lucide-react';
import { useModalA11y } from '../../hooks/useModalA11y';

export function ExportSelectModal({
  isOpen,
  catalogs,
  configName,
  preferences,
  onClose,
  onConfirm,
}) {
  const safeCatalogs = Array.isArray(catalogs) ? catalogs : [];
  const [selected, setSelected] = useState(() => new Set(safeCatalogs.map((_, i) => i)));
  const [exportPrefs, setExportPrefs] = useState(true);
  const [exportName, setExportName] = useState(true);
  const modalRef = useModalA11y(isOpen, onClose);

  if (!isOpen) return null;

  const allSelected = selected.size === safeCatalogs.length;

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(safeCatalogs.map((_, i) => i)));
    }
  };

  const toggle = (index) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const handleConfirm = () => {
    const exportData = {
      exportedAt: new Date().toISOString(),
    };
    if (exportName && configName) exportData.configName = configName;
    if (exportPrefs && preferences) exportData.preferences = preferences;
    exportData.catalogs = safeCatalogs.filter((_, i) => selected.has(i));
    onConfirm(exportData);
  };

  const getSourceIcon = (catalog) => {
    if (catalog.source === 'imdb') return <Award size={14} className="text-imdb" />;
    return null;
  };

  const getTypeIcon = (catalog) => {
    if (catalog.type === 'series') return <Tv size={14} />;
    return <Film size={14} />;
  };

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      role="presentation"
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        className="modal"
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label="Select Catalogs to Export"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        style={{ maxWidth: '520px' }}
      >
        <div className="modal-header" style={{ paddingBottom: '8px' }}>
          <div>
            <h3 className="modal-title">Export Configuration</h3>
            <p className="text-secondary" style={{ fontSize: '13px', marginTop: '4px' }}>
              Select which catalogs to export ({selected.size} of {safeCatalogs.length} selected)
            </p>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="modal-body" style={{ padding: '0' }}>
          {safeCatalogs.length > 0 && (
            <>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 16px',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={toggleAll}
                  style={{ gap: '6px', fontSize: '13px' }}
                >
                  {allSelected ? <CheckSquare size={14} /> : <Square size={14} />}
                  {allSelected ? 'Deselect All' : 'Select All'}
                </button>
              </div>

              <div style={{ maxHeight: '320px', overflowY: 'auto' }}>
                {safeCatalogs.map((catalog, index) => (
                  <label
                    key={index}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '10px 16px',
                      cursor: 'pointer',
                      borderBottom: '1px solid var(--border)',
                      background: selected.has(index) ? 'var(--bg-tertiary)' : 'transparent',
                      transition: 'background 0.15s',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(index)}
                      onChange={() => toggle(index)}
                      style={{ display: 'none' }}
                    />
                    <span
                      style={{
                        color: selected.has(index) ? 'var(--primary)' : 'var(--text-tertiary)',
                      }}
                    >
                      {selected.has(index) ? <CheckSquare size={16} /> : <Square size={16} />}
                    </span>
                    <span
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        flex: 1,
                        minWidth: 0,
                      }}
                    >
                      {getTypeIcon(catalog)}
                      {getSourceIcon(catalog)}
                      <span
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          fontSize: '14px',
                        }}
                      >
                        {catalog.name || 'Untitled'}
                      </span>
                    </span>
                    <span className="text-secondary" style={{ fontSize: '12px', flexShrink: 0 }}>
                      {catalog.type === 'series' ? 'TV' : 'Movie'}
                      {catalog.source === 'imdb' ? ' · IMDb' : ''}
                    </span>
                  </label>
                ))}
              </div>
            </>
          )}

          {safeCatalogs.length === 0 && (
            <div style={{ padding: '24px 16px', textAlign: 'center' }} className="text-secondary">
              No catalogs to export
            </div>
          )}

          <div
            style={{
              padding: '12px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              borderTop: safeCatalogs.length > 0 ? '1px solid var(--border)' : 'none',
            }}
          >
            {preferences && (
              <label className="sidebar-checkbox" style={{ cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={exportPrefs}
                  onChange={(e) => setExportPrefs(e.target.checked)}
                />
                <span>Include preferences (shuffle, search, etc.)</span>
              </label>
            )}
            {configName && (
              <label className="sidebar-checkbox" style={{ cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={exportName}
                  onChange={(e) => setExportName(e.target.checked)}
                />
                <span>Include config name: &ldquo;{configName}&rdquo;</span>
              </label>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleConfirm}
            disabled={selected.size === 0 && !exportPrefs && !exportName}
          >
            Export{' '}
            {selected.size > 0 ? `${selected.size} Catalog${selected.size !== 1 ? 's' : ''}` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
