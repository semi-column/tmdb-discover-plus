import { Eye, Film, Loader, Sparkles, Tv } from 'lucide-react';
import { memo, Suspense } from 'react';
import { ActiveFiltersBar } from './catalog/ActiveFiltersBar';
import { CatalogPreview } from './catalog/CatalogPreview';

import { useCatalogEditor } from '../../hooks/useCatalogEditor';
import { useCatalogEditorHandlers } from '../../hooks/useCatalogEditorHandlers';
import { getSource } from '../../sources/index';

const SOURCE_ATTRIBUTION = {
  tmdb: { label: 'TMDB', url: 'https://www.themoviedb.org/' },
  imdb: { label: 'Sleeyax', url: 'https://sleeyax.dev/' },
  anilist: { label: 'AniList', url: 'https://anilist.co/' },
  mal: { label: 'MyAnimeList', url: 'https://myanimelist.net/' },
  simkl: { label: 'Simkl', url: 'https://simkl.com/' },
};

export const CatalogEditor = memo(function CatalogEditor() {
  const state = useCatalogEditor();
  const handlers = useCatalogEditorHandlers(state);

  const {
    catalog,
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
    imdbCertificateRatings,
    imdbRankedLists,
    imdbWithDataOptions,
    searchPerson,
    searchCompany,
    searchKeyword,
    searchImdbPeople,
    searchImdbCompanies,
    searchCities,
    // Anime reference data
    anilistGenres,
    anilistTags,
    anilistSortOptions,
    anilistFormatOptions,
    anilistStatusOptions,
    anilistSeasonOptions,
    anilistSourceOptions,
    anilistCountryOptions,
    malGenres,
    malRankingTypes,
    malSortOptions,
    malOrderByOptions,
    malMediaTypes,
    malStatuses,
    malRatings,
    simklGenres,
    simklSortOptions,
    simklListTypes,
    simklTrendingPeriods,
    simklBestFilters,
    simklAnimeTypes,
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
    selectedImdbPeople,
    setSelectedImdbPeople,
    selectedImdbCompanies,
    setSelectedImdbCompanies,
    selectedImdbExcludeCompanies,
    setSelectedImdbExcludeCompanies,
    selectedCity,
    setSelectedCity,
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
  const currentListType = localCatalog?.filters?.listType || 'discover';
  const isPresetCatalog = currentListType && currentListType !== 'discover';
  const supportsFullFilters = !isPresetCatalog;
  const isImdbCatalog = localCatalog?.source === 'imdb';

  const catalogSource = getSource(localCatalog?.source ?? 'tmdb');
  const SourceFilterPanel = catalogSource.FilterPanelComponent;

  const sourcePanelProps = {
    localCatalog,
    onFiltersChange: handleFiltersChange,
    sortOptions,
    originalLanguages,
    countries,
    safeCountries,
    safeCertifications,
    safeGenres,
    safeOriginalLanguages,
    releaseTypes,
    tvStatuses,
    tvTypes,
    watchRegions,
    watchProviders,
    monetizationTypes,
    tvNetworkOptions,
    selectedNetworks,
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
    searchPerson,
    searchCompany,
    searchKeyword,
    onSearchImdbPeople: searchImdbPeople,
    onSearchImdbCompanies: searchImdbCompanies,
    onSearchCities: searchCities,
    selectedImdbPeople,
    setSelectedImdbPeople,
    selectedImdbCompanies,
    setSelectedImdbCompanies,
    selectedImdbExcludeCompanies,
    setSelectedImdbExcludeCompanies,
    selectedCity,
    setSelectedCity,
    imdbGenres,
    imdbKeywords,
    imdbAwards,
    imdbSortOptions,
    imdbTitleTypes,
    imdbCertificateRatings,
    imdbRankedLists,
    imdbWithDataOptions,
    // Anime reference data
    anilistGenres,
    anilistTags,
    anilistSortOptions,
    anilistFormatOptions,
    anilistStatusOptions,
    anilistSeasonOptions,
    anilistSourceOptions,
    anilistCountryOptions,
    malGenres,
    malRankingTypes,
    malSortOptions,
    malOrderByOptions,
    malMediaTypes,
    malStatuses,
    malRatings,
    simklGenres,
    simklSortOptions,
    simklListTypes,
    simklTrendingPeriods,
    simklBestFilters,
    simklAnimeTypes,
    handleTVNetworkSearch,
    handleTriStateGenreClick,
    genresLoading,
    refreshGenres,
    expandedSections,
    onToggleSection: toggleSection,
    activeFilters,
    isPresetCatalog,
    supportsFullFilters,
    onSelectImdbPerson: setSelectedImdbPeople,
    onRemoveImdbPerson: setSelectedImdbPeople,
    onSelectImdbCompany: setSelectedImdbCompanies,
    onRemoveImdbCompany: setSelectedImdbCompanies,
    onSelectImdbExcludeCompany: setSelectedImdbExcludeCompanies,
    onRemoveImdbExcludeCompany: setSelectedImdbExcludeCompanies,
    onSelectCity: (city) => {
      setSelectedCity(city);
      handleFiltersChange('inTheatersLat', city.lat);
      handleFiltersChange('inTheatersLong', city.lon);
    },
    onClearCity: () => {
      setSelectedCity(null);
      handleFiltersChange('inTheatersLat', undefined);
      handleFiltersChange('inTheatersLong', undefined);
      handleFiltersChange('inTheatersRadius', undefined);
    },
  };

  return (
    <div className="editor-container">
      <div className="editor-panel">
        <div className="editor-header">
          <div
            className="editor-title"
            style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}
          >
            <div
              className="editor-icon-wrapper"
              style={{
                padding: '8px',
                background: 'var(--bg-tertiary)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              {isMovie ? (
                <Film size={20} className="text-secondary" />
              ) : (
                <Tv size={20} className="text-secondary" />
              )}
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <input
                  type="text"
                  className={`editor-name-input${!localCatalog?.name?.trim() ? ' field-invalid' : ''}`}
                  placeholder="Catalog Name..."
                  value={localCatalog?.name || ''}
                  onChange={(e) => handleNameChange(e.target.value)}
                  maxLength={50}
                  style={{ margin: 0, padding: 0 }}
                />
              </div>
              {!localCatalog?.name?.trim() && <span className="field-error">Name is required</span>}
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                Powered by{' '}
                <a
                  href={
                    SOURCE_ATTRIBUTION[localCatalog?.source]?.url || SOURCE_ATTRIBUTION.tmdb.url
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    color: 'var(--accent-primary)',
                    textDecoration: 'none',
                    fontWeight: 600,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
                  onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
                >
                  {SOURCE_ATTRIBUTION[localCatalog?.source]?.label || SOURCE_ATTRIBUTION.tmdb.label}
                </a>
              </div>
            </div>
          </div>
          <div className="editor-actions">
            <button className="btn btn-secondary" onClick={loadPreview} disabled={previewLoading}>
              {previewLoading ? <Loader size={16} className="animate-spin" /> : <Eye size={16} />}
              Preview
            </button>
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

          {!(isImdbCatalog && isPresetCatalog) && (
            <ActiveFiltersBar
              activeFilters={activeFilters}
              onClearFilter={clearFilter}
              onClearAll={clearAllFilters}
              onToggleSection={toggleSection}
            />
          )}

          <Suspense fallback={null}>
            <SourceFilterPanel {...sourcePanelProps} />
          </Suspense>

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
