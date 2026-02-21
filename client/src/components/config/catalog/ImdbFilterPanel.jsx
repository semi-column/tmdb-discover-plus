import { useState, useCallback, useMemo, memo } from 'react';
import { FilterSection } from './FilterSection';
import { Settings, Sparkles, Calendar, Award, Tag, Globe } from 'lucide-react';
import { SearchableSelect } from '../../forms/SearchableSelect';
import { RangeSlider, SingleSlider } from '../../forms/RangeSlider';
import { LabelWithTooltip } from '../../forms/Tooltip';

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
  expandedSections,
  onToggleSection,
}) {
  const [internalSections, setInternalSections] = useState({
    basic: true,
    genres: false,
    release: false,
    keywords: false,
    awards: false,
    region: false,
  });

  const localExpandedSections = expandedSections || internalSections;

  const toggleSection = useCallback(
    (section) => {
      if (onToggleSection) {
        onToggleSection(section);
      } else {
        setInternalSections((prev) => ({
          ...prev,
          [section]: !prev[section],
        }));
      }
    },
    [onToggleSection]
  );

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

  const handleRuntimeChange = useCallback(
    (range) => {
      onFiltersChange('runtimeMin', range[0] === 0 ? undefined : range[0]);
      onFiltersChange('runtimeMax', range[1] === 400 ? undefined : range[1]);
    },
    [onFiltersChange]
  );

  const handleAddLanguage = useCallback(
    (value) => {
      if (!value) return;
      const current = filters.languages || [];
      if (!current.includes(value)) {
        onFiltersChange('languages', [...current, value]);
      }
    },
    [filters.languages, onFiltersChange]
  );

  const handleRemoveLanguage = useCallback(
    (lang) => {
      onFiltersChange(
        'languages',
        (filters.languages || []).filter((l) => l !== lang)
      );
    },
    [filters.languages, onFiltersChange]
  );

  const handleAddCountry = useCallback(
    (value) => {
      if (!value) return;
      const current = filters.countries || [];
      if (!current.includes(value)) {
        onFiltersChange('countries', [...current, value]);
      }
    },
    [filters.countries, onFiltersChange]
  );

  const handleRemoveCountry = useCallback(
    (country) => {
      onFiltersChange(
        'countries',
        (filters.countries || []).filter((c) => c !== country)
      );
    },
    [filters.countries, onFiltersChange]
  );

  const availableLanguages = useMemo(
    () => languages.filter((l) => !(filters.languages || []).includes(l.iso_639_1)),
    [languages, filters.languages]
  );

  const availableCountries = useMemo(
    () => countries.filter((c) => !(filters.countries || []).includes(c.iso_3166_1)),
    [countries, filters.countries]
  );

  const sortOrderOptions = useMemo(
    () => [
      { value: 'ASC', label: 'Ascending' },
      { value: 'DESC', label: 'Descending' },
    ],
    []
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
        isOpen={localExpandedSections.basic}
        onToggle={toggleSection}
      >
        <div className="filter-grid">
          <div className="filter-group">
            <LabelWithTooltip
              label="Sort By"
              tooltip="How to order your IMDb results."
            />
            <SearchableSelect
              options={imdbSortOptions}
              value={filters.sortBy || 'POPULARITY'}
              onChange={(value) => onFiltersChange('sortBy', value)}
              placeholder="Most Popular"
              searchPlaceholder="Search..."
              labelKey="label"
              valueKey="value"
              allowClear={false}
            />
          </div>

          <div className="filter-group">
            <LabelWithTooltip
              label="Sort Order"
              tooltip="Direction of sorting — ascending or descending."
            />
            <SearchableSelect
              options={sortOrderOptions}
              value={filters.sortOrder || 'DESC'}
              onChange={(value) => onFiltersChange('sortOrder', value)}
              placeholder="Descending"
              searchPlaceholder="Search..."
              labelKey="label"
              valueKey="value"
              allowClear={false}
            />
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

        <div className="filter-spacer-lg">
          <SingleSlider
            label="Min IMDb Rating"
            tooltip="Minimum IMDb user rating (0–10). Higher values surface only highly-rated titles."
            min={0}
            max={10}
            step={0.1}
            value={filters.imdbRatingMin ?? 0}
            onChange={(v) => onFiltersChange('imdbRatingMin', v === 0 ? undefined : v)}
            formatValue={(v) => (v === 0 ? 'Any' : v.toFixed(1) + '+')}
            showInput
          />
        </div>

        <div className="filter-spacer">
          <SingleSlider
            label="Min Vote Count"
            tooltip="Minimum number of user ratings. Higher values filter out obscure titles."
            min={0}
            max={1000000}
            step={1000}
            value={filters.totalVotesMin ?? 0}
            onChange={(v) => onFiltersChange('totalVotesMin', v === 0 ? undefined : v)}
            formatValue={(v) => (v === 0 ? 'Any' : v.toLocaleString() + '+')}
            showInput
          />
        </div>
      </FilterSection>

      <FilterSection
        id="region"
        title="Language & Region"
        description="Filter by original language and country"
        icon={Globe}
        isOpen={localExpandedSections.region}
        onToggle={toggleSection}
      >
        <div className="filter-grid">
          <div className="filter-group">
            <LabelWithTooltip
              label="Languages"
              tooltip="Filter by the original language of the content. Select multiple."
            />
            <SearchableSelect
              options={availableLanguages}
              value=""
              onChange={handleAddLanguage}
              placeholder="Add language..."
              searchPlaceholder="Search languages..."
              labelKey="english_name"
              valueKey="iso_639_1"
              allowClear={false}
            />
            {(filters.languages || []).length > 0 && (
              <div className="imdb-selected-chips">
                {filters.languages.map((lang) => {
                  const langObj = languages.find((l) => l.iso_639_1 === lang);
                  return (
                    <span
                      key={lang}
                      className="genre-chip selected imdb-chip--clickable"
                      role="button"
                      tabIndex={0}
                      onClick={() => handleRemoveLanguage(lang)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleRemoveLanguage(lang); }}
                    >
                      {langObj?.english_name || lang} ×
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          <div className="filter-group">
            <LabelWithTooltip
              label="Countries"
              tooltip="Filter by country of origin. Select multiple."
            />
            <SearchableSelect
              options={availableCountries}
              value=""
              onChange={handleAddCountry}
              placeholder="Add country..."
              searchPlaceholder="Search countries..."
              labelKey="english_name"
              valueKey="iso_3166_1"
              allowClear={false}
            />
            {(filters.countries || []).length > 0 && (
              <div className="imdb-selected-chips">
                {filters.countries.map((country) => {
                  const countryObj = countries.find((c) => c.iso_3166_1 === country);
                  return (
                    <span
                      key={country}
                      className="genre-chip selected imdb-chip--clickable"
                      role="button"
                      tabIndex={0}
                      onClick={() => handleRemoveCountry(country)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleRemoveCountry(country); }}
                    >
                      {countryObj?.english_name || country} ×
                    </span>
                  );
                })}
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
        isOpen={localExpandedSections.genres}
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
        isOpen={localExpandedSections.release}
        onToggle={toggleSection}
      >
        <div className="filter-grid">
          <div className="filter-group">
            <LabelWithTooltip label="Release Date From" tooltip="Include titles released on or after this date." />
            <input
              id="imdb-date-from"
              type="date"
              className="input"
              value={filters.releaseDateStart || ''}
              onChange={(e) => onFiltersChange('releaseDateStart', e.target.value || undefined)}
            />
          </div>
          <div className="filter-group">
            <LabelWithTooltip label="Release Date To" tooltip="Include titles released on or before this date." />
            <input
              id="imdb-date-to"
              type="date"
              className="input"
              value={filters.releaseDateEnd || ''}
              onChange={(e) => onFiltersChange('releaseDateEnd', e.target.value || undefined)}
            />
          </div>
        </div>

        <div className="filter-spacer">
          <RangeSlider
            label="Runtime (minutes)"
            tooltip="Filter by total runtime in minutes."
            min={0}
            max={400}
            step={1}
            value={[filters.runtimeMin || 0, filters.runtimeMax || 400]}
            onChange={handleRuntimeChange}
            formatValue={(v) => (v === 0 ? 'Any' : v === 400 ? '400+' : `${v}m`)}
            showInputs
          />
          <div className="runtime-presets filter-spacer-sm">
            <button
              type="button"
              className={`date-preset ${filters.runtimeMax === 60 && !filters.runtimeMin ? 'active' : ''}`}
              onClick={() => handleRuntimeChange([0, 60])}
            >
              Short (&lt;60m)
            </button>
            <button
              type="button"
              className={`date-preset ${filters.runtimeMin === 90 && filters.runtimeMax === 120 ? 'active' : ''}`}
              onClick={() => handleRuntimeChange([90, 120])}
            >
              Standard (90-120m)
            </button>
            <button
              type="button"
              className={`date-preset ${filters.runtimeMin === 150 ? 'active' : ''}`}
              onClick={() => handleRuntimeChange([150, 400])}
            >
              Long (&gt;150m)
            </button>
            <button
              type="button"
              className="date-preset"
              onClick={() => handleRuntimeChange([0, 400])}
            >
              Any
            </button>
          </div>
        </div>
      </FilterSection>

      {imdbKeywords.length > 0 && (
        <FilterSection
          id="keywords"
          title="Keywords"
          description="Filter by predefined IMDb keywords"
          icon={Tag}
          isOpen={localExpandedSections.keywords}
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
          isOpen={localExpandedSections.awards}
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
