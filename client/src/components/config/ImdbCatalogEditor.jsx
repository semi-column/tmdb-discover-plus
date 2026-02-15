import { useState, useEffect, useCallback, useRef, memo } from 'react';
import { api } from '../../services/api';
import {
  Calendar,
  Eye,
  EyeOff,
  Film,
  Globe,
  Loader,
  Settings,
  Sparkles,
  Star,
  Trash2,
  Tv,
} from 'lucide-react';
import { FilterSection } from './catalog/FilterSection';
import { CatalogPreview } from './catalog/CatalogPreview';

export const ImdbCatalogEditor = memo(function ImdbCatalogEditor({
  catalog,
  imdbData,
  onUpdate,
  onDelete,
}) {
  const [localCatalog, setLocalCatalog] = useState(catalog);
  const [previewData, setPreviewData] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  const userEditedRef = useRef(false);
  const [expandedSections, setExpandedSections] = useState({
    sort: true,
    region: false,
    genre: false,
    decade: false,
    rating: false,
  });

  useEffect(() => {
    userEditedRef.current = false;
    setLocalCatalog(catalog);
    setPreviewData(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog?._id]);

  useEffect(() => {
    if (userEditedRef.current && localCatalog && catalog && localCatalog._id === catalog._id) {
      onUpdate(catalog._id, localCatalog);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localCatalog]);

  const setLocalCatalogEdited = useCallback((updater) => {
    userEditedRef.current = true;
    setLocalCatalog(updater);
  }, []);

  const handleFiltersChange = useCallback(
    (key, value) => {
      setLocalCatalogEdited((prev) => {
        const newFilters = { ...prev.filters, [key]: value };
        if (value === undefined || value === '' || value === null) delete newFilters[key];
        return { ...prev, filters: newFilters };
      });
    },
    [setLocalCatalogEdited]
  );

  const toggleSection = useCallback((id) => {
    setExpandedSections((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const loadPreview = useCallback(async () => {
    if (!localCatalog) return;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const result = await api.imdbPreview(localCatalog.type, localCatalog.filters || {}, 1);
      setPreviewData(result);
    } catch (err) {
      setPreviewError(err.message || 'Preview failed');
    } finally {
      setPreviewLoading(false);
    }
  }, [localCatalog]);

  const handleTypeChange = useCallback(
    (type) => {
      setLocalCatalogEdited((prev) => ({ ...prev, type }));
    },
    [setLocalCatalogEdited]
  );

  if (!catalog) {
    return (
      <div className="editor-panel">
        <div className="empty-state">
          <p style={{ color: 'var(--text-muted)' }}>Select an IMDB catalog to edit</p>
        </div>
      </div>
    );
  }

  if (!imdbData?.available) {
    return (
      <div className="editor-panel">
        <div className="empty-state">
          <Loader size={24} className="animate-spin" style={{ marginBottom: 12 }} />
          <p style={{ color: 'var(--text-muted)' }}>IMDB dataset is loading...</p>
        </div>
      </div>
    );
  }

  const filters = localCatalog?.filters || {};
  const type = localCatalog?.type || 'movie';
  const isMovie = type === 'movie';
  const genres = imdbData?.genres?.[type] || [];
  const decades = imdbData?.decades?.[type] || [];
  const regions = imdbData?.regions?.[type] || [];
  const regionLabels = imdbData?.regionLabels || {};
  const sortOptions = imdbData?.sortOptions || [];

  const getSortFilterCount = () => {
    let count = 0;
    if (filters.sortBy && filters.sortBy !== 'rating') count++;
    if (filters.sortOrder === 'asc') count++;
    return count;
  };

  const getGenreFilterCount = () => (filters.genre ? 1 : 0);

  const getRegionFilterCount = () => (filters.region ? 1 : 0);

  const getDecadeFilterCount = () => {
    let count = 0;
    if (filters.decadeStart) count++;
    if (filters.decadeEnd) count++;
    return count;
  };

  const getRatingFilterCount = () => {
    let count = 0;
    if (filters.ratingMin !== undefined) count++;
    if (filters.ratingMax !== undefined) count++;
    if (filters.votesMin !== undefined) count++;
    return count;
  };

  return (
    <div className="editor-container">
      <div className="editor-panel">
        <div className="editor-scroll">
          <div className="editor-header">
            <div className="editor-name-group">
              <input
                type="text"
                className="editor-name-input"
                value={localCatalog?.name || ''}
                onChange={(e) =>
                  setLocalCatalogEdited((prev) => ({ ...prev, name: e.target.value }))
                }
                placeholder="Catalog name"
              />
              {!localCatalog?.name?.trim() && <span className="field-error">Name is required</span>}
            </div>
            <div className="editor-actions">
              <button className="btn btn-secondary" onClick={loadPreview} disabled={previewLoading}>
                {previewLoading ? <Loader size={16} className="animate-spin" /> : <Eye size={16} />}
                Preview
              </button>
              <button
                className="btn btn-sm"
                onClick={() =>
                  setLocalCatalogEdited((prev) => ({ ...prev, enabled: !prev?.enabled }))
                }
                title={localCatalog?.enabled !== false ? 'Disable catalog' : 'Enable catalog'}
              >
                {localCatalog?.enabled !== false ? <Eye size={16} /> : <EyeOff size={16} />}
              </button>
              {onDelete && (
                <button
                  className="btn btn-sm"
                  onClick={() => onDelete(catalog._id)}
                  title="Delete catalog"
                  style={{ color: 'var(--error)' }}
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          </div>

          <div className="editor-content">
            <div className="content-type-toggle">
              <button
                className={`type-btn ${isMovie ? 'active' : ''}`}
                onClick={() => handleTypeChange('movie')}
              >
                <Film size={18} /> Movies
              </button>
              <button
                className={`type-btn ${!isMovie ? 'active' : ''}`}
                onClick={() => handleTypeChange('series')}
              >
                <Tv size={18} /> TV Shows
              </button>
            </div>

            <FilterSection
              id="sort"
              title="Sort & Order"
              description="How results are sorted"
              icon={Settings}
              isOpen={expandedSections.sort}
              onToggle={toggleSection}
              badgeCount={getSortFilterCount()}
            >
              <div className="filter-grid">
                <div className="input-group">
                  <label className="input-label">Sort By</label>
                  <select
                    className="input"
                    value={filters.sortBy || 'rating'}
                    onChange={(e) => handleFiltersChange('sortBy', e.target.value)}
                  >
                    {sortOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="input-group">
                  <label className="input-label">Sort Order</label>
                  <select
                    className="input"
                    value={filters.sortOrder || 'desc'}
                    onChange={(e) => handleFiltersChange('sortOrder', e.target.value)}
                  >
                    <option value="desc">Descending (highest first)</option>
                    <option value="asc">Ascending (lowest first)</option>
                  </select>
                </div>
              </div>
            </FilterSection>

            <FilterSection
              id="genre"
              title="Genre"
              description={filters.genre || 'Filter by genre'}
              icon={Sparkles}
              isOpen={expandedSections.genre}
              onToggle={toggleSection}
              badgeCount={getGenreFilterCount()}
            >
              <div className="input-group">
                <label className="input-label">Genre</label>
                <select
                  className="input"
                  value={filters.genre || ''}
                  onChange={(e) => handleFiltersChange('genre', e.target.value || undefined)}
                >
                  <option value="">All Genres</option>
                  {genres.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>
            </FilterSection>

            <FilterSection
              id="region"
              title="Region / Country"
              description={
                filters.region
                  ? regionLabels[filters.region] || filters.region
                  : 'Filter by release region'
              }
              icon={Globe}
              isOpen={expandedSections.region}
              onToggle={toggleSection}
              badgeCount={getRegionFilterCount()}
            >
              <div className="input-group">
                <label className="input-label">Region</label>
                <select
                  className="input"
                  value={filters.region || ''}
                  onChange={(e) => handleFiltersChange('region', e.target.value || undefined)}
                >
                  <option value="">All Regions</option>
                  {regions.map((code) => (
                    <option key={code} value={code}>
                      {regionLabels[code] ? `${regionLabels[code]} (${code})` : code}
                    </option>
                  ))}
                </select>
              </div>
            </FilterSection>

            <FilterSection
              id="decade"
              title="Decade"
              description="Filter by release decade"
              icon={Calendar}
              isOpen={expandedSections.decade}
              onToggle={toggleSection}
              badgeCount={getDecadeFilterCount()}
            >
              <div className="filter-grid">
                <div className="input-group">
                  <label className="input-label">From</label>
                  <select
                    className="input"
                    value={filters.decadeStart || ''}
                    onChange={(e) =>
                      handleFiltersChange(
                        'decadeStart',
                        e.target.value ? parseInt(e.target.value) : undefined
                      )
                    }
                  >
                    <option value="">Any</option>
                    {decades.map((d) => (
                      <option key={d} value={d}>
                        {d}s
                      </option>
                    ))}
                  </select>
                </div>
                <div className="input-group">
                  <label className="input-label">To</label>
                  <select
                    className="input"
                    value={filters.decadeEnd || ''}
                    onChange={(e) =>
                      handleFiltersChange(
                        'decadeEnd',
                        e.target.value ? parseInt(e.target.value) : undefined
                      )
                    }
                  >
                    <option value="">Any</option>
                    {decades.map((d) => (
                      <option key={d} value={d}>
                        {d}s
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </FilterSection>

            <FilterSection
              id="rating"
              title="Rating & Votes"
              description="IMDB rating and vote count thresholds"
              icon={Star}
              isOpen={expandedSections.rating}
              onToggle={toggleSection}
              badgeCount={getRatingFilterCount()}
            >
              <div className="filter-grid">
                <div className="input-group">
                  <label className="input-label">Min Rating</label>
                  <input
                    type="number"
                    className="input"
                    value={filters.ratingMin ?? ''}
                    onChange={(e) =>
                      handleFiltersChange(
                        'ratingMin',
                        e.target.value ? parseFloat(e.target.value) : undefined
                      )
                    }
                    min="0"
                    max="10"
                    step="0.1"
                    placeholder="0.0"
                  />
                </div>
                <div className="input-group">
                  <label className="input-label">Max Rating</label>
                  <input
                    type="number"
                    className="input"
                    value={filters.ratingMax ?? ''}
                    onChange={(e) =>
                      handleFiltersChange(
                        'ratingMax',
                        e.target.value ? parseFloat(e.target.value) : undefined
                      )
                    }
                    min="0"
                    max="10"
                    step="0.1"
                    placeholder="10.0"
                  />
                </div>
              </div>
              <div className="input-group" style={{ marginTop: '12px' }}>
                <label className="input-label">Min Votes</label>
                <input
                  type="number"
                  className="input"
                  value={filters.votesMin ?? ''}
                  onChange={(e) =>
                    handleFiltersChange(
                      'votesMin',
                      e.target.value ? parseInt(e.target.value) : undefined
                    )
                  }
                  min="0"
                  step="1000"
                  placeholder="Default (1000)"
                />
              </div>
            </FilterSection>

            <div className="mobile-preview-btn-container">
              <button
                className="btn btn-secondary mobile-preview-btn"
                onClick={loadPreview}
                disabled={previewLoading}
              >
                {previewLoading ? <Loader size={16} className="animate-spin" /> : <Eye size={16} />}
                Preview
              </button>
            </div>
          </div>
        </div>
      </div>

      <CatalogPreview
        loading={previewLoading}
        error={previewError}
        data={previewData}
        onRetry={loadPreview}
      />
    </div>
  );
});
