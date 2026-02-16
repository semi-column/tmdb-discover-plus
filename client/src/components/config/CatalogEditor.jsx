import {
  Award,
  Calendar,
  Eye,
  Film,
  Loader,
  Play,
  Settings,
  Sparkles,
  Tv,
  Users,
} from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActiveFiltersBar } from './catalog/ActiveFiltersBar';
import { CatalogImportExport } from './catalog/CatalogImportExport';
import { CatalogPreview } from './catalog/CatalogPreview';
import { FilterPanel } from './catalog/FilterPanel';
import { FilterSection } from './catalog/FilterSection';
import { GenreSelector } from './catalog/GenreSelector';
import { ImdbFilterPanel } from './catalog/ImdbFilterPanel';
import { OptionsPanel } from './catalog/OptionsPanel';
import { PeopleFilters } from './catalog/PeopleFilters';
import { ReleaseFilters } from './catalog/ReleaseFilters';
import { StreamFilters } from './catalog/StreamFilters';

import { useActiveFilters } from '../../hooks/useActiveFilters';
import { useCatalogSync } from '../../hooks/useCatalogSync';
import { useResolvedFilters } from '../../hooks/useResolvedFilters';
import { useWatchProviders } from '../../hooks/useWatchProviders';

const DEFAULT_CATALOG = {
  name: '',
  type: 'movie',
  filters: {
    genres: [],
    excludeGenres: [],
    sortBy: 'popularity.desc',
    imdbOnly: false,
    voteCountMin: 0,
  },
  enabled: true,
};

