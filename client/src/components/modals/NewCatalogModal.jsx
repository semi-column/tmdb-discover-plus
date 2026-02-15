import { useState } from 'react';
import { X } from 'lucide-react';
import { useModalA11y } from '../../hooks/useModalA11y';

export function NewCatalogModal({ isOpen, onClose, onAdd, imdbEnabled = false }) {
  const [name, setName] = useState('');
  const [source, setSource] = useState('tmdb');
  const [imdbListType, setImdbListType] = useState('discover');
  const [imdbListId, setImdbListId] = useState('');
  const modalRef = useModalA11y(isOpen, onClose);

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;

    if (source === 'imdb') {
      const filters = {
        listType: imdbListType,
        genres: [],
        sortBy: 'POPULARITY',
        sortOrder: 'ASC',
      };
      if (imdbListType === 'imdb_list' && imdbListId.trim()) {
        filters.imdbListId = imdbListId.trim().match(/^ls\d{1,15}$/)?.[0] || imdbListId.trim();
      }
      onAdd({
        name: name.trim(),
        type: 'movie',
        source: 'imdb',
        filters,
        enabled: true,
      });
    } else {
      onAdd({
        name: name.trim(),
        type: 'movie',
        filters: {
          listType: 'discover',
          genres: [],
          sortBy: 'popularity.desc',
          voteCountMin: 0,
        },
        enabled: true,
      });
    }

    setName('');
    setSource('tmdb');
    setImdbListType('discover');
    setImdbListId('');
    onClose();
  };

  const isImdbListValid = imdbListType !== 'imdb_list' || /^ls\d{1,15}$/.test(imdbListId.trim());

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label="Create New Catalog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3 className="modal-title">Create New Catalog</h3>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {imdbEnabled && (
              <div className="filter-group" style={{ marginBottom: '16px' }}>
                <label className="filter-label">Data Source</label>
                <div className="imdb-source-toggle">
                  <button
                    type="button"
                    className={source === 'tmdb' ? 'active-tmdb' : ''}
                    onClick={() => setSource('tmdb')}
                  >
                    TMDB
                  </button>
                  <button
                    type="button"
                    className={source === 'imdb' ? 'active-imdb' : ''}
                    onClick={() => setSource('imdb')}
                  >
                    IMDb
                  </button>
                </div>
              </div>
            )}

            <div className="filter-group">
              <label className="filter-label">Catalog Name</label>
              <input
                type="text"
                className="input"
                style={{ paddingLeft: '14px' }}
                placeholder={
                  source === 'imdb'
                    ? 'e.g., Oscar Winners, IMDb Top Rated, My Watchlist'
                    : 'e.g., Top Rated Sci-Fi, Hindi Movies, Netflix Shows'
                }
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>

            {source === 'imdb' && (
              <div className="filter-group" style={{ marginTop: '12px' }}>
                <label className="filter-label">Catalog Type</label>
                <select
                  className="imdb-list-type-select"
                  value={imdbListType}
                  onChange={(e) => setImdbListType(e.target.value)}
                >
                  <option value="discover">Discover (Advanced Search)</option>
                  <option value="top250">Top 250</option>
                  <option value="popular">Most Popular</option>
                  <option value="imdb_list">IMDb List</option>
                </select>

                {imdbListType === 'imdb_list' && (
                  <div style={{ marginTop: '8px' }}>
                    <input
                      type="text"
                      className={`imdb-list-id-input${imdbListId && !isImdbListValid ? ' field-invalid' : ''}`}
                      placeholder="IMDb list ID or URL (e.g., ls597789139)"
                      value={imdbListId}
                      onChange={(e) => setImdbListId(e.target.value)}
                    />
                    {imdbListId && !isImdbListValid && (
                      <span
                        style={{
                          fontSize: '11px',
                          color: 'var(--error)',
                          marginTop: '4px',
                          display: 'block',
                        }}
                      >
                        Enter a valid IMDb list ID (e.g., ls597789139)
                      </span>
                    )}
                  </div>
                )}

                <span className="filter-label-hint" style={{ marginTop: '8px' }}>
                  {source === 'imdb'
                    ? 'You can configure IMDb filters after creating'
                    : 'You can configure content type and filters after creating'}
                </span>
              </div>
            )}

            {source === 'tmdb' && (
              <span className="filter-label-hint" style={{ marginTop: '8px' }}>
                You can configure content type and filters after creating
              </span>
            )}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!name.trim() || !isImdbListValid}
            >
              Create Catalog
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
