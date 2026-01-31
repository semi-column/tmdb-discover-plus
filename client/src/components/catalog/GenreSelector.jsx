import { Check, X } from 'lucide-react';

export function GenreSelector({
  genres,
  selectedGenres,
  excludedGenres,
  genreMatchMode,
  onInclude,
  onExclude,
  onClear,
  onSetMatchMode,
  loading,
  onRefresh,
}) {
  const getGenreState = (id) => {
    if (selectedGenres.includes(id)) return 'include';
    if (excludedGenres.includes(id)) return 'exclude';
    return 'neutral';
  };

  const handleTriStateClick = (id) => {
    const currentState = getGenreState(id);
    if (currentState === 'neutral') {
      onInclude(id);
    } else if (currentState === 'include') {
      onExclude(id);
    } else {
      onClear(id);
    }
  };

  if (loading) {
    return (
      <div className="loading-box">
        <p>Loading genres...</p>
      </div>
    );
  }

  if (!genres || genres.length === 0) {
    return (
      <div className="error-box">
        <p>Genres not available.</p>
        <div className="mt-2">
          <button className="btn btn-secondary btn-sm" onClick={onRefresh}>
            Retry loading genres
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="genre-instructions">
        <span className="genre-instruction-item">
          <span className="genre-dot neutral"></span> Click to include
        </span>
        <span className="genre-instruction-item">
          <span className="genre-dot include"></span> Click again to exclude
        </span>
        <span className="genre-instruction-item">
          <span className="genre-dot exclude"></span> Click again to clear
        </span>
      </div>

      {selectedGenres.length >= 2 && (
        <div className="genre-match-mode-box">
          <div className="genre-match-mode-label">How should multiple genres be matched?</div>
          <div className="genre-match-mode-options">
            <label className={`genre-match-option ${genreMatchMode === 'any' ? 'active' : ''}`}>
              <input
                type="radio"
                name="genreMatchMode"
                value="any"
                checked={genreMatchMode === 'any'}
                onChange={() => onSetMatchMode('any')}
              />
              <span className="option-text">Match ANY (more results)</span>
            </label>
            <label className={`genre-match-option ${genreMatchMode === 'all' ? 'active' : ''}`}>
              <input
                type="radio"
                name="genreMatchMode"
                value="all"
                checked={genreMatchMode === 'all'}
                onChange={() => onSetMatchMode('all')}
              />
              <span className="option-text">Match ALL (specific results)</span>
            </label>
          </div>
        </div>
      )}

      <div className="genre-grid tristate">
        {[...genres].sort((a, b) => a.name.localeCompare(b.name)).map((genre) => {
          const state = getGenreState(genre.id);
          return (
            <button
              key={genre.id}
              type="button"
              className={`genre-chip tristate ${state}`}
              onClick={() => handleTriStateClick(genre.id)}
              title={
                state === 'neutral'
                  ? 'Click to include'
                  : state === 'include'
                    ? 'Click to exclude'
                    : 'Click to clear'
              }
            >
              <span className="genre-chip-label">{genre.name}</span>
              {state === 'include' && <Check size={14} />}
              {state === 'exclude' && <X size={14} />}
            </button>
          );
        })}
      </div>

      {(selectedGenres.length > 0 || excludedGenres.length > 0) && (
        <div className="genre-summary">
          {selectedGenres.length > 0 && (
            <div className="genre-summary-row include">
              <Check size={14} />
              <span>
                Including:{' '}
                {selectedGenres
                  .map((id) => {
                    const g = genres.find((g) => g.id === id);
                    return g?.name || id;
                  })
                  .join(', ')}
              </span>
            </div>
          )}
          {excludedGenres.length > 0 && (
            <div className="genre-summary-row exclude">
              <X size={14} />
              <span>
                Excluding:{' '}
                {excludedGenres
                  .map((id) => {
                    const g = genres.find((g) => g.id === id);
                    return g?.name || id;
                  })
                  .join(', ')}
              </span>
            </div>
          )}
        </div>
      )}
    </>
  );
}
