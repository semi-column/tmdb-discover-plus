import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Trash2, Loader, AlertTriangle, FolderOpen, Plus } from 'lucide-react';
import { useConfirmDelete } from '../hooks/useConfirmDelete';

export function ConfigDropdown({
  configs,
  currentUserId,
  currentCatalogs,
  currentConfigName,
  loading,
  onSelectConfig,
  onDeleteConfig,
  onCreateNew,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  const { confirmId, deletingId, requestDelete, reset: resetDelete } = useConfirmDelete(onDeleteConfig);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
        resetDelete();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [resetDelete]);

  // Get catalog count summary (e.g., "3 catalogs" or "1 catalog")
  const getCatalogCount = (catalogs) => {
    if (!catalogs || catalogs.length === 0) return 'Empty';
    const count = catalogs.length;
    return `${count} catalog${count !== 1 ? 's' : ''}`;
  };

  // Get detailed catalog breakdown (e.g., "2 movies, 1 series")
  const getCatalogBreakdown = (catalogs) => {
    if (!catalogs || catalogs.length === 0) return 'No catalogs';
    const movieCount = catalogs.filter((c) => c.type === 'movie').length;
    const seriesCount = catalogs.filter((c) => c.type === 'series').length;
    const parts = [];
    if (movieCount > 0) parts.push(`${movieCount} movie${movieCount > 1 ? 's' : ''}`);
    if (seriesCount > 0) parts.push(`${seriesCount} series`);
    return parts.join(', ') || 'No catalogs';
  };

  // Get friendly name for config (e.g., "Config 1", "Config 2")
  const getConfigName = (config, index, isCurrentLive = false) => {
    // For current config, use live data
    if (isCurrentLive && currentConfigName) {
      return currentConfigName.length <= 20
        ? currentConfigName
        : currentConfigName.substring(0, 17) + '...';
    }
    // Use configName if set
    if (config.configName) {
      return config.configName.length <= 20
        ? config.configName
        : config.configName.substring(0, 17) + '...';
    }
    // Fall back to first catalog name if available and meaningful
    const catalogs = isCurrentLive ? currentCatalogs : config.catalogs;
    if (catalogs && catalogs.length > 0 && catalogs[0].name) {
      const firstName = catalogs[0].name;
      if (firstName.length <= 20) {
        return firstName;
      }
      return firstName.substring(0, 17) + '...';
    }
    // Otherwise use numbered format
    return `Config ${index + 1}`;
  };

  const currentConfig = configs.find((c) => c.userId === currentUserId);
  const currentIndex = configs.findIndex((c) => c.userId === currentUserId);

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
              <span className="config-dropdown-name">
                {getConfigName(currentConfig, currentIndex, true)}
              </span>
              <span className="config-dropdown-count">
                ({getCatalogCount(currentCatalogs || currentConfig.catalogs)})
              </span>
            </>
          ) : (
            'Select Config'
          )}
        </span>
        {configs.length > 1 && (
          <span className="config-dropdown-total-badge">{configs.length}</span>
        )}
        <ChevronDown size={18} className={`config-dropdown-chevron ${isOpen ? 'rotate' : ''}`} />
      </button>

      {isOpen && (
        <div className="config-dropdown-menu">
          <div className="config-dropdown-header">
            <span>Your Configurations ({configs.length})</span>
          </div>
          <div className="config-dropdown-list">
            {configs.map((config, index) => (
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
                  <div className="config-dropdown-item-name">
                    <span className="config-name">{getConfigName(config, index)}</span>
                    {config.userId === currentUserId && (
                      <span className="config-dropdown-item-badge">Current</span>
                    )}
                  </div>
                  <div className="config-dropdown-item-meta">
                    {getCatalogBreakdown(config.catalogs)}
                  </div>
                </div>

                <button
                  className={`btn btn-icon config-dropdown-delete ${confirmId === config.userId ? 'btn-danger-active' : ''}`}
                  onClick={(e) => requestDelete(config.userId, e)}
                  disabled={deletingId === config.userId}
                  title={
                    confirmId === config.userId
                      ? 'Click again to confirm delete'
                      : 'Delete configuration'
                  }
                >
                  {deletingId === config.userId ? (
                    <Loader size={16} className="animate-spin" />
                  ) : confirmId === config.userId ? (
                    <AlertTriangle size={16} />
                  ) : (
                    <Trash2 size={16} />
                  )}
                </button>

                {confirmId === config.userId && (
                  <div className="config-dropdown-confirm-tooltip">Click again to confirm</div>
                )}
              </div>
            ))}
          </div>
          {onCreateNew && (
            <div className="config-dropdown-footer">
              <button
                className="btn btn-secondary config-dropdown-new"
                onClick={() => {
                  setIsOpen(false);
                  onCreateNew();
                }}
              >
                <Plus size={16} />
                <span>New Configuration</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
