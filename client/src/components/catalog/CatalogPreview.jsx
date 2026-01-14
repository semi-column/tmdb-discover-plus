import { Eye, Loader, RefreshCw, ImageOff, Star } from 'lucide-react';

export function CatalogPreview({
    loading,
    error,
    data,
    onRetry,
    onLoadPreview
}) {
    return (
        <div className="preview-panel-container">
            <div className="preview-section">
                <div className="preview-inner">
                    <div className="preview-header">
                        <h4 className="preview-title">
                            <Eye size={18} />
                            Preview
                        </h4>
                        {data && (
                            <span className="preview-count">
                                {data.totalResults?.toLocaleString()} results
                            </span>
                        )}
                    </div>

                    {loading && (
                        <div className="preview-loading">
                            <Loader size={32} className="animate-spin" />
                            <p>Loading preview...</p>
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
                            {data.metas.map((item) => {
                                // Build TMDB URL - use tmdbId if available, otherwise extract from id
                                const tmdbId = item.tmdbId || (item.id?.startsWith('tmdb:') ? item.id.replace('tmdb:', '') : null);
                                const tmdbUrl = tmdbId
                                    ? `https://www.themoviedb.org/${item.type === 'series' ? 'tv' : 'movie'}/${tmdbId}`
                                    : null;

                                return (
                                    <a
                                        key={item.id}
                                        className="preview-card"
                                        href={tmdbUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        title={`View "${item.name}" on TMDB`}
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
}
