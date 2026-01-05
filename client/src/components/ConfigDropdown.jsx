import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Trash2, Loader, AlertTriangle, FolderOpen } from 'lucide-react';

export function ConfigDropdown({ 
  configs, 
  currentUserId, 
  loading,
  onSelectConfig, 
  onDeleteConfig 
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const dropdownRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
        setConfirmDelete(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleDelete = async (e, userId) => {
    e.stopPropagation();
    
    if (confirmDelete === userId) {
      // Confirmed, perform delete
      setDeleting(userId);
      try {
        await onDeleteConfig(userId);
      } finally {
        setDeleting(null);
        setConfirmDelete(null);
      }
    } else {
      // First click, ask for confirmation
      setConfirmDelete(userId);
      // Auto-clear confirmation after 3 seconds
      setTimeout(() => setConfirmDelete(null), 3000);
    }
  };

  const getCatalogSummary = (catalogs) => {
    if (!catalogs || catalogs.length === 0) return 'No catalogs';
    const movieCount = catalogs.filter(c => c.type === 'movie').length;
    const seriesCount = catalogs.filter(c => c.type === 'series').length;
    const parts = [];
    if (movieCount > 0) parts.push(`${movieCount} movie${movieCount > 1 ? 's' : ''}`);
    if (seriesCount > 0) parts.push(`${seriesCount} series`);
    return parts.join(', ') || 'No catalogs';
  };

  const currentConfig = configs.find(c => c.userId === currentUserId);
  const _hasMultipleConfigs = configs.length > 1;

  if (loading) {
    return (
      <div className="config-dropdown">
        <button className="btn btn-secondary config-dropdown-trigger" disabled>
          <Loader size={18} className="animate-spin" />
          Loading...
        </button>
      </div>
    );
  }

  if (configs.length === 0) {
    return null;
  }

  return (
    <div className="config-dropdown" ref={dropdownRef}>
      <button 
        className={`btn btn-secondary config-dropdown-trigger ${isOpen ? 'open' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
      >
        <FolderOpen size={18} />
        <span className="config-dropdown-current">
          {currentConfig ? (
            <>
              <span className="config-dropdown-id">{currentUserId}</span>
              <span className="config-dropdown-summary">
                ({getCatalogSummary(currentConfig.catalogs)})
              </span>
            </>
          ) : (
            'Select Config'
          )}
        </span>
        <ChevronDown size={18} className={`config-dropdown-chevron ${isOpen ? 'rotate' : ''}`} />
      </button>

      {isOpen && (
        <div className="config-dropdown-menu">
          <div className="config-dropdown-header">
            <span>Your Configurations ({configs.length})</span>
          </div>
          <div className="config-dropdown-list">
            {configs.map(config => (
              <div 
                key={config.userId}
                className={`config-dropdown-item ${config.userId === currentUserId ? 'active' : ''}`}
              >
                <div 
                  className="config-dropdown-item-content"
                  onClick={() => {
                    if (config.userId !== currentUserId) {
                      onSelectConfig(config.userId);
                    }
                    setIsOpen(false);
                  }}
                >
                  <div className="config-dropdown-item-id">
                    <code>{config.userId}</code>
                    {config.userId === currentUserId && (
                      <span className="config-dropdown-item-badge">Current</span>
                    )}
                  </div>
                  <div className="config-dropdown-item-meta">
                    {getCatalogSummary(config.catalogs)}
                  </div>
                </div>
                
                <button
                  className={`btn btn-icon config-dropdown-delete ${confirmDelete === config.userId ? 'btn-danger-active' : ''}`}
                  onClick={(e) => handleDelete(e, config.userId)}
                  disabled={deleting === config.userId}
                  title={confirmDelete === config.userId ? 'Click again to confirm delete' : 'Delete configuration'}
                >
                  {deleting === config.userId ? (
                    <Loader size={16} className="animate-spin" />
                  ) : confirmDelete === config.userId ? (
                    <AlertTriangle size={16} />
                  ) : (
                    <Trash2 size={16} />
                  )}
                </button>

                {confirmDelete === config.userId && (
                  <div className="config-dropdown-confirm-tooltip">
                    Click again to confirm
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
