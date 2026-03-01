import { useState, useCallback } from 'react';
import { X, Sparkles, Loader, Check, AlertTriangle, RotateCcw } from 'lucide-react';
import { useModalA11y } from '../../hooks/useModalA11y';
import { useAICatalog } from '../../hooks/useAICatalog';
import { useTMDBData, useCatalog } from '../../context/AppContext';
import { MOVIE_GENRES, TV_GENRES } from '../../data/aiPrompt';

const EXAMPLES = [
  'Trending action movies this month',
  'Top rated Korean dramas',
  'Sci-fi movies from the 2000s with high ratings',
  'Latest documentaries on Netflix',
];

const SORT_LABELS = {
  'popularity.desc': 'Most Popular',
  'popularity.asc': 'Least Popular',
  'vote_average.desc': 'Highest Rated',
  'vote_average.asc': 'Lowest Rated',
  'vote_count.desc': 'Most Voted',
  'vote_count.asc': 'Least Voted',
  'primary_release_date.desc': 'Newest Releases',
  'primary_release_date.asc': 'Oldest Releases',
  'release_date.desc': 'Newest',
  'release_date.asc': 'Oldest',
  'revenue.desc': 'Highest Revenue',
  'revenue.asc': 'Lowest Revenue',
  'first_air_date.desc': 'Newest First Aired',
  'first_air_date.asc': 'Oldest First Aired',
};

const LIST_TYPE_LABELS = {
  discover: 'Discovery',
  trending_day: 'Trending Today',
  trending_week: 'Trending This Week',
  now_playing: 'Now Playing',
  upcoming: 'Upcoming',
  airing_today: 'Airing Today',
  on_the_air: 'On The Air',
  top_rated: 'Top Rated',
  popular: 'Popular',
};

const RELEASE_TYPE_LABELS = {
  1: 'Premiere',
  2: 'Limited Theatrical',
  3: 'Theatrical',
  4: 'Digital',
  5: 'Physical',
  6: 'TV',
};

const DATE_PRESET_LABELS = {
  last_30_days: 'Last 30 Days',
  last_90_days: 'Last 90 Days',
  last_180_days: 'Last 6 Months',
  last_365_days: 'Last Year',
  next_30_days: 'Next 30 Days',
  next_90_days: 'Next 90 Days',
  era_2020s: '2020s',
  era_2010s: '2010s',
  era_2000s: '2000s',
  era_1990s: '1990s',
  era_1980s: '1980s',
};

function getGenreName(id, type) {
  const genres = type === 'series' ? TV_GENRES : MOVIE_GENRES;
  return genres[id] || `Genre ${id}`;
}

