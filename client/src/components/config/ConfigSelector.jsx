import { FolderOpen, Plus, Trash2, Download, Edit3, Loader, AlertTriangle } from 'lucide-react';
import { useConfirmDelete } from '../../hooks/useConfirmDelete';

export function ConfigSelector({
  configs,
  loading,
  onSelectConfig,
  onCreateNew,
  onDeleteConfig,
  onInstallConfig,
}) {
  const { confirmId, deletingId, requestDelete } = useConfirmDelete(onDeleteConfig);

  const formatDate = (dateString) => {
    if (!dateString) return 'Unknown';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const getCatalogSummary = (catalogs) => {
    if (!catalogs || catalogs.length === 0) return 'No catalogs';
    const movieCount = catalogs.filter((c) => c.type === 'movie').length;
    const seriesCount = catalogs.filter((c) => c.type === 'series').length;
    const parts = [];
    if (movieCount > 0) parts.push(`${movieCount} movie${movieCount > 1 ? 's' : ''}`);
    if (seriesCount > 0) parts.push(`${seriesCount} series`);
    return parts.join(', ') || 'No catalogs';
  };

  if (loading) {
    return (
      <div className="config-selector">
        <div className="config-selector-header">
          <FolderOpen size={24} />
          <h3>Your Configurations</h3>
        </div>
        <div className="config-selector-loading">
          <Loader size={32} className="animate-spin" />
          <p>Loading your configurations...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="config-selector">
      <div className="config-selector-header">
        <FolderOpen size={24} />
        <h3>Your Configurations</h3>
      </div>

      <p className="config-selector-description">
        Select a configuration to edit, or create a new one.
      </p>

      {configs.length === 0 ? (
        <div className="config-selector-empty">
          <p>No configurations found for this API key.</p>
          <button className="btn btn-primary" onClick={onCreateNew}>
            <Plus size={18} />
            Create Your First Configuration
          </button>
        </div>
      ) : (
        <>
          <div className="config-list">
            {configs.map((config) => (
              <div
                key={config.userId}
                className="config-card"
                onClick={() => onSelectConfig(config.userId)}
              >
                <div className="config-card-main">
                  <div className="config-card-info">
                    <h4 className="config-card-id">
                      <code>{config.userId}</code>
                    </h4>
                    <p className="config-card-catalogs">{getCatalogSummary(config.catalogs)}</p>
                    <p className="config-card-date">Updated: {formatDate(config.updatedAt)}</p>
                  </div>

                  <div className="config-card-actions">
                    <button
                      className="btn btn-icon btn-ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectConfig(config.userId);
                      }}
                      title="Edit configuration"
                    >
                      <Edit3 size={18} />
                    </button>
                    <button
                      className="btn btn-icon btn-ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        onInstallConfig(config.userId);
                      }}
                      title="Install to Stremio"
                    >
                      <Download size={18} />
                    </button>
                    <button
                      className={`btn btn-icon ${confirmId === config.userId ? 'btn-danger' : 'btn-ghost'}`}
                      onClick={(e) => requestDelete(config.userId, e)}
                      disabled={deletingId === config.userId}
                      title={
                        confirmId === config.userId
                          ? 'Click again to confirm delete'
                          : 'Delete configuration'
                      }
                    >
                      {deletingId === config.userId ? (
                        <Loader size={18} className="animate-spin" />
                      ) : confirmId === config.userId ? (
                        <AlertTriangle size={18} />
                      ) : (
                        <Trash2 size={18} />
                      )}
                    </button>
                  </div>
                </div>

                {confirmId === config.userId && (
                  <div className="config-card-confirm">
                    <AlertTriangle size={14} />
                    <span>Click delete again to confirm</span>
                  </div>
                )}
              </div>
            ))}
          </div>

          <button className="btn btn-secondary w-full" onClick={onCreateNew}>
            <Plus size={18} />
            Create New Configuration
          </button>
        </>
      )}
    </div>
  );
}
