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
import { memo } from 'react';
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

import { useCatalogEditor } from '../../hooks/useCatalogEditor';
import { useCatalogEditorHandlers } from '../../hooks/useCatalogEditorHandlers';

export const CatalogEditor = memo(function CatalogEditor() {
  const state = useCatalogEditor();
  const handlers = useCatalogEditorHandlers(state);

  const {
    catalog,
    addToast,
    localCatalog,
    previewData,
    previewLoading,
    previewError,
    tvNetworkOptions,
    expandedSections,
    safeGenres,
    safeOriginalLanguages,
    safeCountries,
    safeCertifications,
    sortOptions,
    originalLanguages,
    countries,
    releaseTypes,
    tvStatuses,
    tvTypes,
    monetizationTypes,
    watchRegions,
    watchProviders,
    genresLoading,
    refreshGenres,
    imdbGenres,
    imdbKeywords,
    imdbAwards,
    imdbSortOptions,
    imdbTitleTypes,
    searchPerson,
    searchCompany,
    searchKeyword,
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
    activeFilters,
    clearFilter,
    clearAllFilters,
  } = state;

  const {
    toggleSection,
    handleFiltersChange,
    handleNameChange,
    handleTypeChange,
    handleTriStateGenreClick,
    loadPreview,
    handleImport,
    handleTVNetworkSearch,
  } = handlers;

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
