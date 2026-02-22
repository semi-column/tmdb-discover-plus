import { useState } from 'react';
import { X, Film, Tv, Award } from 'lucide-react';
import { useModalA11y } from '../../hooks/useModalA11y';

export function NewCatalogModal({ isOpen, onClose, onAdd, imdbEnabled = false }) {
  const [name, setName] = useState('');
  const [source, setSource] = useState('tmdb');
  const [type, setType] = useState('movie'); // 'movie' or 'series'
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
        filters.imdbListId = imdbListId.trim().match(/^ls\d{1,15}$/)?.[0] || '';
      }
      onAdd({
        name: name.trim(),
        type,
        source: 'imdb',
        filters,
        enabled: true,
      });
    } else {
      onAdd({
        name: name.trim(),
        type,
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
    setType('movie');
    setImdbListType('discover');
    setImdbListId('');
    onClose();
  };

  const isImdbListValid =
    source !== 'imdb' || imdbListType !== 'imdb_list' || /^ls\d{1,15}$/.test(imdbListId.trim());

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      role="presentation"
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div
        className="modal"
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label="Create New Catalog"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header" style={{ paddingBottom: '8px' }}>
          <div>
            <h3 className="modal-title">Create New Catalog</h3>
            <p className="text-secondary" style={{ fontSize: '13px', marginTop: '4px' }}>
              Choose a data source and content type to get started
            </p>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="filter-group">
              <div className="catalog-type-grid">
                <button
                  type="button"
                  className={`type-card ${source === 'tmdb' && type === 'movie' ? 'active' : ''}`}
                  onClick={() => {
                    setSource('tmdb');
                    setType('movie');
                  }}
                >
                  <div className="type-card-icon tmdb">
                    <Film size={20} />
                  </div>
                  <div className="type-card-content">
                    <span className="type-title">TMDB Movie</span>
                    <span className="type-desc">Standard TMDB discovery</span>
                  </div>
                </button>

                <button
                  type="button"
                  className={`type-card ${source === 'tmdb' && type === 'series' ? 'active' : ''}`}
                  onClick={() => {
                    setSource('tmdb');
                    setType('series');
                  }}
                >
                  <div className="type-card-icon tmdb">
                    <Tv size={20} />
                  </div>
                  <div className="type-card-content">
                    <span className="type-title">TMDB Series</span>
                    <span className="type-desc">Standard TMDB discovery</span>
                  </div>
                </button>

                {imdbEnabled && (
                  <>
                    <button
                      type="button"
                      className={`type-card ${source === 'imdb' && type === 'movie' ? 'active' : ''}`}
                      onClick={() => {
                        setSource('imdb');
                        setType('movie');
                      }}
                    >
                      <div className="type-card-icon imdb">
                        <Award size={20} />
                      </div>
                      <div className="type-card-content">
                        <span className="type-title">IMDb Movie</span>
                        <span className="type-desc">IMDb metadata & lists</span>
                      </div>
                    </button>

                    <button
                      type="button"
                      className={`type-card ${source === 'imdb' && type === 'series' ? 'active' : ''}`}
                      onClick={() => {
                        setSource('imdb');
                        setType('series');
                      }}
                    >
                      <div className="type-card-icon imdb">
                        <Tv size={20} />
                      </div>
                      <div className="type-card-content">
                        <span className="type-title">IMDb Series</span>
                        <span className="type-desc">IMDb metadata & lists</span>
                      </div>
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="filter-group" style={{ marginTop: '20px' }}>
              <label className="filter-label" htmlFor="new-catalog-name">
                Catalog Name
              </label>
              <input
                id="new-catalog-name"
                type="text"
                className="input"
                style={{ height: '42px', fontSize: '15px' }}
                placeholder={
                  source === 'imdb'
                    ? 'e.g., Oscar Winners, IMDb Top Rated'
                    : 'e.g., My Sci-Fi Collection, Netflix Picks'
                }
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            {source === 'imdb' && (
              <div className="filter-group" style={{ marginTop: '16px' }}>
                <label className="filter-label" htmlFor="new-catalog-context">
                  Initial Context
                </label>
                <select
                  id="new-catalog-context"
                  className="input"
                  value={imdbListType}
                  onChange={(e) => setImdbListType(e.target.value)}
                >
                  <option value="discover">Advanced Search (Default)</option>
                  <option value="top250">IMDb Top 250</option>
                  <option value="popular">Most Popular</option>
                  <option value="imdb_list">Custom IMDb List ID</option>
                </select>

                {imdbListType === 'imdb_list' && (
                  <div style={{ marginTop: '8px' }}>
                    <input
                      type="text"
                      className={`input ${imdbListId && !isImdbListValid ? 'field-invalid' : ''}`}
                      placeholder="e.g. ls597789139"
                      value={imdbListId}
                      onChange={(e) => setImdbListId(e.target.value)}
                    />
                  </div>
                )}
              </div>
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
