import { useState, useEffect, useRef, memo } from 'react';
import { Eye, Loader, RefreshCw, ImageOff, Star, CheckCircle } from 'lucide-react';
import { PreviewGridSkeleton } from '../../layout/Skeleton';

export const CatalogPreview = memo(function CatalogPreview({ loading, error, data, onRetry }) {
  const [showUpdated, setShowUpdated] = useState(false);
  const prevDataRef = useRef(null);

  useEffect(() => {
    if (data && data !== prevDataRef.current && prevDataRef.current !== null) {
      setTimeout(() => setShowUpdated(true), 0);
      const timer = setTimeout(() => setShowUpdated(false), 1500);
      prevDataRef.current = data;
      return () => clearTimeout(timer);
    }
    prevDataRef.current = data;
  }, [data]);

  return (
    <div className={`preview-panel-container ${showUpdated ? 'preview-updated' : ''}`}>
      <div className="preview-section">
        <div className="preview-inner">
          <div className="preview-header">
            <h4 className="preview-title">
              <Eye size={18} />
              Preview
              {showUpdated && (
                <span className="preview-updated-badge">
                  <CheckCircle size={14} />
                  Updated
                </span>
              )}
            </h4>
            {data && (
              <span className="preview-count">{data.totalResults?.toLocaleString()} results</span>
            )}
          </div>

          {loading && (
            <div className="preview-loading">
              <PreviewGridSkeleton count={10} />
              <p className="preview-loading-text">Loading preview...</p>
            </div>
          )}

          {!loading && error && (
            <div className="preview-error">
              <p>{error}</p>
              <button className="btn btn-secondary" onClick={onRetry}>
                <RefreshCw size={16} />
                Retry
              </button>
            </div>
          )}

          {!loading && !error && data && (
            <div className="preview-grid">
              {(Array.isArray(data.metas) ? data.metas : []).map((item) => {
                const imdbId =
                  item.imdbId || item.imdb_id || (item.id?.startsWith('tt') ? item.id : null);
                const tmdbId =
                  item.tmdbId ||
                  (item.id?.startsWith('tmdb:') ? item.id.replace('tmdb:', '') : null);

                let itemUrl, linkTitle;
                if (imdbId) {
                  itemUrl = `https://www.imdb.com/title/${imdbId}/`;
                  linkTitle = `View "${item.name}" on IMDb`;
                } else if (tmdbId) {
                  itemUrl = `https://www.themoviedb.org/${item.type === 'series' ? 'tv' : 'movie'}/${tmdbId}`;
                  linkTitle = `View "${item.name}" on TMDB`;
                } else {
                  itemUrl = null;
                  linkTitle = item.name;
                }

                return (
                  <a
                    key={item.id}
                    className="preview-card"
                    href={itemUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={linkTitle}
                  >
                    {item.poster ? (
                      <img src={item.poster} alt={item.name} loading="lazy" />
                    ) : (
                      <div className="preview-card-placeholder">
                        <ImageOff size={24} />
                      </div>
                    )}
                    <div className="preview-card-overlay">
                      <div className="preview-card-title">{item.name}</div>
                      <div className="preview-card-meta">
                        {item.releaseInfo && <span>{item.releaseInfo}</span>}
                        {item.imdbRating && (
                          <span className="preview-card-rating">
                            <Star size={10} fill="currentColor" />
                            {item.imdbRating}
                          </span>
                        )}
                      </div>
                    </div>
                  </a>
                );
              })}
            </div>
          )}

          {!loading && !error && !data && (
            <div className="preview-empty">
              <Eye size={32} />
              <p>Configure filters and click Preview</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
