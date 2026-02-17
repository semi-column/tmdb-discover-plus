import { useState, useCallback, useMemo, memo } from 'react';
import { FilterSection } from './FilterSection';
import { Settings, Sparkles, Calendar, Award, Tag, Globe } from 'lucide-react';

export const ImdbFilterPanel = memo(function ImdbFilterPanel({
  localCatalog,
  onFiltersChange,
  imdbGenres = [],
  imdbKeywords = [],
  imdbAwards = [],
  imdbSortOptions = [],
  imdbTitleTypes = [],
  countries = [],
  languages = [],
}) {
  const [expandedSections, setExpandedSections] = useState({
    basic: true,
    genres: false,
    filters: false,
    release: false,
    keywords: false,
    awards: false,
    region: false,
  });

  const toggleSection = (section) => {
    setExpandedSections((prev) => {
      if (prev[section]) return { ...prev, [section]: false };
      const allClosed = Object.keys(prev).reduce((acc, key) => {
        acc[key] = false;
        return acc;
      }, {});
      return { ...allClosed, [section]: true };
    });
  };

  const filters = useMemo(() => localCatalog?.filters || {}, [localCatalog?.filters]);
  const listType = filters.listType || 'discover';
  const isPreset = listType !== 'discover' && listType !== 'imdb_list';

  const handleGenreToggle = useCallback(
    (genre) => {
      const current = filters.genres || [];
      const next = current.includes(genre)
        ? current.filter((g) => g !== genre)
        : [...current, genre];
      onFiltersChange('genres', next);
    },
    [filters.genres, onFiltersChange]
  );

  const handleKeywordToggle = useCallback(
    (keyword) => {
      const current = filters.keywords || [];
      const next = current.includes(keyword)
        ? current.filter((k) => k !== keyword)
        : [...current, keyword];
      onFiltersChange('keywords', next);
    },
    [filters.keywords, onFiltersChange]
  );

  const handleAwardToggle = useCallback(
    (field, award) => {
      const current = filters[field] || [];
      const next = current.includes(award)
        ? current.filter((a) => a !== award)
        : [...current, award];
      onFiltersChange(field, next);
    },
    [filters, onFiltersChange]
  );

  if (isPreset) {
    return (
      <div className="flex items-center gap-3 p-4 mt-6 rounded-lg border border-white/5 bg-white/5 imdb-preset-notice">
        <Sparkles size={16} className="text-indigo-400" />
        <span className="text-gray-300 text-sm font-medium">
          This is a curated IMDb preset and cannot be modified.
        </span>
      </div>
    );
  }

  return (
    <>
      <FilterSection
        id="basic"
        title="Sort & Filter"
        description="Sort order and basic filters"
        icon={Settings}
        isOpen={expandedSections.basic}
        onToggle={toggleSection}
      >
        <div className="filter-grid">
          <div className="filter-group">
            <label className="filter-label" htmlFor="imdb-sort-by">
              Sort By
            </label>
            <select
              id="imdb-sort-by"
              className="input"
              value={filters.sortBy || 'POPULARITY'}
              onChange={(e) => onFiltersChange('sortBy', e.target.value)}
            >
              {imdbSortOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="filter-group">
            <label className="filter-label" htmlFor="imdb-sort-order">
              Sort Order
            </label>
            <select
              id="imdb-sort-order"
              className="input"
              value={filters.sortOrder || 'ASC'}
              onChange={(e) => onFiltersChange('sortOrder', e.target.value)}
            >
              <option value="ASC">Ascending</option>
              <option value="DESC">Descending</option>
            </select>
          </div>

          <div className="filter-group">
            <label className="filter-label" htmlFor="imdb-rating-min">
              Min IMDb Rating
            </label>
            <select
              id="imdb-rating-min"
              className="input"
              value={filters.imdbRatingMin || ''}
              onChange={(e) =>
                onFiltersChange(
                  'imdbRatingMin',
                  e.target.value ? Number(e.target.value) : undefined
                )
              }
            >
              <option value="">Any</option>
              <option value="6">6+</option>
              <option value="7">7+</option>
              <option value="8">8+</option>
              <option value="9">9+</option>
            </select>
          </div>

          <div className="filter-group">
            <label className="filter-label" htmlFor="imdb-vote-min">
              Min Vote Count
            </label>
            <select
              id="imdb-vote-min"
              className="input"
              value={filters.totalVotesMin || ''}
              onChange={(e) =>
                onFiltersChange(
                  'totalVotesMin',
                  e.target.value ? Number(e.target.value) : undefined
                )
              }
            >
              <option value="">Any</option>
              <option value="1000">1,000+</option>
              <option value="10000">10,000+</option>
              <option value="100000">100,000+</option>
              <option value="1000000">1,000,000+</option>
            </select>
          </div>

          {imdbTitleTypes.length > 0 && (
            <div className="filter-group span-full">
              <span className="filter-label">Title Types</span>
              <div className="imdb-chip-wrap">
                {imdbTitleTypes
                  .filter((tt) => {
                    if (localCatalog?.type === 'series') {
                      return ['tvSeries', 'tvMiniSeries', 'tvSpecial'].includes(tt.value);
                    }
                    return ['movie', 'tvMovie', 'short', 'video'].includes(tt.value);
                  })
                  .map((tt) => {
                    const selected = (filters.types || []).includes(tt.value);
                    return (
                      <button
                        key={tt.value}
                        type="button"
                        className={`genre-chip ${selected ? 'selected' : ''}`}
                        onClick={() => {
                          const current = filters.types || [];
                          const next = selected
                            ? current.filter((t) => t !== tt.value)
                            : [...current, tt.value];
                          onFiltersChange('types', next);
                        }}
                      >
                        {tt.label}
                      </button>
                    );
                  })}
              </div>
            </div>
          )}
        </div>
      </FilterSection>

      <FilterSection
        id="region"
        title="Language & Region"
        description="Filter by original language and country"
        icon={Globe}
        isOpen={expandedSections.region}
        onToggle={toggleSection}
      >
        <div className="filter-grid">
          <div className="filter-group">
            <label className="filter-label" htmlFor="imdb-languages">
              Languages
            </label>
            <select
              id="imdb-languages"
              className="input"
              value=""
              onChange={(e) => {
                if (!e.target.value) return;
                const current = filters.languages || [];
                if (!current.includes(e.target.value)) {
                  onFiltersChange('languages', [...current, e.target.value]);
                }
              }}
            >
              <option value="">Add language...</option>
              {languages
                .filter((l) => !(filters.languages || []).includes(l.iso_639_1))
                .map((l) => (
                  <option key={l.iso_639_1} value={l.iso_639_1}>
                    {l.english_name}
                  </option>
                ))}
            </select>
            {(filters.languages || []).length > 0 && (
              <div className="imdb-selected-chips">
                {filters.languages.map((lang) => (
                  <span
                    key={lang}
                    className="genre-chip selected imdb-chip--clickable"
                    onClick={() =>
                      onFiltersChange(
                        'languages',
                        filters.languages.filter((l) => l !== lang)
                      )
                    }
                  >
                    {lang} ×
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="filter-group">
            <label className="filter-label" htmlFor="imdb-countries">
              Countries
            </label>
            <select
              id="imdb-countries"
              className="input"
              value=""
              onChange={(e) => {
                if (!e.target.value) return;
                const current = filters.countries || [];
                if (!current.includes(e.target.value)) {
                  onFiltersChange('countries', [...current, e.target.value]);
                }
              }}
            >
              <option value="">Add country...</option>
              {countries
                .filter((c) => !(filters.countries || []).includes(c.iso_3166_1))
                .map((c) => (
                  <option key={c.iso_3166_1} value={c.iso_3166_1}>
                    {c.english_name}
                  </option>
                ))}
            </select>
            {(filters.countries || []).length > 0 && (
              <div className="imdb-selected-chips">
                {filters.countries.map((country) => (
                  <span
                    key={country}
                    className="genre-chip selected imdb-chip--clickable"
                    onClick={() =>
                      onFiltersChange(
                        'countries',
                        filters.countries.filter((c) => c !== country)
                      )
                    }
                  >
                    {country} ×
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </FilterSection>

      <FilterSection
        id="genres"
        title="Genres"
        description="Filter by IMDb genre"
        icon={Sparkles}
        isOpen={expandedSections.genres}
        onToggle={toggleSection}
        badgeCount={(filters.genres || []).length}
      >
        <div className="imdb-chip-wrap">
          {imdbGenres.map((genre) => {
            const selected = (filters.genres || []).includes(genre);
            return (
              <button
                key={genre}
                type="button"
                className={`genre-chip ${selected ? 'selected' : ''}`}
                onClick={() => handleGenreToggle(genre)}
              >
                {genre}
              </button>
            );
          })}
        </div>
      </FilterSection>

      <FilterSection
        id="release"
        title="Release Date & Runtime"
        description="Date range and runtime filters"
        icon={Calendar}
        isOpen={expandedSections.release}
        onToggle={toggleSection}
      >
        <div className="filter-grid">
          <div className="filter-group">
            <label className="filter-label" htmlFor="imdb-date-from">
              Release Date From
            </label>
            <input
              id="imdb-date-from"
              type="date"
              className="input"
              value={filters.releaseDateStart || ''}
              onChange={(e) => onFiltersChange('releaseDateStart', e.target.value || undefined)}
            />
          </div>
          <div className="filter-group">
            <label className="filter-label" htmlFor="imdb-date-to">
              Release Date To
            </label>
            <input
              id="imdb-date-to"
              type="date"
              className="input"
              value={filters.releaseDateEnd || ''}
              onChange={(e) => onFiltersChange('releaseDateEnd', e.target.value || undefined)}
            />
          </div>
          <div className="filter-group">
            <label className="filter-label" htmlFor="imdb-runtime-min">
              Min Runtime (min)
            </label>
            <input
              id="imdb-runtime-min"
              type="number"
              className="input"
              min="0"
              max="600"
              placeholder="e.g., 90"
              value={filters.runtimeMin || ''}
              onChange={(e) =>
                onFiltersChange('runtimeMin', e.target.value ? Number(e.target.value) : undefined)
              }
            />
          </div>
          <div className="filter-group">
            <label className="filter-label" htmlFor="imdb-runtime-max">
              Max Runtime (min)
            </label>
            <input
              id="imdb-runtime-max"
              type="number"
              className="input"
              min="0"
              max="600"
              placeholder="e.g., 180"
              value={filters.runtimeMax || ''}
              onChange={(e) =>
                onFiltersChange('runtimeMax', e.target.value ? Number(e.target.value) : undefined)
              }
            />
          </div>
        </div>
      </FilterSection>

      {imdbKeywords.length > 0 && (
        <FilterSection
          id="keywords"
          title="Keywords"
          description="Filter by predefined IMDb keywords"
          icon={Tag}
          isOpen={expandedSections.keywords}
          onToggle={toggleSection}
          badgeCount={(filters.keywords || []).length}
        >
          <div className="imdb-chip-wrap--scrollable">
            {imdbKeywords.map((kw) => {
              const selected = (filters.keywords || []).includes(kw);
              return (
                <button
                  key={kw}
                  type="button"
                  className={`genre-chip ${selected ? 'selected' : ''}`}
                  onClick={() => handleKeywordToggle(kw)}
                >
                  {kw.replace(/-/g, ' ')}
                </button>
              );
            })}
          </div>
        </FilterSection>
      )}

      {imdbAwards.length > 0 && (
        <FilterSection
          id="awards"
          title="Awards"
          description="Filter by award wins or nominations"
          icon={Award}
          isOpen={expandedSections.awards}
          onToggle={toggleSection}
          badgeCount={(filters.awardsWon || []).length + (filters.awardsNominated || []).length}
        >
          <div className="imdb-awards-section">
            <div>
              <span className="filter-label imdb-section-label">Awards Won</span>
              <div className="imdb-chip-wrap">
                {imdbAwards.map((award) => {
                  const selected = (filters.awardsWon || []).includes(award);
                  return (
                    <button
                      key={`won-${award}`}
                      type="button"
                      className={`genre-chip ${selected ? 'selected' : ''}`}
                      onClick={() => handleAwardToggle('awardsWon', award)}
                    >
                      {award.replace(/_/g, ' ')}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <span className="filter-label imdb-section-label">Awards Nominated</span>
              <div className="imdb-chip-wrap">
                {imdbAwards.map((award) => {
                  const selected = (filters.awardsNominated || []).includes(award);
                  return (
                    <button
                      key={`nom-${award}`}
                      type="button"
                      className={`genre-chip ${selected ? 'selected' : ''}`}
                      onClick={() => handleAwardToggle('awardsNominated', award)}
                    >
                      {award.replace(/_/g, ' ')}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </FilterSection>
      )}

      {listType === 'imdb_list' && (
        <div className="filter-group imdb-list-group">
          <label className="filter-label" htmlFor="imdb-list-id">
            IMDb List ID
          </label>
          <input
            id="imdb-list-id"
            type="text"
            className="input"
            placeholder="ls597789139"
            value={filters.imdbListId || ''}
            onChange={(e) => onFiltersChange('imdbListId', e.target.value)}
          />
        </div>
      )}
    </>
  );
});
