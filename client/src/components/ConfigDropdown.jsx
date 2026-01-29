import { useState, useRef, useEffect } from 'react';
import {
  ChevronDown,
  Trash2,
  Loader,
  AlertTriangle,
  FolderOpen,
  Plus,
  Film,
  Tv,
  X,
} from 'lucide-react';
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

  const {
    confirmId,
    deletingId,
    requestDelete,
    reset: resetDelete,
  } = useConfirmDelete(onDeleteConfig);

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

  const getCatalogCount = (catalogs) => {
    if (!catalogs || catalogs.length === 0) return 'Empty';
    const count = catalogs.length;
    return `${count} catalog${count !== 1 ? 's' : ''}`;
  };

  const getCatalogStats = (catalogs) => {
    if (!catalogs || catalogs.length === 0) return { movies: 0, series: 0 };
    return {
      movies: catalogs.filter((c) => c.type === 'movie').length,
      series: catalogs.filter((c) => c.type === 'series').length,
    };
  };

  const getConfigName = (config, index, isCurrentLive = false) => {
    if (isCurrentLive && currentConfigName) {
      return currentConfigName.length <= 20
        ? currentConfigName
        : currentConfigName.substring(0, 17) + '...';
    }
    if (config.configName) {
      return config.configName.length <= 20
        ? config.configName
        : config.configName.substring(0, 17) + '...';
    }
    const catalogs = isCurrentLive ? currentCatalogs : config.catalogs;
    if (catalogs && catalogs.length > 0 && catalogs[0].name) {
      const firstName = catalogs[0].name;
      if (firstName.length <= 20) {
        return firstName;
      }
      return firstName.substring(0, 17) + '...';
    }
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
                  style={{
                    opacity: confirmId === config.userId ? 0.4 : 1,
                    pointerEvents: confirmId === config.userId ? 'none' : 'auto',
                  }}
                >
                  <div className="config-dropdown-item-name">
                    <span className="config-name">{getConfigName(config, index)}</span>
                    {config.userId === currentUserId && (
                      <span className="config-dropdown-item-badge">Current</span>
                    )}
                  </div>
                  <div className="config-dropdown-item-stats">
                    {(() => {
                      const stats = getCatalogStats(config.catalogs);
                      if (stats.movies === 0 && stats.series === 0) {
                        return <span className="empty-stats">Empty</span>;
                      }
                      return (
                        <>
                          {stats.movies > 0 && (
                            <span className="stat-badge">
                              <Film size={12} /> {stats.movies}
                            </span>
                          )}
                          {stats.series > 0 && (
                            <span className="stat-badge">
                              <Tv size={12} /> {stats.series}
                            </span>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>

                <div className="config-dropdown-item-actions">
                  {confirmId === config.userId ? (
                    <div className="config-dropdown-confirm-inline">
                      <button
                        className="btn btn-icon confirm-btn-yes"
                        onClick={(e) => requestDelete(config.userId, e)}
                        disabled={deletingId === config.userId}
                        title="Confirm Delete"
                      >
                        {deletingId === config.userId ? (
                          <Loader size={14} className="animate-spin" />
                        ) : (
                          <Trash2 size={14} />
                        )}
                      </button>
                      <button
                        className="btn btn-icon confirm-btn-no"
                        onClick={(e) => {
                          e.stopPropagation();
                          resetDelete();
                        }}
                        title="Cancel"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <button
                      className="btn btn-icon config-dropdown-delete"
                      onClick={(e) => requestDelete(config.userId, e)}
                      disabled={deletingId === config.userId}
                      title="Delete configuration"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
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