function ResultPreview({ catalog, onNameChange }) {
  const { name, type, source, filters } = catalog;

  const items = [];

  items.push({ label: 'Type', value: type === 'series' ? 'TV Series' : 'Movie' });
  items.push({ label: 'Source', value: (source || 'tmdb').toUpperCase() });

  if (filters.listType && filters.listType !== 'discover') {
    items.push({ label: 'List', value: LIST_TYPE_LABELS[filters.listType] || filters.listType });
  }

  if (filters.sortBy) {
    items.push({ label: 'Sort', value: SORT_LABELS[filters.sortBy] || filters.sortBy });
  }

  if (filters.genres?.length) {
    items.push({
      label: 'Genres',
      value: filters.genres.map((id) => getGenreName(id, type)).join(', '),
    });
  }

  if (filters.excludeGenres?.length) {
    items.push({
      label: 'Excluded',
      value: filters.excludeGenres.map((id) => getGenreName(id, type)).join(', '),
    });
  }

  if (filters.datePreset) {
    items.push({
      label: 'Period',
      value: DATE_PRESET_LABELS[filters.datePreset] || filters.datePreset,
    });
  }

  if (filters.yearFrom || filters.yearTo) {
    const from = filters.yearFrom || '...';
    const to = filters.yearTo || '...';
    items.push({ label: 'Years', value: `${from} – ${to}` });
  }

  if (filters.ratingMin !== undefined || filters.ratingMax !== undefined) {
    const min = filters.ratingMin ?? 0;
    const max = filters.ratingMax ?? 10;
    items.push({ label: 'Rating', value: `${min} – ${max}` });
  }

  if (filters.voteCountMin) {
    items.push({ label: 'Min Votes', value: filters.voteCountMin.toLocaleString() });
  }

  if (filters.runtimeMin || filters.runtimeMax) {
    const min = filters.runtimeMin || 0;
    const max = filters.runtimeMax || '∞';
    items.push({ label: 'Runtime', value: `${min} – ${max} min` });
  }

  if (filters.countries) {
    items.push({ label: 'Country', value: filters.countries });
  }

  if (filters.language) {
    items.push({ label: 'Language', value: filters.language });
  }

  if (filters.releaseTypes?.length) {
    items.push({
      label: 'Release',
      value: filters.releaseTypes.map((t) => RELEASE_TYPE_LABELS[t] || t).join(', '),
    });
  }

  if (filters.certifications?.length) {
    items.push({ label: 'Certification', value: filters.certifications.join(', ') });
  }

  if (filters.watchMonetizationTypes?.length) {
    items.push({ label: 'Availability', value: filters.watchMonetizationTypes.join(', ') });
  }

  return (
    <div className="ai-result-preview">
      <div className="ai-result-header">Generated Catalog</div>
      <div className="ai-result-body">
        <div className="ai-result-item">
          <span className="ai-result-label">Name</span>
          <input
            type="text"
            className="ai-name-input"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            maxLength={50}
          />
        </div>
        {items.map(({ label, value }) => (
          <div key={label} className="ai-result-item">
            <span className="ai-result-label">{label}</span>
            <span className="ai-result-value">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EntitiesPreview({ entities, resolutionResults }) {
  if (!entities || Object.keys(entities).length === 0) return null;

  const labels = {
    people: 'People',
    companies: 'Companies',
    excludeCompanies: 'Excluded Companies',
    keywords: 'Keywords',
    excludeKeywords: 'Excluded Keywords',
    networks: 'Networks',
    watchProviders: 'Streaming Services',
  };

  return (
    <div className="ai-entities-section">
      <div className="ai-entities-title">
        {resolutionResults ? 'Resolution Results' : 'Entities to Look Up'}
      </div>
      {Object.entries(entities).map(([key, names]) => (
        <div key={key}>
          <span
            style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase' }}
          >
            {labels[key] || key}
          </span>
          {names.map((name) => {
            const wasResolved = resolutionResults?.formState?.[
              key === 'people'
                ? 'selectedPeople'
                : key === 'companies'
                  ? 'selectedCompanies'
                  : key === 'excludeCompanies'
                    ? 'excludeCompanies'
                    : key === 'keywords'
                      ? 'selectedKeywords'
                      : key === 'excludeKeywords'
                        ? 'excludeKeywords'
                        : key === 'networks'
                          ? 'selectedNetworks'
                          : null
            ]?.some((r) => r.name?.toLowerCase().includes(name.toLowerCase()));

            const watchResolved =
              key === 'watchProviders' && resolutionResults?.filters?.watchProviders?.length > 0;
            const resolved = wasResolved || watchResolved;

            return (
              <div key={name} className="ai-resolve-item">
                {resolutionResults ? (
                  resolved ? (
                    <Check size={12} className="resolved" />
                  ) : (
                    <AlertTriangle size={12} className="failed" />
                  )
                ) : null}
                <span className="ai-entity-item">{name}</span>
              </div>
            );
          })}
        </div>
      ))}
      {resolutionResults?.warnings?.length > 0 && (
        <div style={{ marginTop: '8px', fontSize: '12px', color: '#eab308' }}>
          {resolutionResults.warnings.map((w, i) => (
            <div key={i}>{w}</div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AICatalogModal({ isOpen, onClose, onApply, existingCatalog, addToast }) {
  const [userMessage, setUserMessage] = useState('');
  const modalRef = useModalA11y(isOpen, onClose);
  const tmdbData = useTMDBData();
  const { preferences } = useCatalog();

  const {
    generateFromPrompt,
    resolveEntities,
    isGenerating,
    isResolving,
    generatedCatalog,
    setGeneratedCatalog,
    resolutionResults,
    error,
    reset,
  } = useAICatalog();

  const handleClose = useCallback(() => {
    setUserMessage('');
    reset();
    onClose();
  }, [onClose, reset]);

  const geminiApiKey = localStorage.getItem('gemini-api-key');

  const handleGenerate = useCallback(async () => {
    if (!userMessage.trim() || !geminiApiKey) return;
    await generateFromPrompt(geminiApiKey, userMessage, existingCatalog);
  }, [userMessage, geminiApiKey, existingCatalog, generateFromPrompt]);

  const handleApply = useCallback(async () => {
    if (!generatedCatalog) return;

    let finalFilters = { ...generatedCatalog.filters };
    let finalFormState = {};
    let warnings = [];

    if (generatedCatalog.entitiesToResolve) {
      const region = preferences?.region || 'US';
      const result = await resolveEntities(generatedCatalog.entitiesToResolve, tmdbData, region);
      finalFilters = { ...finalFilters, ...result.filters };
      finalFormState = result.formState;
      warnings = result.warnings;
    }

    const catalogConfig = {
      name: generatedCatalog.name,
      type: generatedCatalog.type,
      source: generatedCatalog.source,
      filters: finalFilters,
      formState: finalFormState,
    };

    onApply(catalogConfig);

    if (warnings.length > 0) {
      addToast?.(
        `Some items couldn't be found: ${warnings.join(', ')}. You can add them manually.`,
        'warning'
      );
    }

    handleClose();
  }, [generatedCatalog, resolveEntities, onApply, addToast, tmdbData, preferences, handleClose]);

  const handleNameChange = useCallback(
    (newName) => {
      if (generatedCatalog) {
        setGeneratedCatalog({ ...generatedCatalog, name: newName.slice(0, 50) });
      }
    },
    [generatedCatalog, setGeneratedCatalog]
  );

  const handleKeyDown = useCallback(
    (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleGenerate();
      }
    },
    [handleGenerate]
  );

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" role="presentation">
      <div
        className="modal ai-modal"
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label="AI Catalog Assistant"
      >
        <div className="modal-header">
          <div>
            <h3 className="modal-title">
              <Sparkles size={18} style={{ marginRight: '8px', verticalAlign: 'text-bottom' }} />
              AI Catalog Assistant
            </h3>
            <p className="text-secondary" style={{ fontSize: '13px', marginTop: '4px' }}>
              Describe the catalog you want in natural language
            </p>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={handleClose}>
            <X size={20} />
          </button>
        </div>

        <div className="modal-body">
          {existingCatalog && (
            <div className="ai-edit-banner">
              Editing: <strong>{existingCatalog.name}</strong>
            </div>
          )}

          <textarea
            className="ai-textarea"
            placeholder={
              existingCatalog
                ? 'Describe how you want to modify this catalog...'
                : 'e.g., "Trending sci-fi movies with high ratings, exclude horror"'
            }
            value={userMessage}
            onChange={(e) => setUserMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isGenerating || isResolving}
          />

          {!userMessage && !generatedCatalog && !isGenerating && (
            <div className="ai-examples">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  className="ai-example-btn"
                  onClick={() => setUserMessage(example)}
                >
                  {example}
                </button>
              ))}
            </div>
          )}

          <div className="ai-generate-row">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={handleGenerate}
              disabled={!userMessage.trim() || isGenerating || isResolving}
            >
              {isGenerating ? (
                <>
                  <Loader size={14} className="animate-spin" />
                  Generating...
                </>
              ) : generatedCatalog ? (
                <>
                  <RotateCcw size={14} />
                  Regenerate
                </>
              ) : (
                <>
                  <Sparkles size={14} />
                  Generate
                </>
              )}
            </button>
            {!isGenerating && userMessage.length > 0 && userMessage.length < 10 && (
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                Tip: be more specific for better results
              </span>
            )}
          </div>

          {error && <div className="ai-error">{error}</div>}

          {isGenerating && (
            <div className="ai-loading">
              <div className="spinner" />
              <span>Generating catalog configuration...</span>
            </div>
          )}

          {generatedCatalog && !isGenerating && (
            <>
              <ResultPreview catalog={generatedCatalog} onNameChange={handleNameChange} />
              <EntitiesPreview
                entities={generatedCatalog.entitiesToResolve}
                resolutionResults={resolutionResults}
              />
            </>
          )}
        </div>

        {generatedCatalog && !isGenerating && (
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={handleClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleApply}
              disabled={isResolving}
            >
              {isResolving ? (
                <>
                  <Loader size={14} className="animate-spin" />
                  Resolving...
                </>
              ) : (
                'Apply & Edit'
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
