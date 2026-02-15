import { useState, useEffect, useCallback, useRef, memo } from 'react';
import { api } from '../../services/api';
import { Film, Tv, Eye, EyeOff, Trash2, Loader } from 'lucide-react';

function ImdbFilterPanel({ catalog, imdbData, onChange }) {
  const filters = catalog?.filters || {};
  const type = catalog?.type || 'movie';
  const genres = imdbData?.genres?.[type] || [];
  const decades = imdbData?.decades?.[type] || [];
  const sortOptions = imdbData?.sortOptions || [];

  const update = (key, value) => {
    const newFilters = { ...filters, [key]: value || undefined };
    if (!value && value !== 0) delete newFilters[key];
    onChange({ ...catalog, filters: newFilters });
  };

  return (
    <div className="filter-panel" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div className="input-group">
        <label
          style={{
            fontSize: '12px',
            color: 'var(--text-muted)',
            marginBottom: '4px',
            display: 'block',
          }}
        >
          Sort By
        </label>
        <select
          className="input"
          value={filters.sortBy || 'rating'}
          onChange={(e) => update('sortBy', e.target.value)}
          style={{ width: '100%' }}
        >
          {sortOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="input-group">
        <label
          style={{
            fontSize: '12px',
            color: 'var(--text-muted)',
            marginBottom: '4px',
            display: 'block',
          }}
        >
          Sort Order
        </label>
        <select
          className="input"
          value={filters.sortOrder || 'desc'}
          onChange={(e) => update('sortOrder', e.target.value)}
          style={{ width: '100%' }}
        >
          <option value="desc">Descending</option>
          <option value="asc">Ascending</option>
        </select>
      </div>

      {genres.length > 0 && (
        <div className="input-group">
          <label
            style={{
              fontSize: '12px',
              color: 'var(--text-muted)',
              marginBottom: '4px',
              display: 'block',
            }}
          >
            Genre
          </label>
          <select
            className="input"
            value={filters.genre || ''}
            onChange={(e) => update('genre', e.target.value)}
            style={{ width: '100%' }}
          >
            <option value="">All Genres</option>
            {genres.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>
      )}

      {decades.length > 0 && (
        <div style={{ display: 'flex', gap: '12px' }}>
          <div className="input-group" style={{ flex: 1 }}>
            <label
              style={{
                fontSize: '12px',
                color: 'var(--text-muted)',
                marginBottom: '4px',
                display: 'block',
              }}
            >
              Decade From
            </label>
            <select
              className="input"
              value={filters.decadeStart || ''}
              onChange={(e) =>
                update('decadeStart', e.target.value ? parseInt(e.target.value) : undefined)
              }
              style={{ width: '100%' }}
            >
              <option value="">Any</option>
              {decades.map((d) => (
                <option key={d} value={d}>
                  {d}s
                </option>
              ))}
            </select>
          </div>
          <div className="input-group" style={{ flex: 1 }}>
            <label
              style={{
                fontSize: '12px',
                color: 'var(--text-muted)',
                marginBottom: '4px',
                display: 'block',
              }}
            >
              Decade To
            </label>
            <select
              className="input"
              value={filters.decadeEnd || ''}
              onChange={(e) =>
                update('decadeEnd', e.target.value ? parseInt(e.target.value) : undefined)
              }
              style={{ width: '100%' }}
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
      )}

      <div style={{ display: 'flex', gap: '12px' }}>
        <div className="input-group" style={{ flex: 1 }}>
          <label
            style={{
              fontSize: '12px',
              color: 'var(--text-muted)',
              marginBottom: '4px',
              display: 'block',
            }}
          >
            Min Rating
          </label>
          <input
            type="number"
            className="input"
            value={filters.ratingMin ?? ''}
            onChange={(e) =>
              update('ratingMin', e.target.value ? parseFloat(e.target.value) : undefined)
            }
            min="0"
            max="10"
            step="0.1"
            placeholder="0.0"
            style={{ width: '100%' }}
          />
        </div>
        <div className="input-group" style={{ flex: 1 }}>
          <label
            style={{
              fontSize: '12px',
              color: 'var(--text-muted)',
              marginBottom: '4px',
              display: 'block',
            }}
          >
            Max Rating
          </label>
          <input
            type="number"
            className="input"
            value={filters.ratingMax ?? ''}
            onChange={(e) =>
              update('ratingMax', e.target.value ? parseFloat(e.target.value) : undefined)
            }
            min="0"
            max="10"
            step="0.1"
            placeholder="10.0"
            style={{ width: '100%' }}
          />
        </div>
      </div>

      <div className="input-group">
        <label
          style={{
            fontSize: '12px',
            color: 'var(--text-muted)',
            marginBottom: '4px',
            display: 'block',
          }}
        >
          Min Votes
        </label>
        <input
          type="number"
          className="input"
          value={filters.votesMin ?? ''}
          onChange={(e) =>
            update('votesMin', e.target.value ? parseInt(e.target.value) : undefined)
          }
          min="0"
          step="1000"
          placeholder="Default (1000)"
          style={{ width: '100%' }}
        />
      </div>
    </div>
  );
}

export const ImdbCatalogEditor = memo(function ImdbCatalogEditor({
  catalog,
  imdbData,
  onUpdate,
  onDelete,
}) {
  const [localCatalog, setLocalCatalog] = useState(catalog);
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  const userEditedRef = useRef(false);

  useEffect(() => {
    userEditedRef.current = false;
    setLocalCatalog(catalog);
    setPreview(null);
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

  const handlePreview = useCallback(async () => {
    if (!localCatalog) return;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const result = await api.imdbPreview(localCatalog.type, localCatalog.filters || {}, 1);
      setPreview(result);
    } catch (err) {
      setPreviewError(err.message || 'Preview failed');
    } finally {
      setPreviewLoading(false);
    }
  }, [localCatalog]);

  if (!catalog) {
    return (
      <div className="editor-panel" style={{ padding: '24px' }}>
        <div className="empty-state">
          <p style={{ color: 'var(--text-muted)' }}>Select an IMDB catalog to edit</p>
        </div>
      </div>
    );
  }

  if (!imdbData?.available) {
    return (
      <div className="editor-panel" style={{ padding: '24px' }}>
        <div className="empty-state">
          <p style={{ color: 'var(--text-muted)' }}>IMDB dataset is loading. Please wait...</p>
        </div>
      </div>
    );
  }

  const TypeIcon = localCatalog?.type === 'series' ? Tv : Film;

  return (
    <div className="editor-panel" style={{ padding: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
        <TypeIcon size={20} style={{ color: 'var(--primary)' }} />
        <div style={{ flex: 1 }}>
          <input
            type="text"
            className="input"
            value={localCatalog?.name || ''}
            onChange={(e) => setLocalCatalogEdited({ ...localCatalog, name: e.target.value })}
            placeholder="Catalog name"
            style={{ fontSize: '16px', fontWeight: 600, width: '100%' }}
          />
        </div>
        <select
          className="input"
          value={localCatalog?.type || 'movie'}
          onChange={(e) => setLocalCatalogEdited({ ...localCatalog, type: e.target.value })}
          style={{ width: 'auto' }}
        >
          <option value="movie">Movie</option>
          <option value="series">Series</option>
        </select>
        <button
          className="btn btn-sm"
          onClick={() =>
            setLocalCatalogEdited({ ...localCatalog, enabled: !localCatalog?.enabled })
          }
          title={localCatalog?.enabled !== false ? 'Disable' : 'Enable'}
          style={{ padding: '6px' }}
        >
          {localCatalog?.enabled !== false ? <Eye size={16} /> : <EyeOff size={16} />}
        </button>
      </div>

      <ImdbFilterPanel
        catalog={localCatalog}
        imdbData={imdbData}
        onChange={setLocalCatalogEdited}
      />

      <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
        <button
          className="btn btn-primary btn-sm"
          onClick={handlePreview}
          disabled={previewLoading}
        >
          {previewLoading ? <Loader size={14} className="animate-spin" /> : null}
          Preview
        </button>
        {onDelete && (
          <button
            className="btn btn-sm"
            onClick={() => onDelete(catalog._id)}
            style={{ color: 'var(--error)', marginLeft: 'auto' }}
          >
            <Trash2 size={14} />
            Delete
          </button>
        )}
      </div>

      {previewError && (
        <div
          style={{
            marginTop: '16px',
            padding: '12px',
            background: 'var(--error-bg, rgba(255,0,0,0.1))',
            borderRadius: '8px',
            color: 'var(--error)',
          }}
        >
          {previewError}
        </div>
      )}

      {preview && (
        <div style={{ marginTop: '16px' }}>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>
            {preview.totalResults?.toLocaleString()} results
          </p>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
              gap: '12px',
            }}
          >
            {(preview.metas || []).map((meta) => (
              <div key={meta.id} style={{ textAlign: 'center' }}>
                <img
                  src={meta.poster}
                  alt={meta.name}
                  loading="lazy"
                  style={{
                    width: '100%',
                    aspectRatio: '2/3',
                    objectFit: 'cover',
                    borderRadius: '8px',
                    background: 'var(--surface-2, #333)',
                  }}
                  onError={(e) => {
                    e.target.style.display = 'none';
                  }}
                />
                <p style={{ fontSize: '11px', marginTop: '4px', color: 'var(--text-secondary)' }}>
                  {meta.name}
                </p>
                {meta.imdbRating && (
                  <p style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                    ⭐ {meta.imdbRating} {meta.releaseInfo ? `(${meta.releaseInfo})` : ''}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});