export const CatalogEditor = memo(function CatalogEditor({
  catalog,
  genres = { movie: [], series: [] },
  genresLoading = false,
  refreshGenres = () => {},
  originalLanguages = [],
  countries = [],
  sortOptions = { movie: [], series: [] },
  releaseTypes = [],
  tvStatuses = [],
  tvTypes = [],
  monetizationTypes = [],
  certifications = { movie: {}, series: {} },
  watchRegions = [],
  tvNetworks = [],
  onUpdate,
  onPreview,
  onPreviewImdb,
  imdbGenres = [],
  imdbKeywords = [],
  imdbAwards = [],
  imdbSortOptions = [],
  imdbTitleTypes = [],
  preferences = {},
  searchPerson,
  searchCompany,
  searchKeyword,
  searchTVNetworks,
  getPersonById,
  getCompanyById,
  getKeywordById,
  getNetworkById,
  getWatchProviders,
  addToast,
  imdbEnabled = false,
}) {
  const safeGenres =
    genres && typeof genres === 'object' && !Array.isArray(genres)
      ? genres
      : { movie: [], series: [] };
  const safeOriginalLanguages = Array.isArray(originalLanguages) ? originalLanguages : [];
  const safeCountries = Array.isArray(countries) ? countries : [];
  const safeSortOptions =
    sortOptions && typeof sortOptions === 'object' && !Array.isArray(sortOptions)
      ? sortOptions
      : { movie: [], series: [] };
  const safeTvStatuses = Array.isArray(tvStatuses) ? tvStatuses : [];
  const safeTvTypes = Array.isArray(tvTypes) ? tvTypes : [];
  const safeMonetizationTypes = Array.isArray(monetizationTypes) ? monetizationTypes : [];
  const safeCertifications =
    certifications && typeof certifications === 'object' && !Array.isArray(certifications)
      ? certifications
      : { movie: {}, series: {} };
  const safeWatchRegions = Array.isArray(watchRegions) ? watchRegions : [];

  const [localCatalog, setLocalCatalog] = useState(catalog || DEFAULT_CATALOG);
  const [previewData, setPreviewData] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  const [tvNetworkOptions, setTVNetworkOptions] = useState(tvNetworks || []);
  const [expandedSections, setExpandedSections] = useState({
    basic: false,
    genres: false,
    filters: false,
    release: false,
    streaming: false,
    people: false,
    options: false,
  });

  const prevCatalogIdRef = useRef(null);
  const {
    selectedPeople,
    setSelectedPeople,
    selectedCompanies,
    setSelectedCompanies,
    selectedKeywords,
    setSelectedKeywords,
    excludeKeywords,
    setExcludeKeywords,
    excludeCompanies,
    setExcludeCompanies,
    selectedNetworks,
  } = useResolvedFilters({
    catalog,
    getPersonById,
    searchPerson,
    getCompanyById,
    searchCompany,
    getKeywordById,
    searchKeyword,
    getNetworkById,
  });

  const { watchProviders } = useWatchProviders({
    type: localCatalog?.type,
    region: localCatalog?.filters?.watchRegion,
    getWatchProviders,
  });

  const mergedLocalCatalog = useMemo(
    () => ({
      ...localCatalog,
      filters: {
        ...localCatalog.filters,
        withPeople: selectedPeople.map((p) => p.id).join(',') || undefined,
        withCompanies: selectedCompanies.map((c) => c.id).join(',') || undefined,
        withKeywords: selectedKeywords.map((k) => k.id).join(',') || undefined,
        excludeKeywords: excludeKeywords.map((k) => k.id).join(',') || undefined,
        excludeCompanies: excludeCompanies.map((c) => c.id).join(',') || undefined,
      },
    }),
    [
      localCatalog,
      selectedPeople,
      selectedCompanies,
      selectedKeywords,
      excludeKeywords,
      excludeCompanies,
    ]
  );

  useCatalogSync({ localCatalog: mergedLocalCatalog, catalog, onUpdate });

  const { activeFilters, clearFilter, clearAllFilters } = useActiveFilters({
    localCatalog,
    setLocalCatalog,
    genres: safeGenres,
    sortOptions: safeSortOptions,
    originalLanguages: safeOriginalLanguages,
    countries: safeCountries,
    tvStatuses: safeTvStatuses,
    tvTypes: safeTvTypes,
    watchRegions: safeWatchRegions,
    monetizationTypes: safeMonetizationTypes,
    selectedPeople,
    setSelectedPeople,
    selectedCompanies,
    setSelectedCompanies,
    selectedKeywords,
    setSelectedKeywords,
    excludeKeywords,
    setExcludeKeywords,
    excludeCompanies,
    setExcludeCompanies,
  });

  useEffect(() => {
    setTVNetworkOptions((prev) => {
      const byId = new Map();
      (prev || []).forEach((n) => {
        if (n && n.id != null) byId.set(String(n.id), n);
      });
      (tvNetworks || []).forEach((n) => {
        if (n && n.id != null) {
          const key = String(n.id);
          const existing = byId.get(key);
          const existingHasProperName = existing && existing.name && existing.name !== key;
          const newHasProperName = n.name && n.name !== key;
          if (!existing || (!existingHasProperName && newHasProperName)) {
            byId.set(key, n);
          }
        }
      });
      return Array.from(byId.values());
    });
  }, [tvNetworks]);

  const handleTVNetworkSearch = useCallback(
    async (query) => {
      if (!searchTVNetworks) return;
      const q = String(query || '').trim();
      if (q.length < 2) return;
      try {
        const results = await searchTVNetworks(q);
        if (!Array.isArray(results) || results.length === 0) return;
        setTVNetworkOptions((prev) => {
          const byId = new Map();
          (prev || []).forEach((n) => {
            if (n && n.id != null) byId.set(String(n.id), n);
          });
          results.forEach((n) => {
            if (n && n.id != null) {
              const key = String(n.id);
              const existing = byId.get(key);
              const existingHasProperName = existing && existing.name && existing.name !== key;
              const newHasProperName = n.name && n.name !== key;
              if (!existing || (!existingHasProperName && newHasProperName) || newHasProperName) {
                byId.set(key, n);
              }
            }
          });
          return Array.from(byId.values());
        });
      } catch (e) {
        void e;
      }
    },
    [searchTVNetworks]
  );

  const catalogIdForSync = catalog?._id;
  const catalogRef = useRef(catalog);
  catalogRef.current = catalog;

  useEffect(() => {
    const currentCatalog = catalogRef.current;
    if (currentCatalog) {
      setLocalCatalog(currentCatalog);
      const prevId = prevCatalogIdRef.current;
      const newId = currentCatalog._id || null;
      if (prevId !== newId) setPreviewData(null);
      prevCatalogIdRef.current = newId;
    } else {
      setLocalCatalog(DEFAULT_CATALOG);
      setPreviewData(null);
      prevCatalogIdRef.current = null;
    }
  }, [catalogIdForSync]);

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

  const handleFiltersChange = useCallback((key, value) => {
    setLocalCatalog((prev) => {
      const current = prev || DEFAULT_CATALOG;
      return { ...current, filters: { ...current.filters, [key]: value } };
    });
  }, []);

  const handleNameChange = useCallback((name) => {
    if (name.length > 50) return;
    setLocalCatalog((prev) => ({ ...prev, name }));
  }, []);

  const handleTypeChange = useCallback(
    (type) => {
      let result;
      setLocalCatalog((prev) => {
        const isNextMovie = type === 'movie';
        const isImdb = prev.source === 'imdb';
        const updated = {
          ...prev,
          type,
          filters: {
            ...prev.filters,
            genres: [],
            excludeGenres: [],
            sortBy: isImdb ? 'POPULARITY' : 'popularity.desc',
            ...(isNextMovie
              ? {
                  airDateFrom: undefined,
                  airDateTo: undefined,
                  firstAirDateFrom: undefined,
                  firstAirDateTo: undefined,
                  firstAirDateYear: undefined,
                  includeNullFirstAirDates: undefined,
                  screenedTheatrically: undefined,
                  timezone: undefined,
                }
              : {
                  includeVideo: undefined,
                  primaryReleaseYear: undefined,
                  certifications: undefined,
                  certificationMin: undefined,
                  certificationMax: undefined,
                  certificationCountry: undefined,
                }),
          },
        };
        result = updated;
        return updated;
      });
      if (catalog?._id && result) onUpdate(catalog._id, result);
    },
    [catalog?._id, onUpdate]
  );

  const handleSourceChange = useCallback(
    (source) => {
      let result;
      setLocalCatalog((prev) => {
        const isNextImdb = source === 'imdb';
        const cleanedFilters = { ...prev.filters };

        if (isNextImdb) {
          delete cleanedFilters.voteCountMin;
          delete cleanedFilters.certifications;
          delete cleanedFilters.watchProviders;
          delete cleanedFilters.watchRegion;
          delete cleanedFilters.withPeople;
          delete cleanedFilters.withCompanies;
          delete cleanedFilters.withKeywords;
          delete cleanedFilters.withNetworks;
          delete cleanedFilters.monetizationType;
          delete cleanedFilters.releaseType;
          delete cleanedFilters.tvStatus;
          delete cleanedFilters.tvType;
          delete cleanedFilters.originalLanguage;
          delete cleanedFilters.yearRange;
          delete cleanedFilters.datePreset;
          delete cleanedFilters.imdbOnly;
        } else {
          delete cleanedFilters.keywords;
          delete cleanedFilters.awardsWon;
          delete cleanedFilters.awardsNominated;
          delete cleanedFilters.imdbListId;
          delete cleanedFilters.types;
          delete cleanedFilters.imdbRatingMin;
          delete cleanedFilters.totalVotesMin;
          delete cleanedFilters.releaseDateStart;
          delete cleanedFilters.releaseDateEnd;
          delete cleanedFilters.runtimeMin;
          delete cleanedFilters.runtimeMax;
          delete cleanedFilters.languages;
          delete cleanedFilters.countries;
          delete cleanedFilters.sortOrder;
        }

        const updated = {
          ...prev,
          source: isNextImdb ? 'imdb' : 'tmdb',
          filters: {
            ...cleanedFilters,
            sortBy: isNextImdb ? 'POPULARITY' : 'popularity.desc',
            listType: 'discover',
            genres: [],
            excludeGenres: [],
          },
        };
        result = updated;
        return updated;
      });
      if (catalog?._id && result) onUpdate(catalog._id, result);
    },
    [catalog?._id, onUpdate]
  );

  const handleTriStateGenreClick = useCallback((genreId) => {
    setLocalCatalog((prev) => {
      const current = prev || DEFAULT_CATALOG;
      const included = current.filters?.genres || [];
      const excluded = current.filters?.excludeGenres || [];
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
      return {
        ...current,
        filters: { ...current.filters, genres: newIncluded, excludeGenres: newExcluded },
      };
    });
  }, []);

  const loadPreview = async () => {
    if (!localCatalog) return;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      let data;
      if (localCatalog.source === 'imdb' && onPreviewImdb) {
        data = await onPreviewImdb(localCatalog.type || 'movie', localCatalog.filters || {});
      } else {
        const filters = {
          ...localCatalog.filters,
          displayLanguage: preferences?.defaultLanguage,
          withPeople: selectedPeople.map((p) => p.id).join(',') || undefined,
          withCompanies: selectedCompanies.map((c) => c.id).join(',') || undefined,
          withKeywords: selectedKeywords.map((k) => k.id).join(',') || undefined,
          excludeKeywords: excludeKeywords.map((k) => k.id).join(',') || undefined,
          excludeCompanies: excludeCompanies.map((c) => c.id).join(',') || undefined,
        };
        data = await onPreview(localCatalog.type || 'movie', filters);
      }
      setPreviewData(data);
    } catch (err) {
      setPreviewError(err.message);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleImport = useCallback((data) => {
    setLocalCatalog((prev) => ({ ...prev, ...data }));
  }, []);

  if (!catalog) {
    return (
      <div className="editor-panel">
        <div className="empty-state">
          <div className="empty-state-icon">
            <Sparkles size={48} />
          </div>
          <h3>Create Your First Catalog</h3>
          <p>Click "Add" in the sidebar to start building a custom catalog with TMDB filters</p>
        </div>
      </div>
    );
  }

  const catalogType = localCatalog?.type || 'movie';
  const isMovie = catalogType === 'movie';
  const currentGenres = safeGenres[catalogType] || [];
  const selectedGenres = localCatalog?.filters?.genres || [];
  const excludedGenres = localCatalog?.filters?.excludeGenres || [];
  const certCountry = localCatalog?.filters?.certificationCountry || 'US';
  const certOptions = (safeCertifications[catalogType] || {})[certCountry] || [];
  const currentListType = localCatalog?.filters?.listType || 'discover';
  const isPresetCatalog = currentListType && currentListType !== 'discover';
  const supportsFullFilters = !isPresetCatalog;
  const isImdbCatalog = localCatalog?.source === 'imdb';
  const getFilterCount = (section) => activeFilters.filter((f) => f.section === section).length;

  return (
    <div className="editor-container">
      <div className="editor-panel">
        <div className="editor-header">
          <div className="editor-title">
            {isMovie ? <Film size={22} /> : <Tv size={22} />}
            <div style={{ flex: 1 }}>
              <input
                type="text"
                className={`editor-name-input${!localCatalog?.name?.trim() ? ' field-invalid' : ''}`}
                placeholder="Catalog Name..."
                value={localCatalog?.name || ''}
                onChange={(e) => handleNameChange(e.target.value)}
                maxLength={50}
              />
              {!localCatalog?.name?.trim() && <span className="field-error">Name is required</span>}
            </div>
          </div>
          <div className="editor-actions">
            <button className="btn btn-secondary" onClick={loadPreview} disabled={previewLoading}>
              {previewLoading ? <Loader size={16} className="animate-spin" /> : <Eye size={16} />}
              Preview
            </button>
            <CatalogImportExport
              localCatalog={localCatalog}
              onImport={handleImport}
              addToast={addToast}
            />
          </div>
        </div>

        <div className="editor-content">
          {imdbEnabled && (
            <div className="source-tabs" style={{ marginBottom: '16px' }}>
              <button
                type="button"
                className={`source-tab ${!isImdbCatalog ? 'active tmdb' : ''}`}
                onClick={() => handleSourceChange('tmdb')}
              >
                <Film size={14} /> TMDB
              </button>
              <button
                type="button"
                className={`source-tab ${isImdbCatalog ? 'active imdb' : ''}`}
                onClick={() => handleSourceChange('imdb')}
              >
                <Award size={14} /> IMDb
              </button>
            </div>
          )}

          <div className="content-type-toggle">
            <button
              className={`type-btn ${isMovie ? 'active' : ''}`}
              onClick={() => handleTypeChange('movie')}
              disabled={!supportsFullFilters}
              style={!supportsFullFilters ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
            >
              <Film size={18} /> Movies
            </button>
            <button
              className={`type-btn ${!isMovie ? 'active' : ''}`}
              onClick={() => handleTypeChange('series')}
              disabled={!supportsFullFilters}
              style={!supportsFullFilters ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
            >
              <Tv size={18} /> TV Shows
            </button>
          </div>

          <ActiveFiltersBar
            activeFilters={activeFilters}
            onClearFilter={clearFilter}
            onClearAll={clearAllFilters}
            onToggleSection={toggleSection}
          />

          {isImdbCatalog ? (
            <ImdbFilterPanel
              localCatalog={localCatalog}
              onFiltersChange={handleFiltersChange}
              imdbGenres={imdbGenres}
              imdbKeywords={imdbKeywords}
              imdbAwards={imdbAwards}
              imdbSortOptions={imdbSortOptions}
              imdbTitleTypes={imdbTitleTypes}
              countries={safeCountries}
              languages={safeOriginalLanguages}
            />
          ) : (
            <>
              {!isPresetCatalog && (
                <FilterSection
                  id="filters"
                  title="Sort & Filter"
                  description="Sorting, language, year, rating"
                  icon={Settings}
                  isOpen={expandedSections.filters}
                  onToggle={toggleSection}
                  badgeCount={getFilterCount('filters')}
                >
                  <FilterPanel
                    localCatalog={localCatalog}
                    onFiltersChange={handleFiltersChange}
                    sortOptions={sortOptions}
                    originalLanguages={originalLanguages}
                    countries={countries}
                  />
                </FilterSection>
              )}

              {supportsFullFilters && (
                <FilterSection
                  id="release"
                  title={`${isMovie ? 'Release' : 'Air Date'} & Classification`}
                  description="Date ranges, age ratings, release type"
                  icon={Calendar}
                  isOpen={expandedSections.release}
                  onToggle={toggleSection}
                  badgeCount={getFilterCount('release')}
                >
                  <ReleaseFilters
                    localCatalog={localCatalog}
                    onFiltersChange={handleFiltersChange}
                    isMovie={isMovie}
                    countries={countries}
                    releaseTypes={releaseTypes}
                    tvStatuses={tvStatuses}
                    tvTypes={tvTypes}
                    certOptions={certOptions}
                  />
                </FilterSection>
              )}

              {supportsFullFilters && (
                <FilterSection
                  id="streaming"
                  title="Where to Watch"
                  description="Filter by streaming services and original networks"
                  icon={Play}
                  isOpen={expandedSections.streaming}
                  onToggle={toggleSection}
                  badgeCount={getFilterCount('streaming')}
                >
                  <StreamFilters
                    type={localCatalog?.type}
                    tvNetworks={tvNetworkOptions}
                    selectedNetworks={selectedNetworks}
                    watchRegions={watchRegions}
                    watchProviders={watchProviders}
                    monetizationTypes={monetizationTypes}
                    onNetworkSearch={handleTVNetworkSearch}
                    filters={localCatalog?.filters || {}}
                    onFiltersChange={handleFiltersChange}
                  />
                </FilterSection>
              )}

              {supportsFullFilters && (
                <FilterSection
                  id="genres"
                  title="Genres"
                  description={
                    activeFilters.find((f) => f.section === 'genres')?.label ||
                    'Select genres to include/exclude'
                  }
                  icon={Sparkles}
                  isOpen={expandedSections.genres}
                  onToggle={toggleSection}
                  badgeCount={getFilterCount('genres')}
                >
                  <GenreSelector
                    genres={currentGenres}
                    selectedGenres={selectedGenres}
                    excludedGenres={excludedGenres}
                    genreMatchMode={localCatalog?.filters?.genreMatchMode || 'any'}
                    onInclude={handleTriStateGenreClick}
                    onExclude={handleTriStateGenreClick}
                    onClear={handleTriStateGenreClick}
                    onSetMatchMode={(mode) => handleFiltersChange('genreMatchMode', mode)}
                    loading={genresLoading}
                    onRefresh={refreshGenres}
                  />
                </FilterSection>
              )}

              {supportsFullFilters && (
                <FilterSection
                  id="people"
                  title={isMovie ? 'People & Studios' : 'Studios & Keywords'}
                  description={
                    isMovie
                      ? 'Filter by cast, crew, or production company'
                      : 'Filter by production companies and keywords'
                  }
                  icon={Users}
                  isOpen={expandedSections.people}
                  onToggle={toggleSection}
                  badgeCount={getFilterCount('people')}
                >
                  <PeopleFilters
                    selectedPeople={selectedPeople}
                    onSelectPeople={setSelectedPeople}
                    selectedCompanies={selectedCompanies}
                    onSelectCompanies={setSelectedCompanies}
                    selectedKeywords={selectedKeywords}
                    onSelectKeywords={setSelectedKeywords}
                    excludeKeywords={excludeKeywords}
                    onExcludeKeywords={setExcludeKeywords}
                    excludeCompanies={excludeCompanies}
                    onExcludeCompanies={setExcludeCompanies}
                    searchPerson={searchPerson}
                    searchCompany={searchCompany}
                    searchKeyword={searchKeyword}
                    showPeople={isMovie}
                  />
                </FilterSection>
              )}

              {supportsFullFilters ? (
                <FilterSection
                  id="options"
                  title="Options"
                  description="Include adult, video, randomize, or discover-only results"
                  icon={Settings}
                  isOpen={expandedSections.options}
                  onToggle={toggleSection}
                >
                  <OptionsPanel
                    localCatalog={localCatalog}
                    onFiltersChange={handleFiltersChange}
                    isMovie={isMovie}
                  />
                </FilterSection>
              ) : (
                <div
                  className="flex items-center gap-3 p-4 mt-6 rounded-lg border border-white/5 bg-white/5"
                  style={{ justifyContent: 'center' }}
                >
                  <Sparkles size={16} className="text-indigo-400" />
                  <span className="text-gray-300 text-sm font-medium">
                    This is a curated preset from TMDB and cannot be modified.
                  </span>
                </div>
              )}
            </>
          )}

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

      <CatalogPreview
        loading={previewLoading}
        error={previewError}
        data={previewData}
        onRetry={loadPreview}
        onLoadPreview={loadPreview}
      />
    </div>
  );
});
