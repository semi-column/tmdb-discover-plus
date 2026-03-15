import { useState, useCallback, useMemo, memo } from 'react';
import { FilterSection } from './FilterSection';
import { GenreSelector } from './GenreSelector';
import {
  Settings,
  Sparkles,
  Calendar,
  Award,
  Tag,
  Globe,
  Users,
  MapPin,
  Shield,
  ListOrdered,
  Search,
  Eye,
  FileText,
  Database,
} from 'lucide-react';
import { CertificationCountryFilter } from '../../forms/CertificationCountryFilter';
import { SearchableSelect } from '../../forms/SearchableSelect';
import { SearchInput } from '../../forms/SearchInput';
import { RangeSlider, SingleSlider } from '../../forms/RangeSlider';
import { LabelWithTooltip } from '../../forms/Tooltip';

// TODO: Awards section hidden until upstream API compatibility is resolved. Set to false to re-enable.
const AWARDS_HIDDEN = false;
const MAX_RANK_HIDDEN = false;

export const ImdbFilterPanel = memo(function ImdbFilterPanel({
  localCatalog,
  onFiltersChange,
  imdbGenres = [],
  imdbAwards = [],
  imdbSortOptions = [],
  imdbTitleTypes = [],
  imdbCertificateRatings = {},
  imdbRankedLists = [],
  imdbWithDataOptions = [],
  countries = [],
  languages = [],
  expandedSections,
  onToggleSection,
  onSearchImdbPeople,
  onSearchImdbCompanies,
  onSearchCities,
  selectedImdbPeople = [],
  selectedImdbCompanies = [],
  selectedImdbExcludeCompanies = [],
  selectedCity = null,
  onSelectImdbPerson,
  onRemoveImdbPerson,
  onSelectImdbCompany,
  onRemoveImdbCompany,
  onSelectImdbExcludeCompany,
  onRemoveImdbExcludeCompany,
  onSelectCity,
  onClearCity,
}) {
  const [internalSections, setInternalSections] = useState({
    basic: true,
    genres: false,
    release: false,
    keywords: false,
    awards: false,
    region: false,
    people: false,
    theatres: false,
    certificates: false,
    rankedLists: false,
    textSearch: false,
    advanced: false,
  });

  const [keywordInput, setKeywordInput] = useState('');
  const [excludeKeywordInput, setExcludeKeywordInput] = useState('');
  const [plotInput, setPlotInput] = useState('');
  const [filmingInput, setFilmingInput] = useState('');
  const [rankInputDraft, setRankInputDraft] = useState(null);

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

  // Emmy is TV-only; best_picture_oscar / best_director_oscar are movie-only.
  const isMovieCatalog = (localCatalog?.type || 'movie') === 'movie';
  const visibleAwards = useMemo(
    () =>
      imdbAwards.filter((award) =>
        isMovieCatalog
          ? award !== 'emmy'
          : award !== 'best_picture_oscar' && award !== 'best_director_oscar'
      ),
    [imdbAwards, isMovieCatalog]
  );

  const visibleRankedLists = useMemo(
    () => (isMovieCatalog ? imdbRankedLists : []),
    [imdbRankedLists, isMovieCatalog]
  );

  const imdbGenreObjects = useMemo(() => imdbGenres.map((g) => ({ id: g, name: g })), [imdbGenres]);

  const plotValues = useMemo(() => {
    if (Array.isArray(filters.plot)) return filters.plot;
    if (typeof filters.plot === 'string' && filters.plot.trim()) return [filters.plot.trim()];
    return [];
  }, [filters.plot]);

  const filmingLocationValues = useMemo(() => {
    if (Array.isArray(filters.filmingLocations)) return filters.filmingLocations;
    if (typeof filters.filmingLocations === 'string' && filters.filmingLocations.trim()) {
      return [filters.filmingLocations.trim()];
    }
    return [];
  }, [filters.filmingLocations]);

  const rankInputValue =
    rankInputDraft ?? (filters.rankedListMaxRank ? String(filters.rankedListMaxRank) : '');

  const activeIncludeRankType = filters.rankedList || (filters.rankedLists || [])[0] || '';
  const activeExcludeRankType = (filters.excludeRankedLists || [])[0] || '';
  const activeRankMode = activeExcludeRankType ? 'EXCLUDE' : 'INCLUDE';
  const activeRankType =
    activeExcludeRankType ||
    activeIncludeRankType ||
    visibleRankedLists.find((list) => list.value === 'TOP_250')?.value ||
    visibleRankedLists[0]?.value ||
    '';

  const rankModeOptions = useMemo(
    () => [
      { value: 'INCLUDE', label: 'Include' },
      { value: 'EXCLUDE', label: 'Exclude' },
    ],
    []
  );

  const rankedRangePresets = useMemo(
    () => [
      { value: 100, label: '100' },
      { value: 250, label: '250' },
      { value: 1000, label: '1000' },
      { value: 5000, label: '5000' },
    ],
    []
  );

  const applyRankConstraint = useCallback(
    ({ mode, type, maxRank }) => {
      if (!isMovieCatalog || !type) return;

      if (mode === 'EXCLUDE') {
        onFiltersChange('rankedList', undefined);
        onFiltersChange('rankedLists', []);
        onFiltersChange('excludeRankedLists', [type]);
      } else {
        onFiltersChange('rankedList', type);
        onFiltersChange('rankedLists', [type]);
        onFiltersChange('excludeRankedLists', []);
      }

      if (typeof maxRank === 'number' && Number.isFinite(maxRank)) {
        onFiltersChange('rankedListMaxRank', Math.max(Math.trunc(maxRank), 1));
      }
    },
    [isMovieCatalog, onFiltersChange]
  );

  const handleTriStateGenreClick = useCallback(
    (genreId) => {
      const included = filters.genres || [];
      const excluded = filters.excludeGenres || [];
      const isIncluded = included.includes(genreId);
      const isExcluded = excluded.includes(genreId);
      let newIncluded, newExcluded;
      if (isIncluded) {
        newIncluded = included.filter((id) => id !== genreId);
        newExcluded = [...excluded, genreId];
      } else if (isExcluded) {
        newIncluded = included;
        newExcluded = excluded.filter((id) => id !== genreId);
      } else {
        newIncluded = [...included, genreId];
        newExcluded = excluded;
      }
      onFiltersChange('genres', newIncluded);
      onFiltersChange('excludeGenres', newExcluded);
    },
    [filters.genres, filters.excludeGenres, onFiltersChange]
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

  const handleAddKeyword = () => {
    const kw = keywordInput.trim();
    if (!kw) return;
    const current = filters.keywords || [];
    if (!current.includes(kw)) {
      onFiltersChange('keywords', [...current, kw]);
    }
    setKeywordInput('');
  };

  const handleExcludeKeywordToggle = useCallback(
    (keyword) => {
      const current = filters.excludeKeywords || [];
      const next = current.includes(keyword)
        ? current.filter((k) => k !== keyword)
        : [...current, keyword];
      onFiltersChange('excludeKeywords', next);
    },
    [filters.excludeKeywords, onFiltersChange]
  );

  const handleAddExcludeKeyword = () => {
    const kw = excludeKeywordInput.trim();
    if (!kw) return;
    const current = filters.excludeKeywords || [];
    if (!current.includes(kw)) {
      onFiltersChange('excludeKeywords', [...current, kw]);
    }
    setExcludeKeywordInput('');
  };

  const handleEnterToAdd = useCallback((event, addFn) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    addFn();
  }, []);

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

  const handleRatingChange = useCallback(
    (range) => {
      onFiltersChange('imdbRatingMin', range[0] === 0 ? undefined : range[0]);
      onFiltersChange('imdbRatingMax', range[1] === 10 ? undefined : range[1]);
    },
    [onFiltersChange]
  );

  const handleVotesChange = useCallback(
    (range) => {
      onFiltersChange('totalVotesMin', range[0] === 0 ? undefined : range[0]);
      onFiltersChange('totalVotesMax', range[1] === 1000000 ? undefined : range[1]);
    },
    [onFiltersChange]
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
      const current = filters.imdbCountries || [];
      if (!current.includes(value)) {
        onFiltersChange('imdbCountries', [...current, value]);
      }
    },
    [filters.imdbCountries, onFiltersChange]
  );

  const handleRemoveCountry = useCallback(
    (country) => {
      onFiltersChange(
        'imdbCountries',
        (filters.imdbCountries || []).filter((c) => c !== country)
      );
    },
    [filters.imdbCountries, onFiltersChange]
  );

  const availableLanguages = useMemo(
    () => languages.filter((l) => !(filters.languages || []).includes(l.iso_639_1)),
    [languages, filters.languages]
  );

  const availableCountries = useMemo(
    () => countries.filter((c) => !(filters.imdbCountries || []).includes(c.iso_3166_1)),
    [countries, filters.imdbCountries]
  );

  const sortOrderOptions = useMemo(
    () => [
      { value: 'ASC', label: 'Ascending' },
      { value: 'DESC', label: 'Descending' },
    ],
    []
  );

  const certificateCountryOptions = useMemo(
    () =>
      countries
        .map((c) => ({
          value: c.iso_3166_1,
          label: c.english_name || c.iso_3166_1,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [countries]
  );

  const selectedCertCountry = filters.certificateCountry || '';
  const availableCertificates = useMemo(() => {
    if (!selectedCertCountry || !imdbCertificateRatings[selectedCertCountry]) return [];

    const raw = imdbCertificateRatings[selectedCertCountry];
    const ratings = Array.isArray(raw) ? raw : raw?.ratings || [];

    return ratings.map((r) => ({
      value: `${selectedCertCountry}:${r}`,
      label: r,
    }));
  }, [selectedCertCountry, imdbCertificateRatings]);

  const commitRankedListMaxRank = (rawValue) => {
    const trimmed = String(rawValue ?? '').trim();
    if (!trimmed) {
      onFiltersChange('rankedListMaxRank', undefined);
      setRankInputDraft(null);
      return;
    }
    const parsed = parseInt(trimmed, 10);
    if (Number.isNaN(parsed)) {
      onFiltersChange('rankedListMaxRank', undefined);
      setRankInputDraft(null);
      return;
    }

    applyRankConstraint({ mode: activeRankMode, type: activeRankType });

    const normalized = Math.max(parsed, 1);
    onFiltersChange('rankedListMaxRank', normalized);
    setRankInputDraft(null);
  };

  const handleRankedListMaxRankChange = (rawValue) => {
    const next = String(rawValue ?? '');
    if (!/^\d*$/.test(next)) return;

    setRankInputDraft(next);

    const trimmed = next.trim();
    if (!trimmed) {
      onFiltersChange('rankedListMaxRank', undefined);
      return;
    }

    const parsed = parseInt(trimmed, 10);
    if (Number.isNaN(parsed)) {
      onFiltersChange('rankedListMaxRank', undefined);
      return;
    }

    applyRankConstraint({ mode: activeRankMode, type: activeRankType });

    onFiltersChange('rankedListMaxRank', Math.max(parsed, 1));
  };

  const addArrayFilterValue = useCallback(
    (key, value, currentValues) => {
      const normalized = value.trim();
      if (!normalized) return;
      if (currentValues.includes(normalized)) return;
      onFiltersChange(key, [...currentValues, normalized]);
    },
    [onFiltersChange]
  );

  const removeArrayFilterValue = useCallback(
    (key, value, currentValues) => {
      const next = currentValues.filter((v) => v !== value);
      onFiltersChange(key, next.length > 0 ? next : undefined);
    },
    [onFiltersChange]
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
      {/* <div className="filter-section p-4 mb-4 rounded-lg border border-white/5 bg-white/5">
        <div className="filter-group mb-0">
          <LabelWithTooltip
            label="Custom IMDb List ID"
            tooltip="Optional: Enter an IMDb list ID (e.g., ls597789139) to fetch items exclusively from that list. Other filters will be disabled."
          />
          <input
            type="text"
            className="input"
            placeholder="e.g. ls597789139"
            value={filters.imdbListId || ''}
            onChange={(e) => {
              const val = e.target.value;
              onFiltersChange('imdbListId', val || undefined);
              onFiltersChange('listType', val ? 'imdb_list' : 'discover');
            }}
          />
        </div>
      </div> */}

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
            <LabelWithTooltip label="Sort By" tooltip="How to order your IMDb results." />
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
                      return [
                        'tvSeries',
                        'tvMiniSeries',
                        'tvSpecial',
                        'tvEpisode',
                        'tvShort',
                        'podcastSeries',
                        'podcastEpisode',
                      ].includes(tt.value);
                    }
                    return [
                      'movie',
                      'tvMovie',
                      'short',
                      'video',
                      'videoGame',
                      'musicVideo',
                    ].includes(tt.value);
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
          <RangeSlider
            label="IMDb Rating"
            tooltip="Filter by IMDb user rating (0–10). Select a range to surface specific scores."
            min={0}
            max={10}
            step={0.1}
            value={[filters.imdbRatingMin ?? 0, filters.imdbRatingMax ?? 10]}
            onChange={handleRatingChange}
            formatValue={(v) => (v === 0 ? '0' : v === 10 ? '10' : v.toFixed(1))}
            showInputs
          />
        </div>

        <div className="filter-spacer">
          <RangeSlider
            label="Vote Count"
            tooltip="Filter by number of user ratings. Use this to find popular breakout hits or obscure hidden gems."
            min={0}
            max={1000000}
            step={1000}
            value={[filters.totalVotesMin ?? 0, filters.totalVotesMax ?? 1000000]}
            onChange={handleVotesChange}
            formatValue={(v) => (v === 0 ? '0' : v === 1000000 ? '1M+' : v.toLocaleString())}
            showInputs
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
                    <button
                      key={lang}
                      type="button"
                      className="genre-chip selected imdb-chip--clickable"
                      onClick={() => handleRemoveLanguage(lang)}
                      aria-label={`Remove ${langObj?.english_name || lang} language filter`}
                    >
                      {langObj?.english_name || lang} ×
                    </button>
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
            {(filters.imdbCountries || []).length > 0 && (
              <div className="imdb-selected-chips">
                {filters.imdbCountries.map((country) => {
                  const countryObj = countries.find((c) => c.iso_3166_1 === country);
                  return (
                    <button
                      key={country}
                      type="button"
                      className="genre-chip selected imdb-chip--clickable"
                      onClick={() => handleRemoveCountry(country)}
                      aria-label={`Remove ${countryObj?.english_name || country} country filter`}
                    >
                      {countryObj?.english_name || country} ×
                    </button>
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
        badgeCount={(filters.genres || []).length + (filters.excludeGenres || []).length}
      >
        <GenreSelector
          genres={imdbGenreObjects}
          selectedGenres={filters.genres || []}
          excludedGenres={filters.excludeGenres || []}
          genreMatchMode="any"
          onInclude={handleTriStateGenreClick}
          onExclude={handleTriStateGenreClick}
          onClear={handleTriStateGenreClick}
          onSetMatchMode={() => {}}
          showMatchMode={false}
          loading={false}
          onRefresh={() => {}}
        />
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
            <LabelWithTooltip
              label="Release Date From"
              tooltip="Include titles released on or after this date."
            />
            <input
              id="imdb-date-from"
              type="date"
              className="input"
              value={filters.releaseDateStart || ''}
              onChange={(e) => onFiltersChange('releaseDateStart', e.target.value || undefined)}
            />
          </div>
          <div className="filter-group">
            <LabelWithTooltip
              label="Release Date To"
              tooltip="Include titles released on or before this date."
            />
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

      <FilterSection
        id="keywords"
        title="Keywords"
        description="Type any keyword to filter by."
        icon={Tag}
        isOpen={localExpandedSections.keywords}
        onToggle={toggleSection}
        badgeCount={(filters.keywords || []).length + (filters.excludeKeywords || []).length}
      >
        <div className="filter-group mb-4">
          <LabelWithTooltip label="Include Keywords" tooltip="Results must match these keywords." />
          <div>
            <input
              type="text"
              className="input"
              placeholder="e.g. superhero, survival..."
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
              onKeyDown={(e) => handleEnterToAdd(e, handleAddKeyword)}
            />
            <span className="filter-label-hint">Press Enter to add</span>
          </div>
          {(filters.keywords || []).length > 0 && (
            <div className="imdb-selected-chips mt-3" style={{ marginTop: '12px' }}>
              {filters.keywords.map((kw) => (
                <button
                  key={`include-${kw}`}
                  type="button"
                  className="genre-chip selected imdb-chip--clickable flex items-center gap-1"
                  onClick={() => handleKeywordToggle(kw)}
                  title={`Remove ${kw}`}
                >
                  {kw} <span className="opacity-70">&times;</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="filter-group mt-6">
          <LabelWithTooltip
            label="Exclude Keywords"
            tooltip="Results must NOT match these keywords."
          />
          <div>
            <input
              type="text"
              className="input"
              placeholder="e.g. anime, musical..."
              value={excludeKeywordInput}
              onChange={(e) => setExcludeKeywordInput(e.target.value)}
              onKeyDown={(e) => handleEnterToAdd(e, handleAddExcludeKeyword)}
            />
            <span className="filter-label-hint">Press Enter to add</span>
          </div>
          {(filters.excludeKeywords || []).length > 0 && (
            <div className="imdb-selected-chips mt-3" style={{ marginTop: '12px' }}>
              {filters.excludeKeywords.map((kw) => (
                <button
                  key={`exclude-${kw}`}
                  type="button"
                  className="genre-chip excluded imdb-chip--clickable flex items-center gap-1"
                  style={{
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    color: '#ef4444',
                    borderColor: 'rgba(239, 68, 68, 0.2)',
                  }}
                  onClick={() => handleExcludeKeywordToggle(kw)}
                  title={`Remove ${kw}`}
                >
                  {kw} <span className="opacity-70">&times;</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </FilterSection>

      {/* Awards section hidden temporarily — re-enable by removing AWARDS_HIDDEN */}
      {!AWARDS_HIDDEN && imdbAwards.length > 0 && (
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
                {visibleAwards.map((award) => {
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
                {visibleAwards.map((award) => {
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

      {/* People & Studios */}
      <FilterSection
        id="people"
        title="People & Studios"
        description="Filter by credited people and production companies"
        icon={Users}
        isOpen={localExpandedSections.people}
        onToggle={toggleSection}
        badgeCount={
          (filters.creditedNames || []).length +
          (filters.companies || []).length +
          selectedImdbExcludeCompanies.length
        }
      >
        <div className="filter-group mb-4">
          <LabelWithTooltip
            label="Credited People"
            tooltip="Search for actors, directors, writers etc. by name using IMDb data."
          />
          {onSearchImdbPeople && (
            <SearchInput
              onSearch={onSearchImdbPeople}
              onSelect={onSelectImdbPerson}
              selectedItems={selectedImdbPeople}
              onRemove={onRemoveImdbPerson}
              placeholder="Search people on IMDb..."
              type="person"
              multiple={true}
            />
          )}
        </div>

        <div className="filter-group mt-6">
          <LabelWithTooltip
            label="Production Companies"
            tooltip="Search for production companies, studios, and distributors."
          />
          {onSearchImdbCompanies && (
            <SearchInput
              onSearch={onSearchImdbCompanies}
              onSelect={onSelectImdbCompany}
              selectedItems={selectedImdbCompanies}
              onRemove={onRemoveImdbCompany}
              placeholder="Search companies on IMDb..."
              type="company"
              multiple={true}
            />
          )}
        </div>

        <div className="filter-group mt-6">
          <LabelWithTooltip
            label="Exclude Companies"
            tooltip="Exclude titles made by specific production companies or studios."
          />
          {onSearchImdbCompanies && (
            <SearchInput
              onSearch={onSearchImdbCompanies}
              onSelect={onSelectImdbExcludeCompany}
              selectedItems={selectedImdbExcludeCompanies}
              onRemove={onRemoveImdbExcludeCompany}
              placeholder="Exclude companies on IMDb..."
              type="company"
              multiple={true}
            />
          )}
        </div>
      </FilterSection>

      {/* In Theatres (movie-only) */}
      {isMovieCatalog && (
        <FilterSection
          id="theatres"
          title="In Theatres"
          description="Find titles currently in theatres near a city"
          icon={MapPin}
          isOpen={localExpandedSections.theatres}
          onToggle={toggleSection}
          badgeCount={filters.inTheatersLat ? 1 : 0}
        >
          <div className="filter-group mb-4">
            <LabelWithTooltip
              label="City"
              tooltip="Search for a city to find titles currently showing in theatres nearby."
            />
            {onSearchCities && (
              <>
                <SearchInput
                  onSearch={onSearchCities}
                  onSelect={(city) => {
                    if (onSelectCity) onSelectCity(city);
                  }}
                  selectedItems={selectedCity ? [selectedCity] : []}
                  onRemove={() => {
                    if (onClearCity) onClearCity();
                  }}
                  placeholder="Search cities..."
                  type="company"
                  multiple={false}
                />
                {selectedCity && (
                  <p className="text-xs text-gray-400 mt-2">
                    Selected: {selectedCity.name}
                    {selectedCity.knownFor ? ` (${selectedCity.knownFor})` : ''}
                  </p>
                )}
              </>
            )}
          </div>

          <div className="filter-group">
            <LabelWithTooltip
              label="Radius (km)"
              tooltip="Search radius around the selected city in kilometers. Default is 50km."
            />
            <SingleSlider
              min={1}
              max={500}
              step={1}
              value={filters.inTheatersRadius ? Math.round(filters.inTheatersRadius / 1000) : 50}
              onChange={(val) => onFiltersChange('inTheatersRadius', val * 1000)}
              formatValue={(v) => `${v} km`}
              disabled={!filters.inTheatersLat}
            />
          </div>
        </FilterSection>
      )}

      {/* Certificates */}
      {certificateCountryOptions.length > 0 && (
        <FilterSection
          id="certificates"
          title="Certificates"
          description="Filter by content rating certificates (PG, R, etc.)"
          icon={Shield}
          isOpen={localExpandedSections.certificates}
          onToggle={toggleSection}
          badgeCount={(filters.certificates || []).length}
        >
          <CertificationCountryFilter
            countryOptions={certificateCountryOptions}
            countryValue={selectedCertCountry}
            onCountryChange={(value) => onFiltersChange('certificateCountry', value || undefined)}
            ratingOptions={availableCertificates}
            ratingsValue={filters.certificates || []}
            onRatingsChange={(value) => onFiltersChange('certificates', value)}
            countryLabel="Country"
            countryTooltip="Select a country to see its content rating options."
            ratingsLabel="Ratings"
            ratingsTooltip="Content rating certificates available for the selected country."
            countryPlaceholder="Select country..."
            ratingsPlaceholder="Select ratings..."
            clearRatingsOnCountryChange={true}
          />
        </FilterSection>
      )}

      {/* Ranked Lists (Phase 2) */}
      {visibleRankedLists.length > 0 && (
        <FilterSection
          id="rankedLists"
          title="Ranked Lists"
          description="Filter by IMDb curated ranking lists (Top Rated / Bottom Rated)."
          icon={ListOrdered}
          isOpen={localExpandedSections.rankedLists}
          onToggle={toggleSection}
          badgeCount={
            (filters.rankedList ? 1 : 0) +
            (filters.rankedLists || []).length +
            (filters.excludeRankedLists || []).length +
            (filters.rankedListMaxRank ? 1 : 0)
          }
        >
          {!MAX_RANK_HIDDEN && (
            <div className="filter-group">
              <LabelWithTooltip
                label="Preset Ranges"
                tooltip="Quickly autofill the number of ranked titles to include or exclude."
              />
              <div className="runtime-presets filter-spacer-sm">
                {rankedRangePresets.map((preset) => (
                  <button
                    key={`rank-preset-${preset.value}`}
                    type="button"
                    className={`date-preset ${Number(filters.rankedListMaxRank) === preset.value ? 'active' : ''}`}
                    onClick={() => {
                      applyRankConstraint({
                        mode: activeRankMode,
                        type: activeRankType,
                        maxRank: preset.value,
                      });
                      setRankInputDraft(null);
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
                <button
                  type="button"
                  className="date-preset"
                  onClick={() => {
                    onFiltersChange('rankedListMaxRank', undefined);
                    setRankInputDraft(null);
                  }}
                >
                  Any
                </button>
              </div>

              <LabelWithTooltip
                label="Mode"
                tooltip="Choose whether titles in the selected ranked list should be included or excluded."
              />
              <SearchableSelect
                options={rankModeOptions}
                value={activeRankMode}
                onChange={(value) => {
                  const mode = value === 'EXCLUDE' ? 'EXCLUDE' : 'INCLUDE';
                  applyRankConstraint({ mode, type: activeRankType });
                }}
                placeholder="Select mode..."
                searchPlaceholder="Search mode..."
                labelKey="label"
                valueKey="value"
                allowClear={false}
              />

              <LabelWithTooltip
                label="Rank Type"
                tooltip="Choose which ranked list type this filter should use."
              />
              <SearchableSelect
                options={visibleRankedLists}
                value={activeRankType}
                onChange={(value) => {
                  const type = value || visibleRankedLists[0]?.value;
                  if (!type) return;
                  applyRankConstraint({ mode: activeRankMode, type });
                }}
                placeholder="Select list type..."
                searchPlaceholder="Search list type..."
                labelKey="label"
                valueKey="value"
                allowClear={false}
              />

              <LabelWithTooltip
                label="Number of Movies"
                tooltip="Limit the ranked list by position count (e.g. 100 means top/bottom 100)."
              />
              <input
                type="text"
                inputMode="numeric"
                className="input"
                placeholder="e.g. 100"
                value={rankInputValue}
                onChange={(e) => handleRankedListMaxRankChange(e.target.value)}
                onBlur={(e) => commitRankedListMaxRank(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitRankedListMaxRank(e.currentTarget.value);
                  }
                }}
              />
              <p className="text-xs text-gray-400 mt-2">Allowed range: 1 and above</p>
            </div>
          )}
        </FilterSection>
      )}

      {/* Text Search (Phase 3) */}
      <FilterSection
        id="textSearch"
        title="Text Search"
        description="Search in plot summaries and filming locations"
        icon={FileText}
        isOpen={localExpandedSections.textSearch}
        onToggle={toggleSection}
        badgeCount={plotValues.length + filmingLocationValues.length}
      >
        <div className="filter-group mb-4">
          <LabelWithTooltip
            label="Plot Keywords"
            tooltip="Search for titles containing these words in their plot summary."
          />
          <div>
            <input
              type="text"
              className="input"
              placeholder="Type and press Enter..."
              value={plotInput}
              onChange={(e) => setPlotInput(e.target.value)}
              onKeyDown={(e) =>
                handleEnterToAdd(e, () => {
                  addArrayFilterValue('plot', plotInput, plotValues);
                  setPlotInput('');
                })
              }
            />
            <span className="filter-label-hint">Press Enter to add</span>
          </div>
          {plotValues.length > 0 && (
            <div className="imdb-selected-chips mt-3" style={{ marginTop: '12px' }}>
              {plotValues.map((value) => (
                <button
                  key={`plot-${value}`}
                  type="button"
                  className="genre-chip selected imdb-chip--clickable flex items-center gap-1"
                  onClick={() => removeArrayFilterValue('plot', value, plotValues)}
                  title={`Remove ${value}`}
                >
                  {value} <span className="opacity-70">&times;</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="filter-group">
          <LabelWithTooltip
            label="Filming Locations"
            tooltip="Search for titles filmed at a specific location."
          />
          <div>
            <input
              type="text"
              className="input"
              placeholder="Type and press Enter..."
              value={filmingInput}
              onChange={(e) => setFilmingInput(e.target.value)}
              onKeyDown={(e) =>
                handleEnterToAdd(e, () => {
                  addArrayFilterValue('filmingLocations', filmingInput, filmingLocationValues);
                  setFilmingInput('');
                })
              }
            />
            <span className="filter-label-hint">Press Enter to add</span>
          </div>
          {filmingLocationValues.length > 0 && (
            <div className="imdb-selected-chips mt-3" style={{ marginTop: '12px' }}>
              {filmingLocationValues.map((value) => (
                <button
                  key={`filming-${value}`}
                  type="button"
                  className="genre-chip selected imdb-chip--clickable flex items-center gap-1"
                  onClick={() =>
                    removeArrayFilterValue('filmingLocations', value, filmingLocationValues)
                  }
                  title={`Remove ${value}`}
                >
                  {value} <span className="opacity-70">&times;</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </FilterSection>

      {/* Advanced / withData (Phase 3) */}
      {imdbWithDataOptions.length > 0 && (
        <FilterSection
          id="advanced"
          title="Advanced Filters"
          description="Explicit content and data availability filters"
          icon={Database}
          isOpen={localExpandedSections.advanced}
          onToggle={toggleSection}
          badgeCount={(filters.explicitContent ? 1 : 0) + (filters.withData || []).length}
        >
          <div className="filter-group mb-4">
            <LabelWithTooltip
              label="Include Explicit Content"
              tooltip="Toggle to include adult/explicit content in IMDb results."
            />
            <label className="sidebar-checkbox">
              <input
                type="checkbox"
                checked={filters.explicitContent === 'INCLUDE'}
                onChange={(e) =>
                  onFiltersChange('explicitContent', e.target.checked ? 'INCLUDE' : undefined)
                }
              />
              <span>Include explicit titles</span>
            </label>
          </div>

          <div className="filter-group">
            <LabelWithTooltip
              label="Must Have Data"
              tooltip="Only include titles that have specific data available."
            />
            <div className="imdb-chip-wrap">
              {imdbWithDataOptions.map((opt) => {
                const selected = (filters.withData || []).includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    className={`genre-chip ${selected ? 'selected' : ''}`}
                    onClick={() => {
                      const current = filters.withData || [];
                      const next = selected
                        ? current.filter((v) => v !== opt.value)
                        : [...current, opt.value];
                      onFiltersChange('withData', next);
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        </FilterSection>
      )}
    </>
  );
});
