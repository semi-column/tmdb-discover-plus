import { useState } from 'react';
import { X, Film, Tv, Sparkles } from 'lucide-react';
import { useModalA11y } from '../../hooks/useModalA11y';
import { getSource } from '../../sources';

const SOURCES = [
  { id: 'tmdb', desc: 'Standard TMDB discovery', alwaysVisible: true },
  { id: 'imdb', desc: 'IMDb metadata & lists', enabledKey: 'imdbEnabled' },
  { id: 'anilist', desc: 'AniList anime database', alwaysVisible: true },
  { id: 'mal', desc: 'MyAnimeList rankings', alwaysVisible: true },
  { id: 'kitsu', desc: 'Kitsu anime catalogs', alwaysVisible: true },
  { id: 'simkl', desc: 'Simkl anime discovery', alwaysVisible: true },
  { id: 'trakt', desc: 'Trakt movie & TV discovery', alwaysVisible: true },
];

export function NewCatalogModal({ isOpen, onClose, onAdd, imdbEnabled = false }) {
  const [name, setName] = useState('');
  const [source, setSource] = useState('tmdb');
  const [type, setType] = useState('movie');
  const modalRef = useModalA11y(isOpen, onClose);

  if (!isOpen) return null;

  const enabledFlags = { imdbEnabled };

  const visibleSources = SOURCES.filter((s) => s.alwaysVisible || enabledFlags[s.enabledKey]);

  const currentSource = getSource(source);
  const supportedTypes = currentSource.supportedTypes || ['movie', 'series'];

  const handleSourceSelect = (id) => {
    setSource(id);
    const nextSource = getSource(id);
    const nextTypes = nextSource.supportedTypes || ['movie', 'series'];
    if (!nextTypes.includes(type)) {
      setType(nextTypes[0]);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;

    const sourceDescriptor = getSource(source);
    const filters = { ...sourceDescriptor.defaultFilters };
    if (source === 'tmdb' && type === 'collection') {
      filters.listType = 'collection';
      filters.sortBy = 'collection_order';
      delete filters.presetOrigin;
      delete filters.presetDefaults;
    }

    onAdd({
      name: name.trim(),
      type,
      source,
      filters,
      enabled: true,
    });

    setName('');
    setSource('tmdb');
    setType('movie');
    onClose();
  };

  const placeholders = {
    tmdb: 'e.g., My Sci-Fi Collection, Netflix Picks',
    imdb: 'e.g., Oscar Winners, IMDb Top Rated',
    anilist: 'e.g., Top Anime, Trending This Season',
    mal: 'e.g., MAL Top Ranked, Seasonal Anime',
    kitsu: 'e.g., Kitsu Trending, Top Rated Anime',
    simkl: 'e.g., Trending Anime, Best of 2024',
    trakt: 'e.g., Trending Movies, Most Watched',
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
        aria-label="Create New Catalog"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header" style={{ paddingBottom: '8px' }}>
          <div>
            <h3 className="modal-title">Create New Catalog</h3>
            <p className="text-secondary" style={{ fontSize: '13px', marginTop: '4px' }}>
              Choose a content type and source to get started
            </p>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {/* Source Selector */}
            <div className="filter-group">
              <span className="filter-label">Source</span>
              <div className="source-selector">
                {visibleSources.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`source-pill ${source === s.id ? 'active' : ''}`}
                    onClick={() => handleSourceSelect(s.id)}
                    title={s.desc}
                  >
                    <span className={`source-dot ${s.id}`} />
                    {getSource(s.id).label}
                  </button>
                ))}
              </div>
            </div>

            {/* Content Type Toggle */}
            <div className="filter-group" style={{ marginTop: '16px' }}>
              <span className="filter-label">Content Type</span>
              <div className="content-type-toggle" style={{ marginBottom: 0 }}>
                <button
                  type="button"
                  className={`type-btn ${type === 'movie' ? 'active' : ''}`}
                  onClick={() => setType('movie')}
                >
                  <Film size={16} />
                  Movies
                </button>
                <button
                  type="button"
                  className={`type-btn ${type === 'series' ? 'active' : ''}`}
                  onClick={() => setType('series')}
                >
                  <Tv size={16} />
                  Series
                </button>
                {supportedTypes.includes('anime') && (
                  <button
                    type="button"
                    className={`type-btn ${type === 'anime' ? 'active' : ''}`}
                    onClick={() => setType('anime')}
                  >
                    <Sparkles size={16} />
                    Anime
                  </button>
                )}
                {source === 'tmdb' && (
                  <button
                    type="button"
                    className={`type-btn ${type === 'collection' ? 'active' : ''}`}
                    onClick={() => setType('collection')}
                  >
                    <Sparkles size={16} />
                    Collections
                  </button>
                )}
              </div>
            </div>

            {/* Catalog Name */}
            <div className="filter-group" style={{ marginTop: '16px' }}>
              <label className="filter-label" htmlFor="new-catalog-name">
                Catalog Name
              </label>
              <input
                id="new-catalog-name"
                type="text"
                className="input"
                style={{ height: '42px', fontSize: '15px' }}
                placeholder={placeholders[source] || placeholders.tmdb}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
              Create Catalog
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
